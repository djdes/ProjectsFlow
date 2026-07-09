import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { APP_REPO_WORKFLOW_PATH, APP_REPO_WORKFLOW_YAML } from './appRepoWorkflow.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
  readonly delegations: GitTokenDelegationRepository;
};

// Транслит кириллицы → латиница, чтобы имя репо было читаемым для русских названий
// (InitKbRepo этого не делает и превращает «Обувь» в «project»).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function slugify(name: string): string {
  const translit = name
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
  return (
    translit
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}

// GitHub возвращает 422 когда имя репо уже занято у пользователя.
function isNameTaken(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 422;
}

// Стартовая index.html в app-репо: заготовка сайта-результата + подсказка, что дать воркеру.
// Воркер соберёт настоящий сайт и заменит её. Self-contained HTML (без CDN).
function appRepoIndexHtml(projectName: string): string {
  const name = projectName
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Ubuntu,sans-serif;
    background:#f7f7f5;color:#1f2328}
  @media(prefers-color-scheme:dark){body{background:#191919;color:#e7e7e7}}
  .card{max-width:560px;width:100%;text-align:center}
  h1{font-size:28px;margin:0 0 12px}
  p{margin:0 auto 10px;color:#6b6f76;max-width:52ch}
  @media(prefers-color-scheme:dark){p{color:#a0a0a0}}
  code{background:rgba(135,131,120,.15);padding:2px 6px;border-radius:4px;font-size:14px}
</style></head>
<body><div class="card">
  <h1>${name}</h1>
  <p>Это стартовая страница сайта-результата проекта. Воркер соберёт здесь настоящий сайт.</p>
  <p>Поставьте задачу воркеру в проекте — опишите, какой сайт нужен (страницы, тексты, дизайн).
     Он запишет код в этот репозиторий и задеплоит результат.</p>
</div></body></html>`;
}

// Создать (или вернуть существующий) GitHub-репо приложения проекта — куда self-serve воркер
// будет писать код. Owner-only. Репо создаётся под аккаунтом ВЛАДЕЛЬЦА его OAuth-токеном (как KB),
// приватный, с авто-README (нужна ветка main для будущего workflow_dispatch). Идемпотентно:
// если у проекта уже есть app_repo_full_name — возвращаем его; если имя занято (422) — reuse.
//
// Кнопка «создать репо» = единая настройка воркера «под ключ»: помимо репо она ещё включает
// делегацию GitHub-токена owner'у и заводит локальную KB. Без этих двух шагов диспетчер либо
// скипает проект (нет KB), либо не может клонировать/пушить приватный репо (нет делегации) —
// и пользователь упирается в неочевидный blocker. Оба шага идемпотентны и best-effort (не роняют
// создание репо); если что-то не проросло — гейт-плашка воркера в UI подсветит.
export class EnsureProjectAppRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<{ fullName: string }> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      callerUserId,
      'manage_app_repo',
    );

    // Токен owner'а нужен и для создания репо, и как источник делегации (диспетчер пушит им).
    const ownerToken = await this.deps.tokens.getWithTokenByUserId(project.ownerId);

    let fullName = project.appRepoFullName;
    if (!fullName) {
      if (!ownerToken) throw new GithubNotConnectedError();

      // Короткий id проекта в имени гарантирует уникальность (два проекта с одинаковым названием
      // не столкнутся) и делает 422-reuse корректным (422 = повторный прогон ЭТОГО проекта).
      const repoName = `pf-${slugify(project.name)}-${project.id.slice(0, 8)}`;
      try {
        const result = await this.deps.api.createRepo(ownerToken.accessToken, {
          name: repoName,
          description: `ProjectsFlow app for ${project.name}`,
          privateRepo: true,
          autoInit: true,
        });
        fullName = result.fullName;
      } catch (err) {
        if (!isNameTaken(err)) throw err;
        // Имя уже занято у владельца → считаем это тем же app-репо (идемпотентно).
        const me = await this.deps.api.getAuthenticatedUser(ownerToken.accessToken);
        fullName = `${me.login}/${repoName}`;
      }

      // gitRepoUrl проставляем на app-репо (если ещё не задан), чтобы диспетчер клонировал именно
      // его существующим git-флоу. Не перезатираем уже подключённый пользователем репо.
      await this.deps.projects.update(projectId, {
        appRepoFullName: fullName,
        ...(project.gitRepoUrl ? {} : { gitRepoUrl: `https://github.com/${fullName}` }),
      });
    }

    // Авто-настройка воркера (идемпотентно, best-effort — не роняем создание репо).
    // Делегация: включаем owner'у, только если у него подключён GitHub (иначе делегировать нечего).
    if (ownerToken) {
      try {
        await this.deps.delegations.upsert({
          projectId,
          granterUserId: project.ownerId,
          enabled: true,
        });
      } catch {
        /* gate-плашка воркера подсветит выключенную делегацию */
      }
    }
    // Локальная KB: только если KB ещё не заведена (не перетираем github-KB).
    if (project.kbKind === 'none') {
      try {
        await this.deps.projects.update(projectId, { kbKind: 'local' });
      } catch {
        /* gate-плашка воркера подсветит отсутствие KB */
      }
    }

    // Build-workflow: кладём GitHub Actions workflow в app-репо, чтобы сборка результата шла
    // в облаке GitHub (гибридная схема — диспетчер забирает готовый dist-артефакт, node_modules
    // у нас не оседает). Best-effort + идемпотентно: если файл уже есть — не трогаем; если у
    // owner-токена нет `workflow`-scope (старый коннект GitHub) — тихо пропускаем, publish-site.ps1
    // откатится на локальную сборку. Owner переподключит GitHub → на следующем прогоне допишется.
    if (ownerToken) {
      const slash = fullName.indexOf('/');
      const owner = fullName.slice(0, slash);
      const repo = fullName.slice(slash + 1);
      try {
        const existing = await this.deps.api.getRepoFile(
          ownerToken.accessToken,
          fullName,
          APP_REPO_WORKFLOW_PATH,
        );
        if (!existing) {
          await this.deps.api.putRepoFile({
            accessToken: ownerToken.accessToken,
            owner,
            repo,
            path: APP_REPO_WORKFLOW_PATH,
            content: APP_REPO_WORKFLOW_YAML,
            message: 'ci: ProjectsFlow build-site workflow',
          });
        }
      } catch {
        /* нет workflow-scope / прочее — publish-site.ps1 откатится на локальную сборку */
      }

      // index.html-заготовка: стартовая страница сайта + подсказка воркеру/пользователю.
      // Best-effort + идемпотентно (не трогаем, если файл уже есть — воркер мог заменить).
      try {
        const existingIndex = await this.deps.api.getRepoFile(
          ownerToken.accessToken,
          fullName,
          'index.html',
        );
        if (!existingIndex) {
          await this.deps.api.putRepoFile({
            accessToken: ownerToken.accessToken,
            owner,
            repo,
            path: 'index.html',
            content: appRepoIndexHtml(project.name),
            message: 'chore: стартовая index.html (ProjectsFlow)',
          });
        }
      } catch {
        /* best-effort: репо всё равно создан, index.html не критичен */
      }
    }

    return { fullName };
  }
}

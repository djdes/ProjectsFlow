import matter from 'gray-matter';
import type { GithubApiClient } from '../../application/github/GithubApiClient.js';
import { GithubApiError } from '../../domain/github/errors.js';
import type {
  KbRepository,
  CreateKbRepoInput,
  CreateKbRepoResult,
  ListInput,
  ReadInput,
  WriteInput,
} from '../../application/kb/KbRepository.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from '../../application/kb/FrontmatterValidator.js';
import { KB_FOLDERS } from '../../domain/kb/Frontmatter.js';

function parseFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`invalid fullName: ${fullName}`);
  return { owner, repo };
}

const FOLDER_README_BODY = (folder: string): string =>
  `# ${folder}\n\nЗаметки в этой папке должны иметь \`type: ${folderToType(folder)}\` в frontmatter.\n`;

function folderToType(folder: string): string {
  const inv = Object.entries(KB_FOLDERS).find(([, v]) => v === folder);
  return inv?.[0] ?? 'note';
}

const ROOT_README = `# Project Knowledge Base

Этот репо создан ProjectsFlow как операционная тетрадь проекта.

## Структура

- \`credentials/\` — типизированные креды (mysql, ssh, api-keys). Реальные значения через \`vault://\` references.
- \`decisions/\` — ADR'ы: почему выбрали X.
- \`services/\` — компоненты системы.
- \`schemas/\` — диаграммы (ER, mermaid).
- \`runbooks/\` — как починить/задеплоить.
- \`notes/\` — свободная форма.

## Frontmatter

Все файлы — markdown с YAML-frontmatter. Минимум: \`type\` и \`title\`.
\`credential\`-файлы дополнительно требуют поле \`*_ref: vault://...\` для секретов.
`;

export class GithubKbRepository implements KbRepository {
  constructor(private readonly api: GithubApiClient) {}

  async createRepo(input: CreateKbRepoInput): Promise<CreateKbRepoResult> {
    // autoInit: false — пустой репо. initFolders отдельно пушит README.md.
    // Если репо уже существует (от предыдущей неудачной попытки) — переиспользуем.
    try {
      const result = await this.api.createRepo(input.accessToken, {
        name: input.name,
        description: input.description,
        privateRepo: true,
        autoInit: false,
      });
      return { fullName: result.fullName };
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 422 && /name already exists/i.test(err.message)) {
        const me = await this.api.getAuthenticatedUser(input.accessToken);
        return { fullName: `${me.login}/${input.name}` };
      }
      throw err;
    }
  }

  // Идемпотентный апсёрт: GET существующий файл (для sha), затем PUT.
  // На пустом репо GET вернёт null → PUT без sha (создание).
  private async upsertFile(
    accessToken: string,
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void> {
    const existing = await this.api.getRepoFile(accessToken, `${owner}/${repo}`, path);
    // Если контент уже совпадает — пропускаем, чтобы не плодить пустые коммиты.
    if (existing && existing.content === content) return;
    await this.api.putRepoFile({
      accessToken, owner, repo, path, content, message,
      sha: existing?.sha,
    });
  }

  async initFolders(accessToken: string, fullName: string): Promise<void> {
    const { owner, repo } = parseFullName(fullName);

    await this.upsertFile(accessToken, owner, repo, 'README.md', ROOT_README, 'chore(kb): initial README');

    for (const folder of Object.values(KB_FOLDERS)) {
      await this.upsertFile(
        accessToken, owner, repo,
        `${folder}/README.md`,
        FOLDER_README_BODY(folder),
        `chore(kb): init ${folder}/`,
      );
    }
  }

  async exists(accessToken: string, fullName: string): Promise<boolean> {
    return this.api.repoExists(accessToken, fullName);
  }

  async listAll(input: ListInput): Promise<KbDocumentSummary[]> {
    const result: KbDocumentSummary[] = [];
    const queue: string[] = input.folder ? [input.folder] : Object.values(KB_FOLDERS);

    while (queue.length > 0) {
      const folder = queue.shift()!;
      const items = await this.api.listRepoTree(input.accessToken, input.fullName, folder);
      for (const item of items) {
        if (item.type === 'dir') {
          queue.push(item.path);
        } else if (item.path.endsWith('.md') && !item.path.endsWith('/README.md')) {
          const file = await this.api.getRepoFile(input.accessToken, input.fullName, item.path);
          if (!file) continue;
          const parsed = matter(file.content);
          const fm = parsed.data as Frontmatter;
          const errors = validateFrontmatter(fm, parsed.content);
          result.push({
            path: item.path,
            frontmatter: fm,
            sha: file.sha,
            validationErrors: errors,
          });
        }
      }
    }

    return result;
  }

  async readOne(input: ReadInput): Promise<KbDocument | null> {
    const file = await this.api.getRepoFile(input.accessToken, input.fullName, input.path);
    if (!file) return null;
    const parsed = matter(file.content);
    const fm = parsed.data as Frontmatter;
    return {
      path: file.path,
      frontmatter: fm,
      body: parsed.content,
      raw: file.content,
      sha: file.sha,
      validationErrors: validateFrontmatter(fm, parsed.content),
    };
  }

  async write(input: WriteInput): Promise<{ sha: string }> {
    const { owner, repo } = parseFullName(input.fullName);
    return this.api.putRepoFile({
      accessToken: input.accessToken,
      owner, repo,
      path: input.path,
      content: input.content,
      message: input.message,
      sha: input.sha ?? undefined,
    });
  }

  async delete(input: ReadInput & { sha: string; message: string }): Promise<void> {
    await this.api.deleteRepoFile(
      input.accessToken,
      input.fullName,
      input.path,
      input.sha,
      input.message,
    );
  }
}

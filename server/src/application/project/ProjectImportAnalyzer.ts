import type { ProjectZipFile } from './extractProjectZip.js';

export type ProjectImportSupportStatus = 'supported' | 'needs_config' | 'unsupported';

export type ProjectImportKind =
  | 'static'
  | 'vite'
  | 'create-react-app'
  | 'astro-static'
  | 'next-export'
  | 'node-server'
  | 'api-only'
  | 'monorepo'
  | 'unknown';

export type ProjectImportPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none' | 'unknown';

export type ProjectImportDiagnostic = {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly remediation: string | null;
};

export type ProjectImportDataHint = {
  readonly kind: 'json-file' | 'lowdb' | 'json-server' | 'filesystem-write';
  readonly path: string | null;
  readonly message: string;
};

export type ProjectImportSecretFinding = {
  readonly path: string;
  readonly kind: 'environment' | 'private-key' | 'credential-file' | 'token';
};

export type ProjectImportAnalysis = {
  readonly status: ProjectImportSupportStatus;
  readonly kind: ProjectImportKind;
  readonly framework: string | null;
  readonly packageManager: ProjectImportPackageManager;
  readonly rootDir: string;
  readonly buildCommand: string | null;
  readonly startCommand: string | null;
  readonly outputDir: string | null;
  readonly fileCount: number;
  readonly diagnostics: readonly ProjectImportDiagnostic[];
  readonly dataHints: readonly ProjectImportDataHint[];
  readonly secretFindings: readonly ProjectImportSecretFinding[];
};

type PackageJson = {
  readonly scripts?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly workspaces?: unknown;
};

const TEXT_SCAN_LIMIT = 512 * 1024;
const KNOWN_OUTPUTS = ['dist', 'build', 'out', 'public'] as const;
const SECRET_TOKEN_RE = /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})/;

function lowerMap(files: readonly ProjectZipFile[]): Map<string, ProjectZipFile> {
  return new Map(files.map((file) => [file.path.toLowerCase(), file]));
}

function text(file: ProjectZipFile | undefined): string {
  if (!file || file.content.length > TEXT_SCAN_LIMIT || file.content.includes(0)) return '';
  return file.content.toString('utf8');
}

function dependencyNames(pkg: PackageJson | null): Set<string> {
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
}

function script(pkg: PackageJson | null, name: string): string | null {
  const value = pkg?.scripts?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function packageManager(paths: ReadonlySet<string>): {
  manager: ProjectImportPackageManager;
  conflicts: readonly string[];
} {
  const found = [
    paths.has('package-lock.json') ? 'npm' : null,
    paths.has('pnpm-lock.yaml') ? 'pnpm' : null,
    paths.has('yarn.lock') ? 'yarn' : null,
    paths.has('bun.lock') || paths.has('bun.lockb') ? 'bun' : null,
  ].filter((value): value is Exclude<ProjectImportPackageManager, 'none' | 'unknown'> => value !== null);
  if (found.length === 0) return { manager: paths.has('package.json') ? 'unknown' : 'none', conflicts: [] };
  return { manager: found.length === 1 ? found[0]! : 'unknown', conflicts: found };
}

function secretFindings(files: readonly ProjectZipFile[]): ProjectImportSecretFinding[] {
  const findings: ProjectImportSecretFinding[] = [];
  const seen = new Set<string>();
  const add = (path: string, kind: ProjectImportSecretFinding['kind']): void => {
    const key = `${path.toLowerCase()}:${kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ path, kind });
    }
  };
  for (const file of files) {
    const path = file.path.toLowerCase();
    const name = path.split('/').at(-1) ?? path;
    if ((name === '.env' || name.startsWith('.env.')) && !/\.(?:example|sample|template)$/.test(name)) {
      add(file.path, 'environment');
    }
    if (['id_rsa', 'id_ed25519', '.npmrc', '.pypirc', 'credentials.json', 'service-account.json'].includes(name)) {
      add(file.path, name.startsWith('id_') ? 'private-key' : 'credential-file');
    }
    const value = text(file);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) add(file.path, 'private-key');
    if (SECRET_TOKEN_RE.test(value)) add(file.path, 'token');
  }
  return findings;
}

function dataHints(files: readonly ProjectZipFile[], deps: ReadonlySet<string>): ProjectImportDataHint[] {
  const hints: ProjectImportDataHint[] = [];
  const add = (hint: ProjectImportDataHint): void => {
    if (!hints.some((candidate) => candidate.kind === hint.kind && candidate.path === hint.path)) hints.push(hint);
  };
  if (deps.has('lowdb')) add({ kind: 'lowdb', path: null, message: 'Найдена lowdb: запись JSON требует постоянного серверного диска.' });
  if (deps.has('json-server')) add({ kind: 'json-server', path: null, message: 'Найден json-server: он не запускается на статическом хостинге.' });
  for (const file of files) {
    const path = file.path.toLowerCase();
    const name = path.split('/').at(-1) ?? path;
    if (['db.json', 'database.json'].includes(name)) {
      add({ kind: 'json-file', path: file.path, message: 'JSON-файл похож на изменяемую базу данных.' });
    }
    if (/\.(?:js|cjs|mjs|ts|tsx)$/.test(path)) {
      const value = text(file);
      if (/\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\(/.test(value)) {
        add({ kind: 'filesystem-write', path: file.path, message: 'Код записывает файлы во время работы.' });
      }
    }
  }
  return hints;
}

function nextIsExport(files: ReadonlyMap<string, ProjectZipFile>, build: string | null): boolean {
  if (build && /\bnext\s+export\b/.test(build)) return true;
  for (const name of ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts']) {
    const value = text(files.get(name));
    if (/\boutput\s*:\s*['"]export['"]/.test(value)) return true;
  }
  return false;
}

function astroIsServer(files: ReadonlyMap<string, ProjectZipFile>): boolean {
  for (const name of ['astro.config.js', 'astro.config.mjs', 'astro.config.cjs', 'astro.config.ts']) {
    const value = text(files.get(name));
    if (/\boutput\s*:\s*['"](?:server|hybrid)['"]/.test(value)) return true;
    if (/@astrojs\/(?:node|vercel|netlify|cloudflare)/.test(value)) return true;
  }
  return false;
}

function configuredOutputDir(
  files: ReadonlyMap<string, ProjectZipFile>,
  configNames: readonly string[],
): string | null {
  for (const name of configNames) {
    const value = text(files.get(name));
    const match = value.match(/\boutDir\s*:\s*['"](?:\.\/)?([^'"]+)['"]/);
    if (match?.[1]) return match[1].replace(/\/+$/, '');
  }
  return null;
}

function outputWithIndex(paths: ReadonlySet<string>): string | null {
  for (const dir of KNOWN_OUTPUTS) if (paths.has(`${dir}/index.html`)) return dir;
  return paths.has('index.html') ? '.' : null;
}

export class ProjectImportAnalyzer {
  analyze(files: readonly ProjectZipFile[]): ProjectImportAnalysis {
    const filesByPath = lowerMap(files);
    const paths = new Set(filesByPath.keys());
    const diagnostics: ProjectImportDiagnostic[] = [];
    const add = (diagnostic: ProjectImportDiagnostic): void => { diagnostics.push(diagnostic); };
    const secrets = secretFindings(files);

    const nestedPackages = [...paths].filter((path) => path.endsWith('/package.json'));
    let pkg: PackageJson | null = null;
    let invalidPackage = false;
    if (paths.has('package.json')) {
      try {
        const parsed: unknown = JSON.parse(text(filesByPath.get('package.json')));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        pkg = parsed as PackageJson;
      } catch {
        invalidPackage = true;
        add({
          code: 'INVALID_PACKAGE_JSON', severity: 'error',
          message: 'package.json повреждён или имеет неподдерживаемый формат.',
          remediation: 'Исправьте package.json и загрузите архив повторно.',
        });
      }
    }

    const manager = packageManager(paths);
    if (manager.conflicts.length > 1) {
      add({
        code: 'LOCKFILE_CONFLICT', severity: 'error',
        message: `Найдено несколько lock-файлов: ${manager.conflicts.join(', ')}.`,
        remediation: 'Оставьте lock-файл одного пакетного менеджера.',
      });
    }

    const isMonorepo = Boolean(pkg?.workspaces) || paths.has('pnpm-workspace.yaml') || paths.has('lerna.json') || nestedPackages.length > 0;
    if (isMonorepo) {
      add({
        code: 'MONOREPO_NEEDS_ROOT', severity: 'error',
        message: 'Обнаружен monorepo. Автоматический выбор приложения пока небезопасен.',
        remediation: 'Загрузите ZIP нужного приложения отдельно, чтобы package.json находился в корне.',
      });
    }

    if (secrets.length > 0) {
      add({
        code: 'SECRETS_FOUND', severity: 'error',
        message: `Найдены потенциальные секреты в ${secrets.length} файл(ах). GitHub import остановлен.`,
        remediation: 'Удалите секреты из архива, отзовите скомпрометированные ключи и добавьте безопасные примеры `.env.example`.',
      });
    }

    const deps = dependencyNames(pkg);
    const build = script(pkg, 'build');
    const start = script(pkg, 'start');
    const hints = dataHints(files, deps);
    const staticOutput = outputWithIndex(paths);
    const hasNodeFramework = deps.has('express') || deps.has('fastify') || deps.has('@nestjs/core') || deps.has('koa') || deps.has('hapi');
    const hasRuntimeStart = Boolean(start && /(?:^|\s)(?:node|tsx|ts-node|bun|deno)(?:\s|$)|\bnext\s+start\b|\bnest\s+start\b/i.test(start));

    let kind: ProjectImportKind = 'unknown';
    let framework: string | null = null;
    let outputDir: string | null = null;

    if (isMonorepo) {
      kind = 'monorepo';
    } else if (deps.has('next')) {
      framework = 'Next.js';
      if (nextIsExport(filesByPath, build)) {
        kind = 'next-export';
        outputDir = 'out';
      } else {
        kind = 'node-server';
        add({
          code: 'NEXT_SSR_UNSUPPORTED', severity: 'error',
          message: 'Next.js использует SSR/server runtime, а текущая публикация поддерживает только static export.',
          remediation: "Добавьте `output: 'export'` в next.config и убедитесь, что приложение не использует server-only функции.",
        });
      }
    } else if (deps.has('astro')) {
      framework = 'Astro';
      if (astroIsServer(filesByPath) || hasNodeFramework || hasRuntimeStart) {
        kind = 'node-server';
        add({
          code: 'ASTRO_SERVER_UNSUPPORTED', severity: 'error',
          message: 'Astro настроен на server/hybrid output.',
          remediation: "Переключите Astro на статический output или дождитесь Node runtime ProjectsFlow.",
        });
      } else {
        kind = 'astro-static';
        outputDir = 'dist';
      }
    } else if (hasNodeFramework || hasRuntimeStart) {
      kind = staticOutput ? 'node-server' : 'api-only';
      framework = deps.has('express') ? 'Express' : deps.has('fastify') ? 'Fastify' : deps.has('@nestjs/core') ? 'NestJS' : 'Node.js';
      add({
        code: kind === 'api-only' ? 'API_RUNTIME_UNSUPPORTED' : 'NODE_RUNTIME_UNSUPPORTED', severity: 'error',
        message: 'Проекту нужен постоянно работающий Node.js-процесс, который текущий static runtime не запускает.',
        remediation: 'Исходники можно сохранить в GitHub, но для запуска нужен изолированный Node runtime. Пока экспортируйте frontend в статику и перенесите данные в ProjectsFlow App Database.',
      });
    } else if (deps.has('vite') || (build ? /\bvite\s+build\b/.test(build) : false)) {
      kind = 'vite'; framework = 'Vite'; outputDir = 'dist';
    } else if (deps.has('react-scripts')) {
      kind = 'create-react-app'; framework = 'Create React App'; outputDir = 'build';
    } else if (start) {
      kind = staticOutput ? 'node-server' : 'api-only';
      framework = deps.has('express') ? 'Express' : deps.has('fastify') ? 'Fastify' : deps.has('@nestjs/core') ? 'NestJS' : 'Node.js';
      add({
        code: kind === 'api-only' ? 'API_RUNTIME_UNSUPPORTED' : 'NODE_RUNTIME_UNSUPPORTED', severity: 'error',
        message: 'Проекту нужен постоянно работающий Node.js-процесс, который текущий static runtime не запускает.',
        remediation: 'Пока экспортируйте frontend в статику и перенесите данные в ProjectsFlow App Database.',
      });
    } else if (!pkg && staticOutput === '.') {
      kind = 'static'; framework = 'Static HTML'; outputDir = staticOutput;
    } else if (!pkg && staticOutput) {
      add({
        code: 'PREBUILT_ROOT_REQUIRED', severity: 'error',
        message: `Найден готовый сайт в папке «${staticOutput}», но без package.json публикатор ожидает index.html в корне.`,
        remediation: 'Перенесите содержимое этой папки в корень ZIP или добавьте воспроизводимый package.json с scripts.build.',
      });
    } else if (pkg && !build && staticOutput === '.') {
      kind = 'static'; framework = 'Static HTML'; outputDir = '.';
    }

    const supportedKind = ['static', 'vite', 'create-react-app', 'astro-static', 'next-export'].includes(kind);
    if (supportedKind && pkg && kind !== 'static' && !build) {
      add({
        code: 'MISSING_BUILD_SCRIPT', severity: 'error',
        message: `${framework ?? 'Проект'} найден, но в package.json нет scripts.build.`,
        remediation: 'Добавьте воспроизводимую команду `build` в package.json.',
      });
    }
    const customOutput = kind === 'vite'
      ? configuredOutputDir(filesByPath, ['vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.ts'])
      : kind === 'astro-static'
        ? configuredOutputDir(filesByPath, ['astro.config.js', 'astro.config.mjs', 'astro.config.cjs', 'astro.config.ts'])
        : null;
    if (customOutput && !KNOWN_OUTPUTS.includes(customOutput as typeof KNOWN_OUTPUTS[number])) {
      outputDir = customOutput;
      add({
        code: 'CUSTOM_OUTPUT_DIR_UNSUPPORTED', severity: 'error',
        message: `Сборка пишет результат в «${customOutput}», а публикация принимает только ${KNOWN_OUTPUTS.join(', ')}.`,
        remediation: 'Верните стандартный outputDir «dist» и загрузите архив повторно.',
      });
    }
    if (!supportedKind && !diagnostics.some((item) => item.code.endsWith('_UNSUPPORTED') || item.code.includes('RUNTIME_UNSUPPORTED'))) {
      add({
        code: 'PROJECT_TYPE_UNKNOWN', severity: 'error',
        message: 'Не удалось надёжно определить статическое приложение.',
        remediation: 'Добавьте корневой index.html или package.json поддерживаемого Vite/CRA/Astro/Next static-export проекта.',
      });
    }

    const mutableJson = hints.some((hint) => ['lowdb', 'json-server', 'filesystem-write'].includes(hint.kind));
    if (mutableJson) {
      add({
        code: 'MUTABLE_JSON_DB_UNSUPPORTED', severity: 'error',
        message: 'Проект изменяет JSON-файлы как базу данных; на статическом хостинге эти записи не сохранятся.',
        remediation: 'Перенесите данные в ProjectsFlow App Database или дождитесь изолированного Node runtime с постоянным диском.',
      });
    } else if (hints.some((hint) => hint.kind === 'json-file')) {
      add({
        code: 'JSON_DATA_READ_ONLY', severity: 'warning',
        message: 'Найден JSON-файл данных. Он будет опубликован только для чтения.',
        remediation: 'Если приложению нужно изменять эти данные, перенесите их в ProjectsFlow App Database.',
      });
    }

    let status: ProjectImportSupportStatus;
    const hardUnsupported = ['node-server', 'api-only'].includes(kind) || diagnostics.some((item) => item.code === 'MUTABLE_JSON_DB_UNSUPPORTED');
    if (hardUnsupported) status = 'unsupported';
    else if (!supportedKind || invalidPackage || isMonorepo || manager.conflicts.length > 1 || secrets.length > 0 || diagnostics.some((item) => item.severity === 'error')) status = 'needs_config';
    else status = 'supported';

    if (status === 'supported') {
      add({
        code: 'SUPPORTED_STATIC', severity: 'info',
        message: `${framework ?? 'Статическое приложение'} можно безопасно собрать и опубликовать.`,
        remediation: null,
      });
    }

    return {
      status,
      kind,
      framework,
      packageManager: manager.manager,
      rootDir: '.',
      buildCommand: build ? `${manager.manager === 'pnpm' ? 'pnpm' : manager.manager === 'yarn' ? 'yarn' : manager.manager === 'bun' ? 'bun run' : 'npm run'} build` : null,
      startCommand: start,
      outputDir,
      fileCount: files.length,
      diagnostics,
      dataHints: hints,
      secretFindings: secrets,
    };
  }
}

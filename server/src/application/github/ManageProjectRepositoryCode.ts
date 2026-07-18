import { Buffer } from 'node:buffer';
import {
  GithubApiError,
  GithubNotConnectedError,
  GithubRepoFileConflictError,
  GithubRepoFileInvalidError,
  GithubRepoFileNotFoundError,
  GithubRepoFileRestrictedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { GitTokenDelegationRepository } from '../project/GitTokenDelegationRepository.js';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { GithubApiClient, RepoFileContent, RepoFileSummary } from './GithubApiClient.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';
import { parseGithubOwnerRepo } from './ListProjectCommits.js';
import {
  logDelegatedUsage,
  resolveEffectiveGithubToken,
  type EffectiveGithubToken,
} from './resolveEffectiveGithubToken.js';

export type ProjectRepoFileRestriction = 'sensitive' | 'binary' | 'too_large';

export type ProjectRepoTreeEntry = RepoFileSummary & {
  readonly restricted: boolean;
  readonly restrictedReason?: ProjectRepoFileRestriction;
};

export type ProjectRepoTree = {
  readonly fullName: string;
  readonly entries: readonly ProjectRepoTreeEntry[];
  readonly truncated: boolean;
};

export type ProjectRepoTextFile = RepoFileContent;

export type SaveProjectRepoFileInput = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly message?: string;
};

export type SaveProjectRepoFileResult = {
  readonly path: string;
  readonly sha: string;
  readonly commitMessage: string;
};

type Deps = ProjectAccessDeps & {
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
  readonly delegations: GitTokenDelegationRepository;
  readonly users: UserRepository;
  readonly activity?: ActivityRecorder;
};

// Глобальный JSON parser сервера ограничен 256 KiB. Оставляем запас на path/sha/JSON escaping,
// чтобы допустимый в use-case файл гарантированно доходил до него целиком.
const MAX_TEXT_FILE_BYTES = 200 * 1024;
const MAX_COMMIT_MESSAGE = 240;

const BINARY_EXTENSIONS = new Set([
  '7z', 'a', 'apk', 'avi', 'bin', 'bmp', 'bz2', 'class', 'db', 'dll', 'dmg', 'doc', 'docx',
  'eot', 'exe', 'flac', 'gif', 'gz', 'ico', 'iso', 'jar', 'jpeg', 'jpg', 'm4a', 'mkv', 'mov',
  'mp3', 'mp4', 'mpeg', 'mpg', 'ogg', 'otf', 'pdf', 'png', 'ppt', 'pptx', 'psd', 'rar', 'so',
  'sqlite', 'tar', 'tif', 'tiff', 'ttf', 'wav', 'webm', 'webp', 'woff', 'woff2', 'xls', 'xlsx',
  'xz', 'zip',
]);

export class ManageProjectRepositoryCode {
  constructor(private readonly deps: Deps) {}

  async getTree(projectId: string, userId: string): Promise<ProjectRepoTree> {
    const context = await this.resolveContext(projectId, userId, 'read_project');
    const result = await this.deps.api.listRepoTreeRecursive(context.token.accessToken, context.fullName);
    await this.auditDelegated(projectId, userId, context.token);

    const entries = result.entries
      .map((entry): ProjectRepoTreeEntry => {
        const reason = entry.type === 'file' ? restrictionFor(entry.path, entry.size) : undefined;
        return reason
          ? { ...entry, restricted: true, restrictedReason: reason }
          : { ...entry, restricted: false };
      })
      .sort(compareTreeEntries);

    return {
      fullName: context.fullName,
      entries,
      truncated: result.truncated,
    };
  }

  async getFile(projectId: string, userId: string, rawPath: string): Promise<ProjectRepoTextFile> {
    const path = validateRepositoryPath(rawPath);
    rejectRestricted(path);
    const context = await this.resolveContext(projectId, userId, 'read_project');
    const file = await this.deps.api.getRepoFile(context.token.accessToken, context.fullName, path);
    await this.auditDelegated(projectId, userId, context.token);
    if (!file) throw new GithubRepoFileNotFoundError(path);
    rejectRestricted(path, file.size);
    if (!isLikelyText(file.content)) throw new GithubRepoFileRestrictedError(path, 'binary');
    return file;
  }

  async saveFile(
    projectId: string,
    userId: string,
    input: SaveProjectRepoFileInput,
  ): Promise<SaveProjectRepoFileResult> {
    const path = validateRepositoryPath(input.path);
    rejectRestricted(path, Buffer.byteLength(input.content, 'utf8'));
    if (!input.sha.trim()) throw new GithubRepoFileInvalidError(path, 'File SHA is required');
    if (!isLikelyText(input.content)) throw new GithubRepoFileRestrictedError(path, 'binary');

    const context = await this.resolveContext(projectId, userId, 'update_project');
    const current = await this.deps.api.getRepoFile(context.token.accessToken, context.fullName, path);
    if (!current) throw new GithubRepoFileNotFoundError(path);
    if (current.sha !== input.sha) throw new GithubRepoFileConflictError(path, current.sha);

    const message = normalizeCommitMessage(input.message, path);
    let result: { sha: string };
    try {
      result = await this.deps.api.putRepoFile({
        accessToken: context.token.accessToken,
        owner: context.owner,
        repo: context.repo,
        path,
        content: input.content,
        message,
        sha: input.sha,
      });
    } catch (error) {
      if (error instanceof GithubApiError && (error.status === 409 || error.status === 422)) {
        const latest = await this.deps.api.getRepoFile(context.token.accessToken, context.fullName, path);
        throw new GithubRepoFileConflictError(path, latest?.sha ?? current.sha);
      }
      throw error;
    }

    await this.auditDelegated(projectId, userId, context.token);
    await this.deps.activity?.record({
      projectId,
      actorUserId: userId,
      kind: 'project_updated',
      payload: {
        projectName: context.projectName,
        changes: [{ field: `code:${path}`, old: input.sha, new: result.sha }],
      },
    });
    return { path, sha: result.sha, commitMessage: message };
  }

  private async resolveContext(
    projectId: string,
    userId: string,
    action: 'read_project' | 'update_project',
  ): Promise<{
    owner: string;
    repo: string;
    fullName: string;
    projectName: string;
    token: EffectiveGithubToken;
  }> {
    const { project } = await requireProjectAccess(this.deps, projectId, userId, action);
    if (!project.gitRepoUrl) throw new GithubRepoUrlInvalidError('');
    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);
    const token = await resolveEffectiveGithubToken(this.deps, userId, projectId);
    if (!token) throw new GithubNotConnectedError();
    return {
      ...parsed,
      fullName: `${parsed.owner}/${parsed.repo}`,
      projectName: project.name,
      token,
    };
  }

  private async auditDelegated(
    projectId: string,
    userId: string,
    token: EffectiveGithubToken,
  ): Promise<void> {
    await logDelegatedUsage(this.deps.delegations, projectId, userId, token, 'git_token_fetch');
  }
}

function validateRepositoryPath(rawPath: string): string {
  const path = rawPath.trim();
  if (
    !path || path.length > 1_000 || path.startsWith('/') || path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new GithubRepoFileInvalidError(rawPath);
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 255)) {
    throw new GithubRepoFileInvalidError(rawPath);
  }
  return path;
}

function restrictionFor(path: string, size = 0): ProjectRepoFileRestriction | undefined {
  const basename = path.split('/').at(-1)?.toLowerCase() ?? '';
  const extension = basename.includes('.') ? basename.split('.').at(-1) ?? '' : '';
  const envSafe = ['.env.example', '.env.sample', '.env.template'].includes(basename);
  const sensitive =
    (!envSafe && (basename === '.env' || basename.startsWith('.env.'))) ||
    /(^|[._-])(secret|secrets|credential|credentials)([._-]|$)/i.test(basename) ||
    /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(basename) ||
    ['key', 'pem', 'p12', 'pfx'].includes(extension);
  if (sensitive) return 'sensitive';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';
  if (size > MAX_TEXT_FILE_BYTES) return 'too_large';
  return undefined;
}

function rejectRestricted(path: string, size = 0): void {
  const reason = restrictionFor(path, size);
  if (reason) throw new GithubRepoFileRestrictedError(path, reason);
}

function isLikelyText(content: string): boolean {
  if (content.includes('\u0000')) return false;
  if (!content) return true;
  const replacements = content.match(/\uFFFD/g)?.length ?? 0;
  return replacements / content.length < 0.01;
}

function compareTreeEntries(left: RepoFileSummary, right: RepoFileSummary): number {
  const leftParent = left.path.includes('/') ? left.path.slice(0, left.path.lastIndexOf('/')) : '';
  const rightParent = right.path.includes('/') ? right.path.slice(0, right.path.lastIndexOf('/')) : '';
  if (leftParent === rightParent && left.type !== right.type) return left.type === 'dir' ? -1 : 1;
  return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeCommitMessage(rawMessage: string | undefined, path: string): string {
  const normalized = rawMessage?.replace(/[\r\n\t]+/g, ' ').trim();
  return (normalized || `chore: update ${path} via ProjectsFlow`).slice(0, MAX_COMMIT_MESSAGE);
}

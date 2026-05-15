import type {
  GithubConnection,
  GithubConnectionWithToken,
} from '../../domain/github/GithubConnection.js';

export type UpsertGithubTokenInput = {
  readonly userId: string;
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly githubLogin: string;
  readonly githubUserId: string;
};

export interface GithubTokenRepository {
  // Возвращает публичный объект без accessToken — для presentation.
  getByUserId(userId: string): Promise<GithubConnection | null>;
  // Внутренний метод — accessToken нужен для API-вызовов к GitHub.
  getWithTokenByUserId(userId: string): Promise<GithubConnectionWithToken | null>;
  upsert(input: UpsertGithubTokenInput): Promise<GithubConnection>;
  delete(userId: string): Promise<void>;
}

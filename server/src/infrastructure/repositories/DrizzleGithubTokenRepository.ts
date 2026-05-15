import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { userGithubTokens, type UserGithubTokenRow } from '../db/schema.js';
import type {
  GithubConnection,
  GithubConnectionWithToken,
} from '../../domain/github/GithubConnection.js';
import type {
  GithubTokenRepository,
  UpsertGithubTokenInput,
} from '../../application/github/GithubTokenRepository.js';

function parseScopes(raw: string): readonly string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function toConnection(row: UserGithubTokenRow): GithubConnection {
  return {
    userId: row.userId,
    githubLogin: row.githubLogin,
    githubUserId: row.githubUserId,
    scopes: parseScopes(row.scopes),
    connectedAt: row.connectedAt,
  };
}

function toConnectionWithToken(row: UserGithubTokenRow): GithubConnectionWithToken {
  return {
    ...toConnection(row),
    accessToken: row.accessToken,
  };
}

export class DrizzleGithubTokenRepository implements GithubTokenRepository {
  constructor(private readonly db: Database) {}

  async getByUserId(userId: string): Promise<GithubConnection | null> {
    const rows = await this.db
      .select()
      .from(userGithubTokens)
      .where(eq(userGithubTokens.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? toConnection(row) : null;
  }

  async getWithTokenByUserId(userId: string): Promise<GithubConnectionWithToken | null> {
    const rows = await this.db
      .select()
      .from(userGithubTokens)
      .where(eq(userGithubTokens.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? toConnectionWithToken(row) : null;
  }

  async upsert(input: UpsertGithubTokenInput): Promise<GithubConnection> {
    const scopesStr = input.scopes.join(',');
    // Поскольку userId — primary key, делаем delete+insert (просто и атомарно для нашего случая).
    await this.db.delete(userGithubTokens).where(eq(userGithubTokens.userId, input.userId));
    await this.db.insert(userGithubTokens).values({
      userId: input.userId,
      accessToken: input.accessToken,
      scopes: scopesStr,
      githubLogin: input.githubLogin,
      githubUserId: input.githubUserId,
    });
    const fresh = await this.getByUserId(input.userId);
    if (!fresh) throw new Error('Failed to read back github_token after insert');
    return fresh;
  }

  async delete(userId: string): Promise<void> {
    await this.db.delete(userGithubTokens).where(eq(userGithubTokens.userId, userId));
  }
}

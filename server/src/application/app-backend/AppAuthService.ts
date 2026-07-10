import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppDatabaseStore, Row } from './AppDatabaseStore.js';
import { AppAuthError, AppUserExistsError } from '../../domain/app-backend/errors.js';

export type AppUser = { readonly id: string; readonly email: string };
export type AppSession = { readonly user: AppUser; readonly token: string };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

// Пароль: scrypt с случайной солью. Формат хранения `salt:hash` (hex). Встроенный crypto, без деп.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const orig = Buffer.from(hash, 'hex');
  const test = scryptSync(password, salt, 64);
  return test.length === orig.length && timingSafeEqual(test, orig);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type Deps = {
  readonly appDb: AppDatabaseStore;
  readonly idGen: () => string;
  readonly now: () => Date;
};

// Авторизация ЭНД-ЮЗЕРОВ приложения (отдельных от аккаунтов ProjectsFlow). Серверные сессии:
// клиенту отдаём случайный токен, в _sessions храним его SHA-256 + срок. Ревокабельно, без JWT-деп.
export class AppAuthService {
  constructor(private readonly deps: Deps) {}

  private toUser(row: Row): AppUser {
    return { id: String(row.id), email: String(row.email) };
  }

  private createSession(projectId: string, userId: string): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(this.deps.now().getTime() + SESSION_TTL_MS).toISOString();
    this.deps.appDb.insert(projectId, '_sessions', {
      token_hash: hashToken(token),
      user_id: userId,
      expires_at: expiresAt,
    });
    return token;
  }

  signUp(projectId: string, email: string, password: string): AppSession {
    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !password) throw new AppAuthError('email and password required');
    if (this.deps.appDb.findOne(projectId, '_users', { email: normEmail })) {
      throw new AppUserExistsError();
    }
    const id = this.deps.idGen();
    this.deps.appDb.insert(projectId, '_users', {
      id,
      email: normEmail,
      password_hash: hashPassword(password),
      created_at: this.deps.now().toISOString(),
    });
    return { user: { id, email: normEmail }, token: this.createSession(projectId, id) };
  }

  signIn(projectId: string, email: string, password: string): AppSession {
    const normEmail = email.trim().toLowerCase();
    const row = this.deps.appDb.findOne(projectId, '_users', { email: normEmail });
    if (!row || !verifyPassword(password, String(row.password_hash))) {
      throw new AppAuthError();
    }
    return { user: this.toUser(row), token: this.createSession(projectId, String(row.id)) };
  }

  verify(projectId: string, token: string): AppUser | null {
    if (!token) return null;
    const session = this.deps.appDb.findOne(projectId, '_sessions', { token_hash: hashToken(token) });
    if (!session) return null;
    if (new Date(String(session.expires_at)).getTime() < this.deps.now().getTime()) return null;
    const user = this.deps.appDb.findOne(projectId, '_users', { id: session.user_id });
    return user ? this.toUser(user) : null;
  }

  signOut(projectId: string, token: string): void {
    if (!token) return;
    this.deps.appDb.removeWhere(projectId, '_sessions', { token_hash: hashToken(token) });
  }
}

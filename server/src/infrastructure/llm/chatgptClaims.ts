import type { LlmAccountInfo } from '../../domain/llm/LlmConnection.js';

// Разбор JWT-токенов ChatGPT (без проверки подписи: токены получены напрямую у провайдера
// по TLS и нужны только для чтения полей). Бэкенд Codex требует account id отдельным
// заголовком ChatGPT-Account-ID — иначе отвечает 401.

const AUTH_CLAIM = 'https://api.openai.com/auth';
const PROFILE_CLAIM = 'https://api.openai.com/profile';

export function readJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function claimObject(claims: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = claims?.[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// Сведения об аккаунте из access- и id-токена: account id, email, тариф, срок access-токена.
export function chatgptAccountInfo(accessToken: string, idToken: string | null): LlmAccountInfo {
  const access = readJwtClaims(accessToken);
  const id = readJwtClaims(idToken);
  const accessAuth = claimObject(access, AUTH_CLAIM);
  const idAuth = claimObject(id, AUTH_CLAIM);
  const profile = claimObject(access, PROFILE_CLAIM);
  const exp = access?.['exp'];
  return {
    accountId: str(accessAuth?.['chatgpt_account_id']) ?? str(idAuth?.['chatgpt_account_id']),
    email: str(id?.['email']) ?? str(profile?.['email']) ?? str(access?.['email']),
    planType: str(idAuth?.['chatgpt_plan_type']) ?? str(accessAuth?.['chatgpt_plan_type']),
    accessExpiresAt: typeof exp === 'number' ? new Date(exp * 1000) : null,
  };
}

import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import type { GoogleIdentity, GoogleOAuthProvider } from '../../application/app-backend/AppAuthService.js';

// Инфраструктурный адаптер Google OAuth: обмен authorization code на токены (token endpoint) и
// криптопроверка id_token (RS256 по JWKS Google). Ходит в сеть — потому живёт в infrastructure, а
// в тестах подменяется фейком через порт GoogleOAuthProvider. Наружу отдаёт ТОЛЬКО проверенную
// личность (sub/email/email_verified); access/refresh токены Google остаются здесь и не хранятся.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const JWKS_TTL_MS = 60 * 60 * 1000; // ключи Google ротируются нечасто — кешируем на час.
const FETCH_TIMEOUT_MS = 8_000;

type Jwk = { readonly kid?: string; readonly kty?: string; readonly alg?: string; readonly n?: string; readonly e?: string };
type JwtHeader = { readonly alg?: string; readonly kid?: string };
type IdTokenClaims = {
  readonly iss?: string;
  readonly aud?: string;
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean | string;
  readonly exp?: number;
};

export class HttpGoogleOAuthProvider implements GoogleOAuthProvider {
  private jwksCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;

  async exchangeAndVerify(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<GoogleIdentity> {
    const idToken = await this.exchangeCode(input);
    const claims = await this.verifyIdToken(idToken, input.clientId);
    return {
      sub: String(claims.sub ?? ''),
      email: String(claims.email ?? ''),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    };
  }

  private async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<string> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    });
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!response.ok) throw new Error(`google token endpoint ${response.status}`);
    const json = (await response.json()) as { id_token?: unknown };
    if (typeof json.id_token !== 'string' || !json.id_token) throw new Error('google response missing id_token');
    return json.id_token;
  }

  // Проверка id_token: RS256-подпись по JWKS, затем iss/aud/exp. Любое несоответствие — throw.
  private async verifyIdToken(idToken: string, clientId: string): Promise<IdTokenClaims> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('malformed id_token');
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as JwtHeader;
    if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected id_token alg');

    const key = await this.publicKey(header.kid);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(signatureB64, 'base64url'))) {
      throw new Error('id_token signature invalid');
    }

    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as IdTokenClaims;
    if (!claims.iss || !VALID_ISSUERS.has(claims.iss)) throw new Error('id_token iss invalid');
    if (claims.aud !== clientId) throw new Error('id_token aud mismatch');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('id_token expired');
    return claims;
  }

  private async publicKey(kid: string): Promise<KeyObject> {
    if (!this.jwksCache || Date.now() - this.jwksCache.fetchedAt > JWKS_TTL_MS || !this.jwksCache.keys.has(kid)) {
      await this.refreshJwks();
    }
    const key = this.jwksCache?.keys.get(kid);
    if (!key) throw new Error('signing key not found in JWKS');
    return key;
  }

  private async refreshJwks(): Promise<void> {
    const response = await fetch(JWKS_URI, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`google JWKS ${response.status}`);
    const json = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of json.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
      keys.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }));
    }
    this.jwksCache = { keys, fetchedAt: Date.now() };
  }
}

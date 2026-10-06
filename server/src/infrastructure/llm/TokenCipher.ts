import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';
const PLAIN_PREFIX = 'plain:';

// Шифрование токенов LLM-провайдера в БД: AES-256-GCM, ключ = SHA-256(LLM_TOKEN_KEY).
// Без ключа токены хранятся как 'plain:…' (как остальные секреты платформы сейчас).
// Потеря или смена ключа не фатальна: decrypt вернёт null, подключение уйдёт в
// reauth_required, и админ войдёт по коду заново.
export class TokenCipher {
  private readonly key: Buffer | null;

  constructor(secret: string | null | undefined) {
    const trimmed = secret?.trim() ?? '';
    this.key = trimmed.length > 0 ? createHash('sha256').update(trimmed, 'utf8').digest() : null;
  }

  get encrypting(): boolean {
    return this.key !== null;
  }

  encrypt(plain: string): string {
    if (!this.key) return PLAIN_PREFIX + plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  decrypt(stored: string): string | null {
    if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
    if (!stored.startsWith(ENC_PREFIX) || !this.key) return null;
    const [ivB, tagB, ctB] = stored.slice(ENC_PREFIX.length).split('.');
    if (!ivB || !tagB || ctB === undefined) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ctB, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}

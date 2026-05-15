import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  SecretCipherCorruptedError,
  SecretsVaultDisabledError,
} from '../../domain/secrets/errors.js';
import type { SecretsCipher } from '../../application/secrets/SecretsCipher.js';

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12;  // GCM standard
const TAG_BYTES = 16;

export class AesGcmSecretCipher implements SecretsCipher {
  private readonly key: Buffer;

  constructor(masterKeyBase64: string | null | undefined) {
    if (!masterKeyBase64) throw new SecretsVaultDisabledError();
    const buf = Buffer.from(masterKeyBase64, 'base64');
    if (buf.length !== KEY_BYTES) {
      throw new SecretsVaultDisabledError();
    }
    this.key = buf;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  decrypt(packed: string): string {
    const buf = Buffer.from(packed, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) throw new SecretCipherCorruptedError();
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretCipherCorruptedError();
    }
  }
}

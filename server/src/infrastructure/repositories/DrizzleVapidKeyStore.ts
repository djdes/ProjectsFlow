import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type {
  StoredVapidKeys,
  VapidKeyPair,
  VapidKeyStore,
} from '../../application/push/VapidKeyProvider.js';

// Private key encryption: the same format as the LLM subscription tokens (TokenCipher).
type Cipher = {
  encrypt(plain: string): string;
  decrypt(stored: string): string | null;
};

// Server VAPID keys in web_push_vapid_keys (db/184): a single row with id = 1.
export class DrizzleVapidKeyStore implements VapidKeyStore {
  constructor(
    private readonly db: Database,
    private readonly cipher: Cipher,
  ) {}

  async load(): Promise<StoredVapidKeys> {
    const result = await this.db.execute(sql`
      SELECT public_key, private_key FROM web_push_vapid_keys WHERE id = 1`);
    const row = (result[0] as unknown as Array<{ public_key: string; private_key: string }>)[0];
    if (!row) return { status: 'missing' };
    const privateKey = this.cipher.decrypt(String(row.private_key));
    if (!privateKey) return { status: 'unreadable' };
    return { status: 'ok', keys: { publicKey: String(row.public_key), privateKey } };
  }

  async createIfAbsent(keys: VapidKeyPair): Promise<StoredVapidKeys> {
    await this.db.execute(sql`
      INSERT IGNORE INTO web_push_vapid_keys (id, public_key, private_key)
      VALUES (1, ${keys.publicKey}, ${this.cipher.encrypt(keys.privateKey)})`);
    return this.load();
  }

  async replace(keys: VapidKeyPair): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO web_push_vapid_keys (id, public_key, private_key)
      VALUES (1, ${keys.publicKey}, ${this.cipher.encrypt(keys.privateKey)})
      ON DUPLICATE KEY UPDATE
        public_key = VALUES(public_key), private_key = VALUES(private_key), created_at = CURRENT_TIMESTAMP`);
  }
}

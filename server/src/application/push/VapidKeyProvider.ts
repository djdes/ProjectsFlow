export type VapidKeyPair = {
  readonly publicKey: string;
  readonly privateKey: string;
};

// unreadable: a row exists but its private key cannot be decrypted (the encryption secret changed).
export type StoredVapidKeys =
  | { readonly status: 'ok'; readonly keys: VapidKeyPair }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable' };

// Port for the server key pair (db/184, web_push_vapid_keys). The implementation encrypts and
// decrypts the private key itself; the application only sees the plain pair.
export interface VapidKeyStore {
  load(): Promise<StoredVapidKeys>;
  // Stores the pair only when no keys exist yet and returns what the store holds afterwards:
  // two racing requests end up with the same pair.
  createIfAbsent(keys: VapidKeyPair): Promise<StoredVapidKeys>;
  replace(keys: VapidKeyPair): Promise<void>;
}

export interface VapidKeyGenerator {
  generate(): VapidKeyPair;
}

type Deps = {
  readonly store: VapidKeyStore;
  readonly generator: VapidKeyGenerator;
  // VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from the environment: when both are set, the store is unused.
  readonly env?: { readonly publicKey?: string | undefined; readonly privateKey?: string | undefined };
  // Called when an unreadable pair had to be replaced: device subscriptions are bound to the
  // previous public key and will not accept pushes any more.
  readonly onRotated: () => Promise<void>;
  readonly log?: (message: string) => void;
};

// The server VAPID keys. Works on prod without configuration: the pair is generated on first
// use and stored in the DB. The result is cached per process; a failed attempt is not.
export class VapidKeyProvider {
  private pending: Promise<VapidKeyPair> | null = null;

  constructor(private readonly deps: Deps) {}

  get(): Promise<VapidKeyPair> {
    const publicKey = this.deps.env?.publicKey?.trim();
    const privateKey = this.deps.env?.privateKey?.trim();
    if (publicKey && privateKey) return Promise.resolve({ publicKey, privateKey });
    if (!this.pending) {
      this.pending = this.resolve().catch((error: unknown) => {
        this.pending = null;
        throw error;
      });
    }
    return this.pending;
  }

  private async resolve(): Promise<VapidKeyPair> {
    const stored = await this.deps.store.load();
    if (stored.status === 'ok') return stored.keys;
    if (stored.status === 'missing') {
      const created = await this.deps.store.createIfAbsent(this.deps.generator.generate());
      if (created.status === 'ok') return created.keys;
    }
    const fresh = this.deps.generator.generate();
    await this.deps.store.replace(fresh);
    await this.deps.onRotated();
    this.deps.log?.('[push] VAPID private key could not be decrypted: generated a new pair, device subscriptions were reset');
    return fresh;
  }
}

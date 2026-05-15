# KB Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать knowledge base в виде GitHub-репо для каждого проекта, с криптованным secret-storage и web UI для просмотра/редактирования. Search и webhook — отдельная Phase 3 (optional).

**Architecture:** Source of truth = `<slug>-kb` репо в личном GitHub юзера. Backend — тонкий слой над GitHub Contents API: валидация frontmatter, секреты в нашей БД (AES-GCM), Meilisearch как deriv. индекс. UI — file-tree + viewer + form-based editor с секретными полями.

**Tech Stack:** Drizzle ORM, mysql2, Node `crypto` (AES-256-GCM), `gray-matter` (frontmatter), `react-markdown`+`remark-gfm`, Meilisearch (Phase 3).

**Scope decomposition:** Phase 1 (secrets storage) и Phase 2 (KB core read/write) — обе production-ready независимо. Phase 3 (search + webhook) — enhancement. Каждая фаза заканчивается smoke-test'ом и commit'ом, можно остановиться после любой.

**Testing note:** В проекте сейчас нет тестов (deferred). Этот план не вводит test-инфру. Каждая задача завершается typecheck/lint/build + ручной smoke-test через API или UI. Тесты добавим отдельным планом.

---

## File Structure

### Server (new files)

```
server/src/
├── domain/
│   ├── kb/
│   │   ├── KbDocument.ts
│   │   ├── Frontmatter.ts
│   │   └── errors.ts
│   └── secrets/
│       └── errors.ts
├── application/
│   ├── kb/
│   │   ├── KbRepository.ts
│   │   ├── FrontmatterValidator.ts
│   │   ├── InitKbRepo.ts
│   │   ├── ConnectKbRepo.ts
│   │   ├── DisconnectKb.ts
│   │   ├── ListKbDocuments.ts
│   │   ├── GetKbDocument.ts
│   │   ├── WriteKbDocument.ts
│   │   └── DeleteKbDocument.ts
│   └── secrets/
│       ├── SecretsCipher.ts          (port)
│       ├── SecretsRepository.ts      (port)
│       ├── PutSecret.ts
│       ├── GetSecret.ts
│       ├── DeleteSecret.ts
│       └── ListSecretKeys.ts
├── infrastructure/
│   ├── crypto/
│   │   └── AesGcmSecretCipher.ts
│   ├── kb/
│   │   └── GithubKbRepository.ts
│   └── repositories/
│       └── DrizzleSecretsRepository.ts
├── presentation/
│   ├── kb/
│   │   ├── routes.ts
│   │   └── schemas.ts
│   └── secrets/
│       ├── routes.ts
│       └── schemas.ts
└── templates/
    └── kb/
        ├── README.md.tpl
        └── folder-readme.md.tpl
```

### Server (modified)

```
server/src/
├── infrastructure/db/schema.ts          (add: secrets, projects.kbRepoFullName)
├── application/github/GithubApiClient.ts (add: createRepo, getRepoContent, putRepoContent, deleteRepoContent)
├── infrastructure/github/FetchGithubApiClient.ts (impl new methods)
├── presentation/http.ts                  (wire kb + secrets routers)
├── presentation/projects/routes.ts       (add KB endpoints: init/connect/disconnect)
├── presentation/projects/schemas.ts      (add KB schemas)
├── presentation/config.ts                (add SECRETS_MASTER_KEY)
├── presentation/middleware/errorHandler.ts (add KB + Secret errors)
└── index.ts                              (wire new use-cases + cipher)
```

### Client (new files)

```
client/src/
├── domain/kb/
│   ├── KbDocument.ts
│   └── errors.ts
├── application/kb/
│   └── KbRepository.ts
├── application/secrets/
│   └── SecretsRepository.ts
├── infrastructure/http/
│   ├── HttpKbRepository.ts
│   └── HttpSecretsRepository.ts
├── presentation/
│   ├── pages/KbPage.tsx
│   ├── hooks/
│   │   ├── useKbTree.ts
│   │   └── useKbDocument.ts
│   └── components/
│       ├── kb/
│       │   ├── KbSection.tsx           (на странице проекта)
│       │   ├── KbFileTree.tsx
│       │   ├── KbDocumentViewer.tsx
│       │   ├── KbDocumentEditor.tsx
│       │   └── ConnectKbDialog.tsx
│       └── secrets/
│           └── SecretField.tsx
```

### Client (modified)

```
client/src/
├── infrastructure/di/container.tsx     (wire KbRepository + SecretsRepository)
├── presentation/pages/ProjectPage.tsx  (вставить <KbSection />)
└── presentation/app/routes.tsx         (добавить /projects/:projectId/kb)
```

---

## Phase 1 — Secrets storage (independent feature)

### Task 1: Generate SECRETS_MASTER_KEY + add to .env

**Files:**
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: Сгенерировать ключ**

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Скопировать вывод (44-символьная base64-строка).

- [ ] **Step 2: Записать в .env**

В `.env` добавить (под секцией `--- Session ---`):

```
# --- Secrets vault (AES-256-GCM) ---
# 32-байтный ключ в base64. Сгенерировать:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
SECRETS_MASTER_KEY=<вставить сгенерированное значение>
```

- [ ] **Step 3: Обновить .env.example**

Тот же блок без значения:

```
SECRETS_MASTER_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore(env): add SECRETS_MASTER_KEY placeholder"
```

`.env` НЕ коммитим (gitignored).

---

### Task 2: DB migration — secrets table

**Files:**
- Modify: `server/src/infrastructure/db/schema.ts`

- [ ] **Step 1: Добавить таблицу в схему**

В конце `schema.ts` (после `userGithubTokens`):

```ts
export const secrets = mysqlTable(
  'secrets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    secretKey: varchar('secret_key', { length: 500 }).notNull(),
    encrypted: varchar('encrypted', { length: 2000 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_secrets_user_key').on(t.userId, t.secretKey),
    index('idx_secrets_user').on(t.userId),
  ],
);

export type SecretRow = typeof secrets.$inferSelect;
export type NewSecretRow = typeof secrets.$inferInsert;
```

- [ ] **Step 2: Push schema в БД**

```powershell
Set-Location 'C:\www\ProjectsFlow\server'
$env:DATABASE_URL = 'mysql://projectsflow:fIN7ip0jMrXtGnF2T1XZrCP0YCLWWnnX@127.0.0.1:3306/projectsflow'
npx drizzle-kit push --config=drizzle.config.ts --force
```

Expected: `[✓] Changes applied` с `CREATE TABLE secrets`.

- [ ] **Step 3: Verify**

```powershell
mysql -u projectsflow -pfIN7ip0jMrXtGnF2T1XZrCP0YCLWWnnX projectsflow -e "DESCRIBE secrets;"
```

Expected: 6 колонок (id, user_id, secret_key, encrypted, created_at, updated_at).

- [ ] **Step 4: Commit**

```bash
git add server/src/infrastructure/db/schema.ts
git commit -m "feat(db): add secrets table for encrypted vault"
```

---

### Task 3: Domain errors + ports

**Files:**
- Create: `server/src/domain/secrets/errors.ts`
- Create: `server/src/application/secrets/SecretsCipher.ts`
- Create: `server/src/application/secrets/SecretsRepository.ts`

- [ ] **Step 1: domain/secrets/errors.ts**

```ts
export class SecretNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Secret with key "${key}" not found`);
    this.name = 'SecretNotFoundError';
  }
}

export class SecretKeyInvalidError extends Error {
  constructor(public readonly key: string) {
    super(`Invalid secret key format: "${key}"`);
    this.name = 'SecretKeyInvalidError';
  }
}

export class SecretsVaultDisabledError extends Error {
  constructor() {
    super('Secrets vault is not configured (set SECRETS_MASTER_KEY)');
    this.name = 'SecretsVaultDisabledError';
  }
}

export class SecretCipherCorruptedError extends Error {
  constructor() {
    super('Failed to decrypt secret (auth tag mismatch or corrupted data)');
    this.name = 'SecretCipherCorruptedError';
  }
}
```

- [ ] **Step 2: application/secrets/SecretsCipher.ts**

```ts
export interface SecretsCipher {
  encrypt(plain: string): string;   // returns base64(iv || ciphertext || authTag)
  decrypt(packed: string): string;  // reverses; throws on tamper
}
```

- [ ] **Step 3: application/secrets/SecretsRepository.ts**

```ts
import type { SecretsCipher } from './SecretsCipher.js';

export type StoredSecret = {
  readonly id: string;
  readonly userId: string;
  readonly secretKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export interface SecretsRepository {
  // Шифрование делается ВНУТРИ репо через переданный cipher.
  upsert(userId: string, key: string, value: string, cipher: SecretsCipher): Promise<void>;
  // Возвращает расшифрованное значение или null.
  getValue(userId: string, key: string, cipher: SecretsCipher): Promise<string | null>;
  delete(userId: string, key: string): Promise<boolean>;
  listKeys(userId: string): Promise<StoredSecret[]>;
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/domain/secrets/ server/src/application/secrets/
git commit -m "feat(secrets): domain errors + cipher/repo ports"
```

---

### Task 4: AesGcmSecretCipher implementation

**Files:**
- Create: `server/src/infrastructure/crypto/AesGcmSecretCipher.ts`

- [ ] **Step 1: Реализация**

```ts
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
```

- [ ] **Step 2: Smoke test через node REPL**

```powershell
node -e "
const { AesGcmSecretCipher } = require('./server/dist/infrastructure/crypto/AesGcmSecretCipher.js');
const c = new AesGcmSecretCipher(require('crypto').randomBytes(32).toString('base64'));
const enc = c.encrypt('hello world');
console.log('encrypted:', enc.slice(0, 20) + '...');
console.log('decrypted:', c.decrypt(enc));
"
```

Сначала надо собрать: `npm run build:server`. Expected: `decrypted: hello world`.

- [ ] **Step 3: Commit**

```bash
git add server/src/infrastructure/crypto/AesGcmSecretCipher.ts
git commit -m "feat(secrets): AES-256-GCM cipher implementation"
```

---

### Task 5: DrizzleSecretsRepository + use-cases

**Files:**
- Create: `server/src/infrastructure/repositories/DrizzleSecretsRepository.ts`
- Create: `server/src/application/secrets/PutSecret.ts`
- Create: `server/src/application/secrets/GetSecret.ts`
- Create: `server/src/application/secrets/DeleteSecret.ts`
- Create: `server/src/application/secrets/ListSecretKeys.ts`

- [ ] **Step 1: Repository**

```ts
// DrizzleSecretsRepository.ts
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { secrets, type SecretRow } from '../db/schema.js';
import type {
  SecretsRepository,
  StoredSecret,
} from '../../application/secrets/SecretsRepository.js';
import type { SecretsCipher } from '../../application/secrets/SecretsCipher.js';

function toStored(row: SecretRow): StoredSecret {
  return {
    id: row.id,
    userId: row.userId,
    secretKey: row.secretKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleSecretsRepository implements SecretsRepository {
  constructor(private readonly db: Database) {}

  async upsert(userId: string, key: string, value: string, cipher: SecretsCipher): Promise<void> {
    const enc = cipher.encrypt(value);
    const existing = await this.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)))
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(secrets)
        .set({ encrypted: enc })
        .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)));
    } else {
      await this.db.insert(secrets).values({
        id: randomUUID(),
        userId,
        secretKey: key,
        encrypted: enc,
      });
    }
  }

  async getValue(userId: string, key: string, cipher: SecretsCipher): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return cipher.decrypt(row.encrypted);
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const res = await this.db
      .delete(secrets)
      .where(and(eq(secrets.userId, userId), eq(secrets.secretKey, key)));
    const affected = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async listKeys(userId: string): Promise<StoredSecret[]> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(eq(secrets.userId, userId));
    return rows.map(toStored);
  }
}
```

- [ ] **Step 2: Use-cases**

`PutSecret.ts`:

```ts
import { SecretKeyInvalidError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';
import type { SecretsCipher } from './SecretsCipher.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class PutSecret {
  constructor(
    private readonly repo: SecretsRepository,
    private readonly cipher: SecretsCipher,
  ) {}

  async execute(userId: string, key: string, value: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    if (value.length === 0) throw new SecretKeyInvalidError('empty value');
    await this.repo.upsert(userId, key, value, this.cipher);
  }
}
```

`GetSecret.ts`:

```ts
import { SecretKeyInvalidError, SecretNotFoundError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';
import type { SecretsCipher } from './SecretsCipher.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class GetSecret {
  constructor(
    private readonly repo: SecretsRepository,
    private readonly cipher: SecretsCipher,
  ) {}

  async execute(userId: string, key: string): Promise<string> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    const value = await this.repo.getValue(userId, key, this.cipher);
    if (value === null) throw new SecretNotFoundError(key);
    return value;
  }
}
```

`DeleteSecret.ts`:

```ts
import { SecretKeyInvalidError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class DeleteSecret {
  constructor(private readonly repo: SecretsRepository) {}

  async execute(userId: string, key: string): Promise<boolean> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    return this.repo.delete(userId, key);
  }
}
```

`ListSecretKeys.ts`:

```ts
import type { SecretsRepository, StoredSecret } from './SecretsRepository.js';

export class ListSecretKeys {
  constructor(private readonly repo: SecretsRepository) {}

  execute(userId: string): Promise<StoredSecret[]> {
    return this.repo.listKeys(userId);
  }
}
```

- [ ] **Step 3: Build**

```powershell
npm run build:server
```

Expected: чистая сборка.

- [ ] **Step 4: Commit**

```bash
git add server/src/infrastructure/repositories/DrizzleSecretsRepository.ts server/src/application/secrets/
git commit -m "feat(secrets): repository + use-cases (put/get/delete/list)"
```

---

### Task 6: Secrets routes + container wiring

**Files:**
- Create: `server/src/presentation/secrets/schemas.ts`
- Create: `server/src/presentation/secrets/routes.ts`
- Modify: `server/src/presentation/middleware/errorHandler.ts`
- Modify: `server/src/presentation/config.ts`
- Modify: `server/src/presentation/http.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: schemas.ts**

```ts
import { z } from 'zod';

const keySchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/, {
  message: 'Format: project-slug/file-slug/field_name (lowercase, digits, dashes, underscores in last segment)',
});

export const putSecretSchema = z.object({
  key: keySchema,
  value: z.string().min(1).max(10000),
});

export const secretKeyQuerySchema = z.object({
  key: keySchema,
});

export type PutSecretBody = z.infer<typeof putSecretSchema>;
```

- [ ] **Step 2: routes.ts**

```ts
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PutSecret } from '../../application/secrets/PutSecret.js';
import type { GetSecret } from '../../application/secrets/GetSecret.js';
import type { DeleteSecret } from '../../application/secrets/DeleteSecret.js';
import type { ListSecretKeys } from '../../application/secrets/ListSecretKeys.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { putSecretSchema, secretKeyQuerySchema } from './schemas.js';

type Deps = {
  readonly putSecret: PutSecret;
  readonly getSecret: GetSecret;
  readonly deleteSecret: DeleteSecret;
  readonly listSecretKeys: ListSecretKeys;
};

export function secretsRouter(deps: Deps): Router {
  const router = Router();
  router.use(requireAuth);

  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = putSecretSchema.parse(req.body);
      await deps.putSecret.execute(req.user!.id, body.key, body.value);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = secretKeyQuerySchema.parse(req.query);
      const value = await deps.getSecret.execute(req.user!.id, key);
      res.json({ value });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = secretKeyQuerySchema.parse(req.query);
      const deleted = await deps.deleteSecret.execute(req.user!.id, key);
      res.status(deleted ? 204 : 404).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await deps.listSecretKeys.execute(req.user!.id);
      res.json({
        secrets: list.map((s) => ({
          key: s.secretKey,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
```

- [ ] **Step 3: errorHandler — добавить Secret errors**

В `errorHandler.ts` после блока ProjectNotFoundError:

```ts
import {
  SecretCipherCorruptedError,
  SecretKeyInvalidError,
  SecretNotFoundError,
  SecretsVaultDisabledError,
} from '../../domain/secrets/errors.js';

// ...

if (err instanceof SecretNotFoundError) {
  res.status(404).json({ error: 'secret_not_found' });
  return;
}
if (err instanceof SecretKeyInvalidError) {
  res.status(400).json({ error: 'secret_key_invalid', message: err.message });
  return;
}
if (err instanceof SecretsVaultDisabledError) {
  res.status(503).json({
    error: 'secrets_vault_disabled',
    message: 'Secrets vault не настроен на сервере (нет SECRETS_MASTER_KEY).',
  });
  return;
}
if (err instanceof SecretCipherCorruptedError) {
  console.error('[errorHandler] secret cipher corrupted — master key changed?', err);
  res.status(500).json({ error: 'secret_cipher_corrupted' });
  return;
}
```

- [ ] **Step 4: config.ts — добавить secretsMasterKey**

```ts
export const config = {
  // ...existing
  secrets: {
    masterKey: process.env.SECRETS_MASTER_KEY ?? null,
  },
} as const;
```

- [ ] **Step 5: http.ts — wire secretsRouter**

Добавить import:
```ts
import { secretsRouter } from './secrets/routes.js';
import type { PutSecret } from '../application/secrets/PutSecret.js';
import type { GetSecret } from '../application/secrets/GetSecret.js';
import type { DeleteSecret } from '../application/secrets/DeleteSecret.js';
import type { ListSecretKeys } from '../application/secrets/ListSecretKeys.js';
```

Добавить в AppDeps:
```ts
readonly secrets: {
  readonly putSecret: PutSecret;
  readonly getSecret: GetSecret;
  readonly deleteSecret: DeleteSecret;
  readonly listSecretKeys: ListSecretKeys;
};
```

Добавить mount после `/api/integrations/github`:
```ts
app.use('/api/secrets', secretsRouter(deps.secrets));
```

- [ ] **Step 6: index.ts — composition**

Добавить imports:
```ts
import { AesGcmSecretCipher } from './infrastructure/crypto/AesGcmSecretCipher.js';
import { DrizzleSecretsRepository } from './infrastructure/repositories/DrizzleSecretsRepository.js';
import { PutSecret } from './application/secrets/PutSecret.js';
import { GetSecret } from './application/secrets/GetSecret.js';
import { DeleteSecret } from './application/secrets/DeleteSecret.js';
import { ListSecretKeys } from './application/secrets/ListSecretKeys.js';
```

Инициализация (с graceful fallback если нет ключа — log warning, secrets endpoints will 503 через cipher constructor):

```ts
let secretsCipher: AesGcmSecretCipher | null = null;
try {
  secretsCipher = new AesGcmSecretCipher(config.secrets.masterKey);
  console.log('[projectsflow] secrets vault: enabled');
} catch {
  console.warn('[projectsflow] secrets vault: DISABLED (set SECRETS_MASTER_KEY)');
}

const secretsRepo = new DrizzleSecretsRepository(db);
// Если cipher null — use-cases вернут 503 при первом вызове через ленивую проверку.
// Простейший fallback — создать noop cipher и проверять в use-case'е. Но удобнее: бросать SecretsVaultDisabledError сразу.
// Для простоты: создаём use-cases только если cipher есть. Если нет — endpoints всё равно регистрируются, но cipher null — обработать.

const stubCipher: SecretsCipher = {
  encrypt: () => { throw new SecretsVaultDisabledError(); },
  decrypt: () => { throw new SecretsVaultDisabledError(); },
};
const activeCipher = secretsCipher ?? stubCipher;
```

Импортировать `SecretsVaultDisabledError` и `SecretsCipher`. Добавить в createApp:

```ts
secrets: {
  putSecret: new PutSecret(secretsRepo, activeCipher),
  getSecret: new GetSecret(secretsRepo, activeCipher),
  deleteSecret: new DeleteSecret(secretsRepo),
  listSecretKeys: new ListSecretKeys(secretsRepo),
},
```

- [ ] **Step 7: Build + smoke test**

```powershell
npm run build:server
```

Перезапустить server (TaskStop старый + npm run dev:server).

Smoke test через PowerShell:

```powershell
$base = 'http://localhost:4317/api'
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -Body (@{email='oleg@example.com';password='supersecret'}|ConvertTo-Json) -ContentType 'application/json' -WebSession $sess

# Put
Invoke-WebRequest -Uri "$base/secrets" -Method PUT -Body (@{key='scanflow/prod-db/password'; value='hunter2'}|ConvertTo-Json) -ContentType 'application/json' -WebSession $sess

# Get
(Invoke-WebRequest -Uri "$base/secrets?key=scanflow/prod-db/password" -WebSession $sess).Content
# Expected: {"value":"hunter2"}

# List
(Invoke-WebRequest -Uri "$base/secrets/list" -WebSession $sess).Content
# Expected: один ключ

# Delete
Invoke-WebRequest -Uri "$base/secrets?key=scanflow/prod-db/password" -Method DELETE -WebSession $sess
# Expected: 204
```

- [ ] **Step 8: Commit**

```bash
git add server/src/presentation/secrets/ server/src/presentation/middleware/errorHandler.ts server/src/presentation/config.ts server/src/presentation/http.ts server/src/index.ts
git commit -m "feat(secrets): HTTP routes + container wiring"
```

**🎯 Checkpoint: Phase 1 complete.** Secrets vault работает end-to-end. Можно остановиться, протестировать руками.

---

## Phase 2 — KB core (read/write)

### Task 7: DB migration — projects.kb_repo_full_name

**Files:**
- Modify: `server/src/infrastructure/db/schema.ts`

- [ ] **Step 1: Добавить колонку**

В `projects`-таблице, после `gitRepoUrl`:

```ts
kbRepoFullName: varchar('kb_repo_full_name', { length: 255 }),
```

- [ ] **Step 2: Push schema**

```powershell
Set-Location 'C:\www\ProjectsFlow\server'
$env:DATABASE_URL = 'mysql://projectsflow:fIN7ip0jMrXtGnF2T1XZrCP0YCLWWnnX@127.0.0.1:3306/projectsflow'
npx drizzle-kit push --config=drizzle.config.ts --force
```

Expected: `ALTER TABLE projects ADD kb_repo_full_name varchar(255)`.

- [ ] **Step 3: Update Project domain + ProjectRepository + repos**

В `server/src/domain/project/Project.ts`:

```ts
export type Project = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;   // NEW
  readonly createdAt: Date;
};
```

В `DrizzleProjectRepository.toProject`:

```ts
return {
  id: row.id,
  ownerId: row.ownerId,
  name: row.name,
  status: row.status as ProjectStatus,
  gitRepoUrl: row.gitRepoUrl ?? null,
  kbRepoFullName: row.kbRepoFullName ?? null,   // NEW
  createdAt: row.createdAt,
};
```

В `UpdateProjectInput` в `server/src/application/project/ProjectRepository.ts`:

```ts
export type UpdateProjectInput = {
  readonly name?: string;
  readonly gitRepoUrl?: string | null;
  readonly kbRepoFullName?: string | null;   // NEW
};
```

В `DrizzleProjectRepository.update` (set-объект):

```ts
if (patch.kbRepoFullName !== undefined) set.kbRepoFullName = patch.kbRepoFullName;
```

- [ ] **Step 4: Client-side mirror**

В `client/src/domain/project/Project.ts` — добавить `kbRepoFullName: string | null`.
В `client/src/infrastructure/http/HttpProjectRepository.ts` — добавить поле в `ProjectDto` и `fromDto`.

- [ ] **Step 5: Build + verify**

```powershell
npm run build:server
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add server/src/infrastructure/db/schema.ts server/src/domain/project/Project.ts server/src/application/project/ProjectRepository.ts server/src/infrastructure/repositories/DrizzleProjectRepository.ts client/src/domain/project/Project.ts client/src/infrastructure/http/HttpProjectRepository.ts
git commit -m "feat(db): add projects.kb_repo_full_name column"
```

---

### Task 8: KB domain types

**Files:**
- Create: `server/src/domain/kb/KbDocument.ts`
- Create: `server/src/domain/kb/Frontmatter.ts`
- Create: `server/src/domain/kb/errors.ts`

- [ ] **Step 1: Frontmatter.ts**

```ts
export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[] | { [k: string]: FrontmatterValue };

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

export type KbDocumentType = 'credential' | 'decision' | 'service' | 'schema' | 'runbook' | 'note';

export const KB_FOLDERS: Record<KbDocumentType, string> = {
  credential: 'credentials',
  decision: 'decisions',
  service: 'services',
  schema: 'schemas',
  runbook: 'runbooks',
  note: 'notes',
};
```

- [ ] **Step 2: KbDocument.ts**

```ts
import type { Frontmatter } from './Frontmatter.js';

export type ValidationError = {
  readonly code: string;
  readonly message: string;
};

export type KbDocument = {
  readonly path: string;             // "credentials/prod-db.md"
  readonly frontmatter: Frontmatter;
  readonly body: string;             // markdown без --- блоков
  readonly raw: string;              // полный исходник
  readonly sha: string | null;       // GitHub blob SHA (нужен для update)
  readonly validationErrors: readonly ValidationError[];
};

export type KbDocumentSummary = Omit<KbDocument, 'body' | 'raw'>;
```

- [ ] **Step 3: errors.ts**

```ts
export class KbNotConnectedError extends Error {
  constructor() {
    super('Project does not have a KB repo connected');
    this.name = 'KbNotConnectedError';
  }
}

export class KbRepoAlreadyConnectedError extends Error {
  constructor() {
    super('Project already has a KB repo');
    this.name = 'KbRepoAlreadyConnectedError';
  }
}

export class KbDocumentNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`KB document not found: ${path}`);
    this.name = 'KbDocumentNotFoundError';
  }
}

export class FrontmatterInvalidError extends Error {
  constructor(public readonly errors: readonly { code: string; message: string }[]) {
    super(`Frontmatter validation failed: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'FrontmatterInvalidError';
  }
}

export class KbRepoConflictError extends Error {
  constructor() {
    super('KB document was modified concurrently (SHA mismatch)');
    this.name = 'KbRepoConflictError';
  }
}
```

- [ ] **Step 4: Build + commit**

```powershell
npm run build:server
```

```bash
git add server/src/domain/kb/
git commit -m "feat(kb): domain types + errors"
```

---

### Task 9: FrontmatterValidator (pure)

**Files:**
- Create: `server/src/application/kb/FrontmatterValidator.ts`

- [ ] **Step 1: Implementation**

```ts
import type { Frontmatter, KbDocumentType } from '../../domain/kb/Frontmatter.js';
import type { ValidationError } from '../../domain/kb/KbDocument.js';

const VALID_TYPES = new Set<KbDocumentType>([
  'credential', 'decision', 'service', 'schema', 'runbook', 'note',
]);

const REF_KEY_RE = /_ref$/;
const VAULT_VALUE_RE = /^vault:\/\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

// Простая эвристика для «голого секрета» в body или frontmatter-значении:
// (a) ≥32 символа hex или base64-ish без пробелов, (b) контекст «password:»/«token:».
const LIKELY_SECRET_RE = /(password|token|api[-_]?key|secret)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/i;

export function validateFrontmatter(
  fm: Frontmatter,
  body: string,
): readonly ValidationError[] {
  const errors: ValidationError[] = [];

  const type = fm['type'];
  if (typeof type !== 'string') {
    errors.push({ code: 'type_missing', message: 'frontmatter must have type field' });
    return errors;
  }
  if (!VALID_TYPES.has(type as KbDocumentType)) {
    errors.push({ code: 'type_invalid', message: `unknown type "${type}"` });
  }

  const title = fm['title'];
  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push({ code: 'title_missing', message: 'frontmatter must have non-empty title' });
  }

  if (type === 'credential') {
    const refKeys = Object.keys(fm).filter((k) => REF_KEY_RE.test(k));
    if (refKeys.length === 0) {
      errors.push({
        code: 'credential_no_ref',
        message: 'credential must have at least one *_ref field (e.g. password_ref: vault://...)',
      });
    }
    for (const k of refKeys) {
      const v = fm[k];
      if (typeof v !== 'string' || !VAULT_VALUE_RE.test(v)) {
        errors.push({
          code: 'ref_format',
          message: `${k} must be vault://<project>/<file>/<field>, got "${String(v)}"`,
        });
      }
    }

    // Проверка на голый секрет в body или в other-frontmatter-полях
    if (LIKELY_SECRET_RE.test(body)) {
      errors.push({
        code: 'naked_secret_in_body',
        message: 'body looks to contain a raw secret — use vault:// reference instead',
      });
    }
    for (const [k, v] of Object.entries(fm)) {
      if (REF_KEY_RE.test(k)) continue;
      if (typeof v === 'string' && LIKELY_SECRET_RE.test(`${k}: ${v}`)) {
        errors.push({
          code: 'naked_secret_in_frontmatter',
          message: `frontmatter "${k}" looks like a raw secret — use ${k}_ref: vault://...`,
        });
      }
    }
  }

  return errors;
}
```

- [ ] **Step 2: Build + commit**

```bash
git add server/src/application/kb/FrontmatterValidator.ts
git commit -m "feat(kb): frontmatter validator (L1 minimum rules)"
```

---

### Task 10: KbRepository port + extend GithubApiClient

**Files:**
- Create: `server/src/application/kb/KbRepository.ts`
- Modify: `server/src/application/github/GithubApiClient.ts`
- Modify: `server/src/infrastructure/github/FetchGithubApiClient.ts`

- [ ] **Step 1: KbRepository port**

```ts
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';

export type CreateKbRepoInput = {
  readonly accessToken: string;
  readonly name: string;          // "<slug>-kb"
  readonly description: string;
};

export type CreateKbRepoResult = {
  readonly fullName: string;      // "owner/repo"
};

export type ListInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly folder?: string;       // если указан — только этот префикс
};

export type ReadInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly path: string;
};

export type WriteInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly path: string;
  readonly content: string;       // полный исходник md (frontmatter+body)
  readonly message: string;
  readonly sha: string | null;    // null для создания, иначе existing blob sha
};

export interface KbRepository {
  createRepo(input: CreateKbRepoInput): Promise<CreateKbRepoResult>;
  initFolders(accessToken: string, fullName: string): Promise<void>;
  listAll(input: ListInput): Promise<KbDocumentSummary[]>;
  readOne(input: ReadInput): Promise<KbDocument | null>;
  write(input: WriteInput): Promise<{ sha: string }>;
  delete(input: ReadInput & { sha: string; message: string }): Promise<void>;
  exists(accessToken: string, fullName: string): Promise<boolean>;
}
```

- [ ] **Step 2: Расширить GithubApiClient port**

Добавить в `application/github/GithubApiClient.ts`:

```ts
export type CreateRepoInput = {
  readonly name: string;
  readonly description?: string;
  readonly privateRepo: boolean;
  readonly autoInit: boolean;
};

export type CreateRepoResult = {
  readonly fullName: string;
  readonly htmlUrl: string;
};

export type RepoFileContent = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;      // декодированный из base64
  readonly size: number;
};

export type RepoFileSummary = {
  readonly path: string;
  readonly sha: string;
  readonly type: 'file' | 'dir';
  readonly size: number;
};

export type PutFileInput = {
  readonly accessToken: string;
  readonly owner: string;
  readonly repo: string;
  readonly path: string;
  readonly content: string;       // plain, мы encode'нем
  readonly message: string;
  readonly sha?: string;          // для update
};

// Добавить методы в interface GithubApiClient:
createRepo(accessToken: string, input: CreateRepoInput): Promise<CreateRepoResult>;
repoExists(accessToken: string, fullName: string): Promise<boolean>;
getRepoFile(accessToken: string, fullName: string, path: string): Promise<RepoFileContent | null>;
listRepoTree(accessToken: string, fullName: string, path?: string): Promise<RepoFileSummary[]>;
putRepoFile(input: PutFileInput): Promise<{ sha: string }>;
deleteRepoFile(accessToken: string, fullName: string, path: string, sha: string, message: string): Promise<void>;
```

- [ ] **Step 3: Реализовать в FetchGithubApiClient**

В `FetchGithubApiClient.ts` добавить методы:

```ts
async createRepo(accessToken: string, input: CreateRepoInput): Promise<CreateRepoResult> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      private: input.privateRepo,
      auto_init: input.autoInit,
    }),
  });
  if (!res.ok) throw new GithubApiError(res.status, `createRepo failed: ${await res.text()}`);
  const data = (await res.json()) as { full_name: string; html_url: string };
  return { fullName: data.full_name, htmlUrl: data.html_url };
}

async repoExists(accessToken: string, fullName: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  return res.status === 200;
}

async getRepoFile(accessToken: string, fullName: string, path: string): Promise<RepoFileContent | null> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubApiError(res.status, `getRepoFile failed: ${await res.text()}`);
  const data = (await res.json()) as { path: string; sha: string; size: number; content: string; encoding: string };
  if (data.encoding !== 'base64') throw new GithubApiError(500, `unexpected encoding ${data.encoding}`);
  return {
    path: data.path,
    sha: data.sha,
    size: data.size,
    content: Buffer.from(data.content, 'base64').toString('utf8'),
  };
}

async listRepoTree(accessToken: string, fullName: string, path = ''): Promise<RepoFileSummary[]> {
  const url = path
    ? `https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`
    : `https://api.github.com/repos/${fullName}/contents`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new GithubApiError(res.status, `listRepoTree failed: ${await res.text()}`);
  const data = (await res.json()) as Array<{ path: string; sha: string; type: string; size: number }>;
  return data.map((d) => ({
    path: d.path,
    sha: d.sha,
    type: d.type === 'dir' ? 'dir' : 'file',
    size: d.size,
  }));
}

async putRepoFile(input: PutFileInput): Promise<{ sha: string }> {
  const body: Record<string, unknown> = {
    message: input.message,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
  };
  if (input.sha) body.sha = input.sha;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${encodeURI(input.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new GithubApiError(409, 'sha conflict');
  if (!res.ok) throw new GithubApiError(res.status, `putRepoFile failed: ${await res.text()}`);
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

async deleteRepoFile(accessToken: string, fullName: string, path: string, sha: string, message: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sha }),
  });
  if (!res.ok) throw new GithubApiError(res.status, `deleteRepoFile failed: ${await res.text()}`);
}
```

- [ ] **Step 4: Build + commit**

```bash
git add server/src/application/kb/KbRepository.ts server/src/application/github/GithubApiClient.ts server/src/infrastructure/github/FetchGithubApiClient.ts
git commit -m "feat(github): repo CRUD methods (create/exists/get/list/put/delete)"
```

---

### Task 11: GithubKbRepository implementation + npm dep `gray-matter`

**Files:**
- Modify: `server/package.json`
- Create: `server/src/infrastructure/kb/GithubKbRepository.ts`

- [ ] **Step 1: Install gray-matter**

```powershell
Set-Location 'C:\www\ProjectsFlow\server'
npm install gray-matter
```

- [ ] **Step 2: GithubKbRepository**

```ts
import matter from 'gray-matter';
import type { GithubApiClient } from '../../application/github/GithubApiClient.js';
import type {
  KbRepository,
  CreateKbRepoInput,
  CreateKbRepoResult,
  ListInput,
  ReadInput,
  WriteInput,
} from '../../application/kb/KbRepository.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from '../../application/kb/FrontmatterValidator.js';
import { KB_FOLDERS } from '../../domain/kb/Frontmatter.js';

function parseFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`invalid fullName: ${fullName}`);
  return { owner, repo };
}

const FOLDER_README_BODY = (folder: string): string =>
  `# ${folder}\n\nЗаметки в этой папке должны иметь \`type: ${folderToType(folder)}\` в frontmatter.\n`;

function folderToType(folder: string): string {
  const inv = Object.entries(KB_FOLDERS).find(([, v]) => v === folder);
  return inv?.[0] ?? 'note';
}

const ROOT_README = `# Project Knowledge Base

Этот репо создан ProjectsFlow как операционная тетрадь проекта.

## Структура

- \`credentials/\` — типизированные креды (mysql, ssh, api-keys). Реальные значения через \`vault://\` references.
- \`decisions/\` — ADR'ы: почему выбрали X.
- \`services/\` — компоненты системы.
- \`schemas/\` — диаграммы (ER, mermaid).
- \`runbooks/\` — как починить/задеплоить.
- \`notes/\` — свободная форма.

## Frontmatter

Все файлы — markdown с YAML-frontmatter. Минимум: \`type\` и \`title\`.
\`credential\`-файлы дополнительно требуют поле \`*_ref: vault://...\` для секретов.
`;

export class GithubKbRepository implements KbRepository {
  constructor(private readonly api: GithubApiClient) {}

  async createRepo(input: CreateKbRepoInput): Promise<CreateKbRepoResult> {
    const result = await this.api.createRepo(input.accessToken, {
      name: input.name,
      description: input.description,
      privateRepo: true,
      autoInit: true,
    });
    return { fullName: result.fullName };
  }

  async initFolders(accessToken: string, fullName: string): Promise<void> {
    const { owner, repo } = parseFullName(fullName);

    // Root README
    await this.api.putRepoFile({
      accessToken, owner, repo, path: 'README.md',
      content: ROOT_README,
      message: 'chore(kb): initial README',
    });

    for (const folder of Object.values(KB_FOLDERS)) {
      await this.api.putRepoFile({
        accessToken, owner, repo, path: `${folder}/README.md`,
        content: FOLDER_README_BODY(folder),
        message: `chore(kb): init ${folder}/`,
      });
    }
  }

  async exists(accessToken: string, fullName: string): Promise<boolean> {
    return this.api.repoExists(accessToken, fullName);
  }

  async listAll(input: ListInput): Promise<KbDocumentSummary[]> {
    const result: KbDocumentSummary[] = [];
    const queue: string[] = input.folder ? [input.folder] : Object.values(KB_FOLDERS);

    while (queue.length > 0) {
      const folder = queue.shift()!;
      const items = await this.api.listRepoTree(input.accessToken, input.fullName, folder);
      for (const item of items) {
        if (item.type === 'dir') {
          queue.push(item.path);
        } else if (item.path.endsWith('.md') && !item.path.endsWith('/README.md')) {
          const file = await this.api.getRepoFile(input.accessToken, input.fullName, item.path);
          if (!file) continue;
          const parsed = matter(file.content);
          const fm = parsed.data as Frontmatter;
          const errors = validateFrontmatter(fm, parsed.content);
          result.push({
            path: item.path,
            frontmatter: fm,
            sha: file.sha,
            validationErrors: errors,
          });
        }
      }
    }

    return result;
  }

  async readOne(input: ReadInput): Promise<KbDocument | null> {
    const file = await this.api.getRepoFile(input.accessToken, input.fullName, input.path);
    if (!file) return null;
    const parsed = matter(file.content);
    const fm = parsed.data as Frontmatter;
    return {
      path: file.path,
      frontmatter: fm,
      body: parsed.content,
      raw: file.content,
      sha: file.sha,
      validationErrors: validateFrontmatter(fm, parsed.content),
    };
  }

  async write(input: WriteInput): Promise<{ sha: string }> {
    const { owner, repo } = parseFullName(input.fullName);
    return this.api.putRepoFile({
      accessToken: input.accessToken,
      owner, repo,
      path: input.path,
      content: input.content,
      message: input.message,
      sha: input.sha ?? undefined,
    });
  }

  async delete(input: ReadInput & { sha: string; message: string }): Promise<void> {
    await this.api.deleteRepoFile(
      input.accessToken,
      input.fullName,
      input.path,
      input.sha,
      input.message,
    );
  }
}
```

- [ ] **Step 3: Build**

```powershell
npm run build:server
```

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/src/infrastructure/kb/
git commit -m "feat(kb): GithubKbRepository + gray-matter dep"
```

---

### Task 12: KB use-cases

**Files:**
- Create: `server/src/application/kb/InitKbRepo.ts`
- Create: `server/src/application/kb/ConnectKbRepo.ts`
- Create: `server/src/application/kb/DisconnectKb.ts`
- Create: `server/src/application/kb/ListKbDocuments.ts`
- Create: `server/src/application/kb/GetKbDocument.ts`
- Create: `server/src/application/kb/WriteKbDocument.ts`
- Create: `server/src/application/kb/DeleteKbDocument.ts`

- [ ] **Step 1: InitKbRepo + ConnectKbRepo + DisconnectKb**

```ts
// InitKbRepo.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbRepoAlreadyConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

function slugify(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'project';
}

export class InitKbRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<{ fullName: string }> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (project.kbRepoFullName) throw new KbRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();

    const slug = slugify(project.name);
    const repoName = `${slug}-kb`;
    const description = `ProjectsFlow knowledge base for ${project.name}`;

    const { fullName } = await this.deps.kb.createRepo({
      accessToken: token.accessToken, name: repoName, description,
    });
    await this.deps.kb.initFolders(token.accessToken, fullName);

    await this.deps.projects.update(projectId, ownerUserId, { kbRepoFullName: fullName });

    return { fullName };
  }
}
```

```ts
// ConnectKbRepo.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbRepoAlreadyConnectedError, KbDocumentNotFoundError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class ConnectKbRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, fullName: string): Promise<void> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (project.kbRepoFullName) throw new KbRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();

    const exists = await this.deps.kb.exists(token.accessToken, fullName);
    if (!exists) throw new KbDocumentNotFoundError(fullName);

    await this.deps.projects.update(projectId, ownerUserId, { kbRepoFullName: fullName });
  }
}
```

```ts
// DisconnectKb.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

export class DisconnectKb {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(projectId: string, ownerUserId: string): Promise<void> {
    const project = await this.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    await this.projects.update(projectId, ownerUserId, { kbRepoFullName: null });
  }
}
```

- [ ] **Step 2: ListKbDocuments + GetKbDocument**

```ts
// ListKbDocuments.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { KbDocumentSummary } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class ListKbDocuments {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<KbDocumentSummary[]> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();
    return this.deps.kb.listAll({ accessToken: token.accessToken, fullName: project.kbRepoFullName });
  }
}
```

```ts
// GetKbDocument.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { KbDocument } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class GetKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, path: string): Promise<KbDocument> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();
    const doc = await this.deps.kb.readOne({
      accessToken: token.accessToken, fullName: project.kbRepoFullName, path,
    });
    if (!doc) throw new KbDocumentNotFoundError(path);
    return doc;
  }
}
```

- [ ] **Step 3: WriteKbDocument + DeleteKbDocument**

```ts
// WriteKbDocument.ts
import matter from 'gray-matter';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { FrontmatterInvalidError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from './FrontmatterValidator.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export type WriteKbDocumentInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly sha: string | null;
};

export class WriteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(input: WriteKbDocumentInput): Promise<{ sha: string }> {
    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.userId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();

    const errors = validateFrontmatter(input.frontmatter, input.body);
    if (errors.length > 0) throw new FrontmatterInvalidError(errors);

    const token = await this.deps.tokens.getWithTokenByUserId(input.userId);
    if (!token) throw new GithubNotConnectedError();

    const content = matter.stringify(input.body, input.frontmatter as Record<string, unknown>);

    return this.deps.kb.write({
      accessToken: token.accessToken,
      fullName: project.kbRepoFullName,
      path: input.path,
      content,
      message: `chore(kb): update ${input.path} via ProjectsFlow UI`,
      sha: input.sha,
    });
  }
}
```

```ts
// DeleteKbDocument.ts
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class DeleteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, path: string): Promise<void> {
    const project = await this.deps.projects.getByIdForOwner(projectId, userId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(userId);
    if (!token) throw new GithubNotConnectedError();

    const existing = await this.deps.kb.readOne({
      accessToken: token.accessToken, fullName: project.kbRepoFullName, path,
    });
    if (!existing || !existing.sha) throw new KbDocumentNotFoundError(path);

    await this.deps.kb.delete({
      accessToken: token.accessToken,
      fullName: project.kbRepoFullName,
      path, sha: existing.sha,
      message: `chore(kb): delete ${path} via ProjectsFlow UI`,
    });
  }
}
```

- [ ] **Step 4: Build + commit**

```powershell
npm run build:server
```

```bash
git add server/src/application/kb/
git commit -m "feat(kb): use-cases (init/connect/disconnect/list/get/write/delete)"
```

---

### Task 13: KB HTTP routes + errorHandler

**Files:**
- Create: `server/src/presentation/kb/schemas.ts`
- Create: `server/src/presentation/kb/routes.ts`
- Modify: `server/src/presentation/middleware/errorHandler.ts`

- [ ] **Step 1: schemas.ts**

```ts
import { z } from 'zod';

export const fullNameSchema = z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, {
  message: 'Format: owner/repo',
});

export const connectKbSchema = z.object({
  fullName: fullNameSchema,
});

export const pathSchema = z.string().regex(/^[a-z0-9_./-]+\.md$/i, {
  message: 'Path must be lowercase, end with .md',
});

export const writeDocSchema = z.object({
  path: pathSchema,
  frontmatter: z.record(z.unknown()),
  body: z.string().max(500_000),
  sha: z.string().nullable(),
});

export type ConnectKbBody = z.infer<typeof connectKbSchema>;
export type WriteDocBody = z.infer<typeof writeDocSchema>;
```

- [ ] **Step 2: routes.ts**

```ts
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { InitKbRepo } from '../../application/kb/InitKbRepo.js';
import type { ConnectKbRepo } from '../../application/kb/ConnectKbRepo.js';
import type { DisconnectKb } from '../../application/kb/DisconnectKb.js';
import type { ListKbDocuments } from '../../application/kb/ListKbDocuments.js';
import type { GetKbDocument } from '../../application/kb/GetKbDocument.js';
import type { WriteKbDocument } from '../../application/kb/WriteKbDocument.js';
import type { DeleteKbDocument } from '../../application/kb/DeleteKbDocument.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { connectKbSchema, writeDocSchema } from './schemas.js';

type Deps = {
  readonly initKbRepo: InitKbRepo;
  readonly connectKbRepo: ConnectKbRepo;
  readonly disconnectKb: DisconnectKb;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly writeKbDocument: WriteKbDocument;
  readonly deleteKbDocument: DeleteKbDocument;
};

function summaryToDto(s: KbDocumentSummary) {
  return { path: s.path, frontmatter: s.frontmatter, sha: s.sha, validationErrors: s.validationErrors };
}
function docToDto(d: KbDocument) {
  return {
    path: d.path,
    frontmatter: d.frontmatter,
    body: d.body,
    sha: d.sha,
    validationErrors: d.validationErrors,
  };
}

export function kbRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.post('/init', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deps.initKbRepo.execute(req.params.projectId!, req.user!.id);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post('/connect', async (req, res, next) => {
    try {
      const body = connectKbSchema.parse(req.body);
      await deps.connectKbRepo.execute(req.params.projectId!, req.user!.id, body.fullName);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.delete('/', async (req, res, next) => {
    try {
      await deps.disconnectKb.execute(req.params.projectId!, req.user!.id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.get('/tree', async (req, res, next) => {
    try {
      const list = await deps.listKbDocuments.execute(req.params.projectId!, req.user!.id);
      res.json({ documents: list.map(summaryToDto) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/documents/*', async (req, res, next) => {
    try {
      const path = (req.params[0] ?? '') as string;
      const doc = await deps.getKbDocument.execute(req.params.projectId!, req.user!.id, path);
      res.json({ document: docToDto(doc) });
    } catch (e) {
      next(e);
    }
  });

  router.put('/documents/*', async (req, res, next) => {
    try {
      const body = writeDocSchema.parse({ ...req.body, path: req.params[0] });
      const result = await deps.writeKbDocument.execute({
        projectId: req.params.projectId!,
        userId: req.user!.id,
        path: body.path,
        frontmatter: body.frontmatter,
        body: body.body,
        sha: body.sha,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/documents/*', async (req, res, next) => {
    try {
      const path = (req.params[0] ?? '') as string;
      await deps.deleteKbDocument.execute(req.params.projectId!, req.user!.id, path);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
```

- [ ] **Step 3: errorHandler — добавить KB errors**

В `errorHandler.ts` добавить import + блоки:

```ts
import {
  FrontmatterInvalidError,
  KbDocumentNotFoundError,
  KbNotConnectedError,
  KbRepoAlreadyConnectedError,
  KbRepoConflictError,
} from '../../domain/kb/errors.js';

// ...

if (err instanceof KbNotConnectedError) {
  res.status(409).json({ error: 'kb_not_connected', message: 'У проекта нет привязанного KB-репо' });
  return;
}
if (err instanceof KbRepoAlreadyConnectedError) {
  res.status(409).json({ error: 'kb_already_connected' });
  return;
}
if (err instanceof KbDocumentNotFoundError) {
  res.status(404).json({ error: 'kb_doc_not_found' });
  return;
}
if (err instanceof FrontmatterInvalidError) {
  res.status(422).json({ error: 'frontmatter_invalid', details: err.errors });
  return;
}
if (err instanceof KbRepoConflictError) {
  res.status(409).json({ error: 'kb_conflict' });
  return;
}
```

- [ ] **Step 4: Build + commit**

```bash
git add server/src/presentation/kb/ server/src/presentation/middleware/errorHandler.ts
git commit -m "feat(kb): HTTP routes + error mapping"
```

---

### Task 14: Wire KB into http.ts + index.ts + smoke test

**Files:**
- Modify: `server/src/presentation/http.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: http.ts — добавить KbRouter**

```ts
import { kbRouter } from './kb/routes.js';
// ... types for use-cases

// в AppDeps:
readonly kb: {
  readonly initKbRepo: InitKbRepo;
  readonly connectKbRepo: ConnectKbRepo;
  readonly disconnectKb: DisconnectKb;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly writeKbDocument: WriteKbDocument;
  readonly deleteKbDocument: DeleteKbDocument;
};

// в createApp, после mount projectsRouter:
app.use('/api/projects/:projectId/kb', kbRouter(deps.kb));
```

- [ ] **Step 2: index.ts — composition**

```ts
import { GithubKbRepository } from './infrastructure/kb/GithubKbRepository.js';
import { InitKbRepo } from './application/kb/InitKbRepo.js';
import { ConnectKbRepo } from './application/kb/ConnectKbRepo.js';
import { DisconnectKb } from './application/kb/DisconnectKb.js';
import { ListKbDocuments } from './application/kb/ListKbDocuments.js';
import { GetKbDocument } from './application/kb/GetKbDocument.js';
import { WriteKbDocument } from './application/kb/WriteKbDocument.js';
import { DeleteKbDocument } from './application/kb/DeleteKbDocument.js';

// после githubApi:
const kbRepo = new GithubKbRepository(githubApi);

// в createApp деп:
kb: {
  initKbRepo: new InitKbRepo({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
  connectKbRepo: new ConnectKbRepo({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
  disconnectKb: new DisconnectKb(projectRepo),
  listKbDocuments: new ListKbDocuments({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
  getKbDocument: new GetKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
  writeKbDocument: new WriteKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
  deleteKbDocument: new DeleteKbDocument({ projects: projectRepo, tokens: githubTokenRepo, kb: kbRepo }),
},
```

- [ ] **Step 3: Build + restart server**

```powershell
npm run build:server
# TaskStop old server task, npm run dev:server
```

- [ ] **Step 4: Smoke test через API**

```powershell
$base = 'http://localhost:4317/api'
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -Body (@{email='oleg@example.com';password='supersecret'}|ConvertTo-Json) -ContentType 'application/json' -WebSession $sess

# Берём project id первого проекта
$projectId = (((Invoke-WebRequest -Uri "$base/projects" -WebSession $sess).Content | ConvertFrom-Json).projects)[0].id

# Init KB (создаст репо в GitHub юзера — это реальная операция!)
Invoke-WebRequest -Uri "$base/projects/$projectId/kb/init" -Method POST -WebSession $sess

# Tree
(Invoke-WebRequest -Uri "$base/projects/$projectId/kb/tree" -WebSession $sess).Content
# Expected: список с README.md в каждой папке (validationErrors: пустые — наши README'ы простые без frontmatter, но они отфильтрованы)

# Write
$body = @{
  path = 'notes/first.md'
  frontmatter = @{ type='note'; title='First note' }
  body = 'Hello world'
  sha = $null
} | ConvertTo-Json
Invoke-WebRequest -Uri "$base/projects/$projectId/kb/documents/notes/first.md" -Method PUT -Body $body -ContentType 'application/json' -WebSession $sess

# Read
(Invoke-WebRequest -Uri "$base/projects/$projectId/kb/documents/notes/first.md" -WebSession $sess).Content
```

ВНИМАНИЕ: этот тест **реально создаёт репо в твоём GitHub**. Если не хочешь — пропусти, тестируй потом через UI.

- [ ] **Step 5: Commit**

```bash
git add server/src/presentation/http.ts server/src/index.ts
git commit -m "feat(kb): wire routes + use-cases into composition root"
```

**🎯 Checkpoint: Server-side KB ready end-to-end через API.** Client'у можно ходить.

---

### Task 15: Client domain + http repositories

**Files:**
- Create: `client/src/domain/kb/KbDocument.ts`
- Create: `client/src/domain/kb/errors.ts`
- Create: `client/src/application/kb/KbRepository.ts`
- Create: `client/src/application/secrets/SecretsRepository.ts`
- Create: `client/src/infrastructure/http/HttpKbRepository.ts`
- Create: `client/src/infrastructure/http/HttpSecretsRepository.ts`
- Modify: `client/src/infrastructure/di/container.tsx`

- [ ] **Step 1: domain/kb/KbDocument.ts + errors.ts**

```ts
// KbDocument.ts
export type Frontmatter = Readonly<Record<string, unknown>>;

export type ValidationError = { readonly code: string; readonly message: string };

export type KbDocumentSummary = {
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly sha: string | null;
  readonly validationErrors: readonly ValidationError[];
};

export type KbDocument = KbDocumentSummary & {
  readonly body: string;
};
```

```ts
// errors.ts
export class KbNotConnectedError extends Error {
  constructor() { super('KB not connected'); this.name = 'KbNotConnectedError'; }
}
export class KbDocumentNotFoundError extends Error {
  constructor() { super('KB document not found'); this.name = 'KbDocumentNotFoundError'; }
}
export class FrontmatterInvalidError extends Error {
  constructor(public readonly errors: readonly { code: string; message: string }[]) {
    super('Frontmatter invalid'); this.name = 'FrontmatterInvalidError';
  }
}
```

- [ ] **Step 2: KbRepository port**

```ts
import type { Frontmatter, KbDocument, KbDocumentSummary } from '@/domain/kb/KbDocument';

export interface KbRepository {
  initRepo(projectId: string): Promise<{ fullName: string }>;
  connectRepo(projectId: string, fullName: string): Promise<void>;
  disconnect(projectId: string): Promise<void>;
  list(projectId: string): Promise<KbDocumentSummary[]>;
  get(projectId: string, path: string): Promise<KbDocument>;
  write(projectId: string, path: string, frontmatter: Frontmatter, body: string, sha: string | null): Promise<{ sha: string }>;
  delete(projectId: string, path: string): Promise<void>;
}
```

- [ ] **Step 3: SecretsRepository port**

```ts
export type StoredSecretKey = {
  readonly key: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export interface SecretsRepository {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  list(): Promise<StoredSecretKey[]>;
}
```

- [ ] **Step 4: HttpKbRepository**

```ts
import type { Frontmatter, KbDocument, KbDocumentSummary } from '@/domain/kb/KbDocument';
import type { KbRepository } from '@/application/kb/KbRepository';
import { httpClient } from './httpClient';

export class HttpKbRepository implements KbRepository {
  async initRepo(projectId: string): Promise<{ fullName: string }> {
    return httpClient.post<{ fullName: string }>(`/projects/${projectId}/kb/init`);
  }
  async connectRepo(projectId: string, fullName: string): Promise<void> {
    await httpClient.post<void>(`/projects/${projectId}/kb/connect`, { fullName });
  }
  async disconnect(projectId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/kb`);
  }
  async list(projectId: string): Promise<KbDocumentSummary[]> {
    const { documents } = await httpClient.get<{ documents: KbDocumentSummary[] }>(
      `/projects/${projectId}/kb/tree`,
    );
    return documents;
  }
  async get(projectId: string, path: string): Promise<KbDocument> {
    const { document } = await httpClient.get<{ document: KbDocument }>(
      `/projects/${projectId}/kb/documents/${path}`,
    );
    return document;
  }
  async write(projectId: string, path: string, frontmatter: Frontmatter, body: string, sha: string | null): Promise<{ sha: string }> {
    return httpClient.put<{ sha: string }>(
      `/projects/${projectId}/kb/documents/${path}`,
      { frontmatter, body, sha },
    );
  }
  async delete(projectId: string, path: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/kb/documents/${path}`);
  }
}
```

- [ ] **Step 5: HttpSecretsRepository**

```ts
import type { SecretsRepository, StoredSecretKey } from '@/application/secrets/SecretsRepository';
import { httpClient } from './httpClient';

export class HttpSecretsRepository implements SecretsRepository {
  async put(key: string, value: string): Promise<void> {
    await httpClient.put<void>('/secrets', { key, value });
  }
  async get(key: string): Promise<string> {
    const { value } = await httpClient.get<{ value: string }>(`/secrets?key=${encodeURIComponent(key)}`);
    return value;
  }
  async delete(key: string): Promise<void> {
    await httpClient.delete<void>(`/secrets?key=${encodeURIComponent(key)}`);
  }
  async list(): Promise<StoredSecretKey[]> {
    const { secrets } = await httpClient.get<{ secrets: { key: string; createdAt: string; updatedAt: string }[] }>('/secrets/list');
    return secrets.map((s) => ({
      key: s.key,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }));
  }
}
```

- [ ] **Step 6: Wire в container**

Добавить в container.tsx:

```ts
import { HttpKbRepository } from '@/infrastructure/http/HttpKbRepository';
import { HttpSecretsRepository } from '@/infrastructure/http/HttpSecretsRepository';
import type { KbRepository } from '@/application/kb/KbRepository';
import type { SecretsRepository } from '@/application/secrets/SecretsRepository';

// в Container type:
kbRepository: KbRepository;
secretsRepository: SecretsRepository;

// в buildContainer:
const kbRepo = new HttpKbRepository();
const secretsRepo = new HttpSecretsRepository();
// ...
kbRepository: kbRepo,
secretsRepository: secretsRepo,
```

- [ ] **Step 7: Typecheck + commit**

```powershell
npm run typecheck
```

```bash
git add client/src/domain/kb/ client/src/application/kb/ client/src/application/secrets/ client/src/infrastructure/http/HttpKbRepository.ts client/src/infrastructure/http/HttpSecretsRepository.ts client/src/infrastructure/di/container.tsx
git commit -m "feat(kb): client domain + http repos + DI wiring"
```

---

### Task 16: KB hooks

**Files:**
- Create: `client/src/presentation/hooks/useKbTree.ts`
- Create: `client/src/presentation/hooks/useKbDocument.ts`

- [ ] **Step 1: useKbTree**

```ts
import { useEffect, useState } from 'react';
import type { KbDocumentSummary } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';

export function useKbTree(projectId: string): {
  documents: KbDocumentSummary[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const { kbRepository } = useContainer();
  const [documents, setDocuments] = useState<KbDocumentSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    kbRepository.list(projectId)
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .catch((e: Error) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kbRepository, projectId, version]);

  return { documents, loading, error, reload: () => setVersion((v) => v + 1) };
}
```

- [ ] **Step 2: useKbDocument**

```ts
import { useEffect, useState } from 'react';
import type { KbDocument } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';

export function useKbDocument(projectId: string, path: string | null): {
  document: KbDocument | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const { kbRepository } = useContainer();
  const [document, setDocument] = useState<KbDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) { setDocument(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    kbRepository.get(projectId, path)
      .then((d) => { if (!cancelled) setDocument(d); })
      .catch((e: Error) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kbRepository, projectId, path, version]);

  return { document, loading, error, reload: () => setVersion((v) => v + 1) };
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/presentation/hooks/useKbTree.ts client/src/presentation/hooks/useKbDocument.ts
git commit -m "feat(kb): client hooks (useKbTree, useKbDocument)"
```

---

### Task 17: ConnectKbDialog + KbSection (на странице проекта)

**Files:**
- Create: `client/src/presentation/components/kb/ConnectKbDialog.tsx`
- Create: `client/src/presentation/components/kb/KbSection.tsx`
- Modify: `client/src/presentation/pages/ProjectPage.tsx`

- [ ] **Step 1: ConnectKbDialog**

```tsx
import { useState, type FormEvent } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onConnected: () => void;
};

export function ConnectKbDialog({ open, onOpenChange, projectId, onConnected }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await kbRepository.connectRepo(projectId, fullName.trim());
      toast.success('KB-репо подключён');
      onConnected();
      onOpenChange(false);
      setFullName('');
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось подключить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить существующий KB-репо</DialogTitle>
          <DialogDescription>
            Введи имя репо в формате owner/repo. Юзер должен иметь к нему доступ через свой GitHub.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">owner/repo</Label>
            <Input
              id="fullName"
              autoFocus
              placeholder="oleg/scanflow-kb"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={saving || fullName.trim().length === 0}>
              {saving ? 'Подключаем…' : 'Подключить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: KbSection**

```tsx
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { ConnectKbDialog } from './ConnectKbDialog';

type Props = { project: Project };

export function KbSection({ project }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const { submit: updateProject } = useUpdateProject();
  const { connection: githubConnection } = useGithubConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const handleInit = async (): Promise<void> => {
    setInitializing(true);
    try {
      const { fullName } = await kbRepository.initRepo(project.id);
      await updateProject(project.id, { kbRepoFullName: fullName });
      toast.success(`KB-репо создан: ${fullName}`);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось создать KB-репо');
    } finally {
      setInitializing(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    try {
      await kbRepository.disconnect(project.id);
      await updateProject(project.id, { kbRepoFullName: null });
      toast.success('KB отключён от проекта');
    } catch {
      toast.error('Не удалось отключить KB');
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <BookOpen className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">База знаний</CardTitle>
        </CardHeader>
        <CardContent>
          {project.kbRepoFullName ? (
            <div className="space-y-3">
              <a
                href={`https://github.com/${project.kbRepoFullName}`}
                target="_blank" rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 break-all font-mono text-sm text-primary hover:underline"
              >
                {project.kbRepoFullName}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <RouterLink to={`/projects/${project.id}/kb`}>Открыть KB</RouterLink>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDisconnect}
                  className="text-muted-foreground hover:text-destructive">
                  Отключить
                </Button>
              </div>
            </div>
          ) : !githubConnection ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Чтобы создать KB-репо, подключи GitHub-аккаунт в профиле.
              </p>
              <Button asChild variant="outline" size="sm">
                <RouterLink to="/profile">Перейти в профиль</RouterLink>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                База знаний — отдельный приватный GitHub-репо с операционными заметками проекта.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleInit} disabled={initializing}>
                  {initializing ? 'Создаём…' : 'Создать KB-репо'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                  Подключить существующий
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectKbDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        projectId={project.id}
        onConnected={() => { /* useUpdateProject не нужен — мы тянем через project refresh */ }}
      />
    </>
  );
}
```

- [ ] **Step 3: Вставить KbSection в ProjectPage**

В `ProjectPage.tsx` после `<RecentCommitsSection>` блока:

```tsx
import { KbSection } from '@/presentation/components/kb/KbSection';

// ...
<KbSection project={data} />
```

- [ ] **Step 4: Typecheck + commit**

```powershell
npm run typecheck
```

```bash
git add client/src/presentation/components/kb/ConnectKbDialog.tsx client/src/presentation/components/kb/KbSection.tsx client/src/presentation/pages/ProjectPage.tsx
git commit -m "feat(kb): KbSection card on ProjectPage + connect dialog"
```

---

### Task 18: KbPage route + shell + FileTree

**Files:**
- Create: `client/src/presentation/pages/KbPage.tsx`
- Create: `client/src/presentation/components/kb/KbFileTree.tsx`
- Modify: `client/src/presentation/app/routes.tsx`

- [ ] **Step 1: KbFileTree**

```tsx
import { FileWarning, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KbDocumentSummary } from '@/domain/kb/KbDocument';

type Props = {
  documents: KbDocumentSummary[];
  activePath: string | null;
  onPick: (path: string) => void;
};

const FOLDER_ORDER = ['credentials', 'decisions', 'services', 'schemas', 'runbooks', 'notes'];

function folderOf(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? 'notes' : path.slice(0, idx);
}

export function KbFileTree({ documents, activePath, onPick }: Props): React.ReactElement {
  const byFolder = new Map<string, KbDocumentSummary[]>();
  for (const d of documents) {
    const f = folderOf(d.path);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f)!.push(d);
  }

  const folders = [...FOLDER_ORDER];
  for (const f of byFolder.keys()) if (!folders.includes(f)) folders.push(f);

  return (
    <div className="space-y-3">
      {folders.map((folder) => {
        const items = byFolder.get(folder) ?? [];
        return (
          <div key={folder}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              <Folder className="size-3" />
              {folder}
            </div>
            <ul className="space-y-0.5">
              {items.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground/60">пусто</li>
              )}
              {items.map((d) => {
                const fileName = d.path.split('/').pop() ?? d.path;
                const title = (d.frontmatter.title as string) ?? fileName;
                return (
                  <li key={d.path}>
                    <button
                      type="button"
                      onClick={() => onPick(d.path)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                        activePath === d.path && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="flex-1 truncate">{title}</span>
                      {d.validationErrors.length > 0 && (
                        <FileWarning className="size-3.5 shrink-0 text-amber-500"
                          aria-label="invalid frontmatter" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: KbPage shell (только tree + viewer placeholder)**

```tsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProject } from '@/presentation/hooks/useProject';
import { useKbTree } from '@/presentation/hooks/useKbTree';
import { KbFileTree } from '@/presentation/components/kb/KbFileTree';

export function KbPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, loading: projectLoading } = useProject(projectId ?? '');
  const { documents, loading: treeLoading, error: treeError } = useKbTree(projectId ?? '');
  const [activePath, setActivePath] = useState<string | null>(null);

  if (projectLoading) return <div className="p-6">Загрузка…</div>;
  if (!project) return <div className="p-6">Проект не найден</div>;
  if (!project.kbRepoFullName) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">KB не подключён</h1>
          <p className="text-sm text-muted-foreground">Подключи KB-репо на странице проекта.</p>
          <Button asChild variant="outline">
            <Link to={`/projects/${project.id}`}>К проекту</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[280px_1fr] gap-0">
      <aside className="border-r p-3 overflow-y-auto">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 gap-1">
          <Link to={`/projects/${project.id}`}>
            <ArrowLeft className="size-3.5" />
            К проекту
          </Link>
        </Button>
        <p className="px-2 pb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {project.name} / KB
        </p>
        {treeLoading && <p className="px-2 text-sm text-muted-foreground">Загрузка дерева…</p>}
        {treeError && <p className="px-2 text-sm text-destructive">Не удалось загрузить дерево.</p>}
        {documents && (
          <KbFileTree documents={documents} activePath={activePath} onPick={setActivePath} />
        )}
      </aside>
      <main className="overflow-y-auto p-6">
        {activePath ? (
          <p className="text-sm text-muted-foreground">Viewer для <code>{activePath}</code> — в следующем коммите.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Выбери файл слева.</p>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: routes.tsx — добавить роут**

```tsx
import { KbPage } from '@/presentation/pages/KbPage';

// в children корневого роута, рядом с projects/:projectId:
{ path: 'projects/:projectId/kb', element: <KbPage /> },
```

- [ ] **Step 4: Typecheck + commit**

```powershell
npm run typecheck
```

```bash
git add client/src/presentation/pages/KbPage.tsx client/src/presentation/components/kb/KbFileTree.tsx client/src/presentation/app/routes.tsx
git commit -m "feat(kb): KbPage shell + FileTree + route"
```

---

### Task 19: KbDocumentViewer (markdown render) + dep

**Files:**
- Modify: `client/package.json`
- Create: `client/src/presentation/components/kb/KbDocumentViewer.tsx`
- Modify: `client/src/presentation/pages/KbPage.tsx`

- [ ] **Step 1: Install react-markdown + remark-gfm**

```powershell
Set-Location 'C:\www\ProjectsFlow\client'
npm install react-markdown remark-gfm
```

- [ ] **Step 2: KbDocumentViewer**

```tsx
import { Edit, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KbDocument } from '@/domain/kb/KbDocument';

type Props = {
  document: KbDocument;
  kbRepoFullName: string;
  onEdit: () => void;
};

function FrontmatterTable({ fm }: { fm: KbDocument['frontmatter'] }): React.ReactElement {
  const entries = Object.entries(fm);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Frontmatter</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
          {entries.map(([k, v]) => (
            <>
              <dt key={`k-${k}`} className="font-mono text-xs text-muted-foreground">{k}</dt>
              <dd key={`v-${k}`} className="font-mono text-xs break-all">{JSON.stringify(v)}</dd>
            </>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function KbDocumentViewer({ document, kbRepoFullName, onEdit }: Props): React.ReactElement {
  const githubUrl = `https://github.com/${kbRepoFullName}/blob/main/${document.path}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 truncate text-2xl font-semibold tracking-tight">
          {(document.frontmatter.title as string) ?? document.path}
        </h1>
        <Button size="sm" onClick={onEdit}>
          <Edit className="size-4" />
          Редактировать
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={githubUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="size-4" />
            На GitHub
          </a>
        </Button>
      </div>
      <p className="font-mono text-xs text-muted-foreground">{document.path}</p>

      {document.validationErrors.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="text-base text-amber-600 dark:text-amber-400">
              Frontmatter invalid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="ml-4 list-disc text-sm">
              {document.validationErrors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <FrontmatterTable fm={document.frontmatter} />

      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none py-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Подключить viewer в KbPage**

В `KbPage.tsx` заменить placeholder:

```tsx
import { useKbDocument } from '@/presentation/hooks/useKbDocument';
import { KbDocumentViewer } from '@/presentation/components/kb/KbDocumentViewer';

// в компоненте, после useKbTree:
const { document, loading: docLoading } = useKbDocument(projectId ?? '', activePath);

// в <main>:
{activePath && docLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
{activePath && document && (
  <KbDocumentViewer
    document={document}
    kbRepoFullName={project.kbRepoFullName!}
    onEdit={() => { /* следующая задача */ }}
  />
)}
{!activePath && <p className="text-sm text-muted-foreground">Выбери файл слева.</p>}
```

- [ ] **Step 4: Tailwind typography (опционально для нормального markdown)**

Если `prose`-классы не работают — установить `@tailwindcss/typography`:

```powershell
npm install -D @tailwindcss/typography
```

И в `tailwind.config.ts`:

```ts
plugins: [tailwindcssAnimate, require('@tailwindcss/typography')],
```

- [ ] **Step 5: Typecheck + commit**

```bash
git add client/package.json client/package-lock.json client/tailwind.config.ts client/src/presentation/components/kb/KbDocumentViewer.tsx client/src/presentation/pages/KbPage.tsx
git commit -m "feat(kb): document viewer with markdown render"
```

---

### Task 20: SecretField

**Files:**
- Create: `client/src/presentation/components/secrets/SecretField.tsx`

- [ ] **Step 1: SecretField**

```tsx
import { useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  fieldLabel: string;
  vaultRef: string;     // "vault://<project>/<file>/<field>"
  onChange?: (newValue: string | null) => void;  // null = delete
  editable?: boolean;
};

function parseVaultRef(ref: string): string | null {
  const m = ref.match(/^vault:\/\/(.+)$/);
  return m ? m[1] : null;
}

export function SecretField({ fieldLabel, vaultRef, onChange, editable = false }: Props): React.ReactElement {
  const { secretsRepository } = useContainer();
  const key = parseVaultRef(vaultRef);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState('');

  const handleReveal = async (): Promise<void> => {
    if (!key) { toast.error('Невалидный vault://-ref'); return; }
    if (revealed) { setRevealed(null); return; }
    setLoading(true);
    try {
      const value = await secretsRepository.get(key);
      setRevealed(value);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось получить секрет');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!revealed) {
      // Если не открыт — открываем и копируем
      if (!key) return;
      try {
        const value = await secretsRepository.get(key);
        await navigator.clipboard.writeText(value);
        toast.success('Скопировано');
      } catch {
        toast.error('Не удалось скопировать');
      }
      return;
    }
    await navigator.clipboard.writeText(revealed);
    toast.success('Скопировано');
  };

  const handleSave = async (): Promise<void> => {
    if (!key) return;
    setLoading(true);
    try {
      await secretsRepository.put(key, newValue);
      toast.success('Секрет обновлён');
      setEditing(false);
      setNewValue('');
      setRevealed(null);
      onChange?.(newValue);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>{fieldLabel}</Label>
      <p className="font-mono text-xs text-muted-foreground">{vaultRef}</p>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input type="password" value={newValue} onChange={(e) => setNewValue(e.target.value)} autoFocus />
          <Button size="sm" onClick={handleSave} disabled={loading || newValue.length === 0}>
            Сохранить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={revealed ? 'text' : 'password'}
            value={revealed ?? '••••••••'}
            readOnly
            className="font-mono"
          />
          <Button size="icon" variant="outline" onClick={handleReveal} disabled={loading} aria-label="Reveal">
            {revealed ? <EyeOff /> : <Eye />}
          </Button>
          <Button size="icon" variant="outline" onClick={handleCopy} disabled={loading} aria-label="Copy">
            <Copy />
          </Button>
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Изменить</Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add client/src/presentation/components/secrets/SecretField.tsx
git commit -m "feat(secrets): SecretField component (reveal/copy/edit)"
```

---

### Task 21: KbDocumentEditor (form + body)

**Files:**
- Create: `client/src/presentation/components/kb/KbDocumentEditor.tsx`
- Modify: `client/src/presentation/pages/KbPage.tsx`

- [ ] **Step 1: KbDocumentEditor**

```tsx
import { useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import type { Frontmatter, KbDocument } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';
import { SecretField } from '@/presentation/components/secrets/SecretField';

type Props = {
  projectId: string;
  document: KbDocument;
  onCancel: () => void;
  onSaved: () => void;
};

function isSecretRefKey(key: string): boolean {
  return key.endsWith('_ref');
}

export function KbDocumentEditor({ projectId, document, onCancel, onSaved }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [fm, setFm] = useState<Record<string, unknown>>({ ...document.frontmatter });
  const [body, setBody] = useState(document.body);
  const [saving, setSaving] = useState(false);

  const updateField = (key: string, value: unknown): void => {
    setFm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await kbRepository.write(projectId, document.path, fm as Frontmatter, body, document.sha);
      toast.success('Сохранено');
      onSaved();
    } catch (err) {
      const e = err as Error & { body?: { details?: unknown } };
      const details = e.body?.details;
      if (Array.isArray(details)) {
        toast.error(`Валидация: ${(details as { message: string }[]).map((d) => d.message).join('; ')}`);
      } else {
        toast.error(e.message ?? 'Не удалось сохранить');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xl font-semibold">Редактирование</h2>
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="size-4" />
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Отмена
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frontmatter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(fm).map(([key, value]) => (
            <div key={key}>
              {isSecretRefKey(key) ? (
                <SecretField
                  fieldLabel={key}
                  vaultRef={String(value)}
                  editable
                  onChange={() => { /* значение секрета меняется в БД, ref остаётся тот же */ }}
                />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={`fm-${key}`}>{key}</Label>
                  <Input
                    id={`fm-${key}`}
                    value={typeof value === 'string' ? value : JSON.stringify(value)}
                    onChange={(e) => updateField(key, e.target.value)}
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Содержимое (markdown)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded-md border bg-background p-3 font-mono text-sm"
          />
        </CardContent>
      </Card>
    </form>
  );
}
```

- [ ] **Step 2: Подключить editor в KbPage**

В `KbPage.tsx` добавить state `editing`:

```tsx
const [editing, setEditing] = useState(false);

// заменить блок viewer-а:
{activePath && document && (editing ? (
  <KbDocumentEditor
    projectId={projectId ?? ''}
    document={document}
    onCancel={() => setEditing(false)}
    onSaved={() => { setEditing(false); reload(); reloadTree(); }}
  />
) : (
  <KbDocumentViewer
    document={document}
    kbRepoFullName={project.kbRepoFullName!}
    onEdit={() => setEditing(true)}
  />
))}
```

(`reload` — из useKbDocument, `reloadTree` — из useKbTree; обе функции хуки уже возвращают.)

- [ ] **Step 3: Typecheck + commit**

```bash
git add client/src/presentation/components/kb/KbDocumentEditor.tsx client/src/presentation/pages/KbPage.tsx
git commit -m "feat(kb): document editor (form + body) with SecretField integration"
```

---

### Task 22: Phase 2 smoke test через UI

- [ ] **Step 1: Перезапустить server + client если ещё нет**

Проверь:
- Server слушает на 4317 (`netstat` или `curl localhost:4317/api/health`)
- Vite на 5173
- Touch SECRETS_MASTER_KEY есть в `.env`

- [ ] **Step 2: Открыть https://2h46nnrn-5173.euw.devtunnels.ms**

Зайти под существующим юзером.

- [ ] **Step 3: На странице существующего проекта**

- Видишь карточку «База знаний»
- Если GitHub не подключён — соответствующий ui
- Если подключён — кнопка «Создать KB-репо»

Нажми «Создать KB-репо» (если не страшно — это создаст репо `<slug>-kb` в твоём GitHub).

- [ ] **Step 4: Открыть KB**

- Перейди на `/projects/<id>/kb`
- Видишь дерево с 6 папками, в каждой README
- Тыкни README — viewer покажет markdown

- [ ] **Step 5: Создать заметку**

- Открой существующий файл, тыкни «Редактировать»
- Измени title, добавь текст в body
- «Сохранить»
- Toast «Сохранено»
- Через секунду обновляется и tree (если reload вызван)
- Открой на GitHub.com — увидишь commit «chore(kb): update ... via ProjectsFlow UI»

- [ ] **Step 6: Если что-то не работает — debug**

- DevTools Network → проверь что endpoints возвращают ожидаемое
- Server-логи в фоновом таске

**🎯 Checkpoint: Phase 2 complete.** Read/write через UI работает на реальный GitHub.

---

## Phase 3 — Optional enhancements (search + webhook)

Эти задачи опциональны. Phase 1 и 2 уже полностью работают.

### Task 23: Meilisearch sidecar + indexer port (опционально)

(Описание — на этапе планирования Phase 3 отдельно. Чтобы не разрастаться, оставляю как маркер.)

### Task 24: GitHub webhook receiver (опционально)

(То же.)

---

## Self-Review

**Spec coverage:** прошёл по секциям спеки.

- §2 DB-migration — Task 2, 7 ✓
- §3 KB-репо lifecycle — Task 12, 13, 17 ✓
- §4 Folder conventions — Task 11 (FOLDER_README шаблоны, KB_FOLDERS) ✓
- §5 Валидация и push — Task 9, Task 12 WriteKbDocument ✓ (webhook отложен в Phase 3)
- §6 Secrets — Task 1-6 ✓
- §7 Web UI — Task 17-21 ✓
- §8 Meilisearch — отложен в Phase 3
- §9 Архитектура — слои выдержаны во всех тасках ✓
- §10 Endpoints — Task 6 (secrets), 13 (kb), 12 (use-cases) ✓
- §11 Config — Task 1 (SECRETS_MASTER_KEY); Meilisearch/webhook config — в Phase 3
- §12 Acceptance — проходим smoke-tests в Task 6 и Task 22

**Placeholder scan:** нашёл «// следующая задача» в Task 19 step 3 — это ссылка вперёд на Task 21, корректно (engineer читает по порядку).

**Type consistency:** проверил
- `KbDocumentSummary` vs `KbDocument` — Summary без body/raw, Document полный. Используется консистентно
- `vaultRef` parsing — formats совпадают между server (KEY_RE) и client (parseVaultRef)
- `fullName` "owner/repo" — везде один formatRouter `kbRouter` ожидает `:projectId` через `mergeParams` — http.ts mount с `:projectId` ✓

**Scope check:** план разбит на 3 phases, каждая ship-able. Phase 1 — secrets vault, Phase 2 — KB core, Phase 3 — enhancements (вынес отдельно).

Готов к экзекуции.

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-05-15-kb-architecture.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — я диспатчу свежего subagent на каждую задачу, ревьюю между задачами. Контекст не раздувается, фокус на каждой задаче.

2. **Inline Execution** — выполняю задачи в этой сессии через `executing-plans`, batch с чекпойнтами для ревью.

Какой подход?

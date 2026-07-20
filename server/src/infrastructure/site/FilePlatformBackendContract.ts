import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformBackendContractSource } from '../../application/site/ConvertProjectToPlatformBackend.js';

/**
 * Отдаёт текст `docs/app-backend-contract.md` — его сервер вкладывает в задачу на перевод
 * проекта со своего сервера на бэкенд платформы.
 *
 * Документ здесь не «документация», а рантайм-ресурс, поэтому он добавлен в деплой-тарбол
 * (`.github/workflows/deploy.yml` и `scripts/deploy.mjs`). Расхождение документа с реальными
 * маршрутами ловит `appRuntimeRouter.contract.test.ts` — иначе воркер конвертировал бы код под
 * то, чего в рантайме нет.
 *
 * Читаем один раз и держим в памяти: файл неизменен в пределах релиза, а задачу создают редко.
 */

// Путь одинаков для dev (server/src/infrastructure/site) и прода (server/dist/infrastructure/
// site) — обе ветки лежат на одной глубине под server/. Тот же приём, что в presentation/http.ts.
const CONTRACT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/app-backend-contract.md',
);

export class FilePlatformBackendContract implements PlatformBackendContractSource {
  private cached: string | null | undefined;

  constructor(private readonly path: string = CONTRACT_PATH) {}

  read(): string | null {
    if (this.cached !== undefined) return this.cached;
    this.cached = existsSync(this.path) ? readFileSync(this.path, 'utf8').trim() || null : null;
    if (this.cached === null) {
      // Не роняем сервер: без контракта отваливается ровно одна кнопка, а не платформа.
      // Но и молчать нельзя — иначе о поломке узнает пользователь, а не тот, кто катит релиз.
      console.warn(`[site] platform backend contract not found at ${this.path}; conversion tasks are disabled`);
    }
    return this.cached;
  }
}

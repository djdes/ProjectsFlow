import type { ServerHealthStatus } from './ServerSnapshot.js';

// Транспорт/способ сбора. 'local' — VPS, на котором крутится сам бэкенд PF (читается
// напрямую). 'remote' — собирается Ralph-стиль агентом по SSH и пушится в PF.
export type ServerKind = 'local' | 'remote';

export type ProjectServer = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly kind: ServerKind;
  // Метаданные подключения (НЕ секреты). Для local не используются.
  readonly host: string | null;
  readonly sshPort: number;
  readonly sshUser: string | null;
  // Непрозрачная метка кред — резолвится сборщиком на его машине. НЕ секрет PF.
  readonly sshCredentialRef: string | null;
  readonly pm2ProcessNames: ReadonlyArray<string> | null;
  readonly nginxAccessLogPath: string | null;
  readonly nginxErrorLogPath: string | null;
  readonly deployPath: string | null;
  // URL для HTTP/uptime-проверки (и SSL, если https). NULL = выключено.
  readonly healthUrl: string | null;
  readonly enabled: boolean;
  readonly collectIntervalSeconds: number;
  readonly lastSnapshotAt: Date | null;
  readonly lastStatus: ServerHealthStatus | null;
  // «Тихий час»: до этого момента алерты записываются, но уведомления не шлются. NULL = активен.
  readonly mutedUntil: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

// Поля, которые владелец может задать/поменять через API. Пути логов для local-сервера
// API игнорирует (их задаёт админ/env — защита от path-traversal на прод-хосте).
export type ServerConfigInput = {
  readonly name: string;
  readonly kind: ServerKind;
  readonly host?: string | null;
  readonly sshPort?: number;
  readonly sshUser?: string | null;
  readonly sshCredentialRef?: string | null;
  readonly pm2ProcessNames?: ReadonlyArray<string> | null;
  readonly nginxAccessLogPath?: string | null;
  readonly nginxErrorLogPath?: string | null;
  readonly deployPath?: string | null;
  readonly healthUrl?: string | null;
  readonly enabled?: boolean;
  readonly collectIntervalSeconds?: number;
};

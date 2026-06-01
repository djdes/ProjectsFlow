# Spec: Мониторинг серверов проектов (pm2 / nginx / диск / система)

**Дата:** 2026-06-01 · **Статус:** реализовано (v1+v2+v3, миграции db/050–052)

## 1. Контекст и решения

Платформе нужна наблюдаемость инфраструктуры: доступность pm2-сервиса и его логи,
nginx-логи, свободное место на диске и системные метрики — чтобы видеть, всё ли работает.
До этой фичи бэкенд имел только `GET /api/health → {ok:true}` и не обращался к
`os`/`child_process`/pm2/nginx. У проектов не было модели «сервер/деплой».

Решения (зафиксированы с владельцем):

1. **Объект** — серверы *любого* проекта (не только VPS самого PF). Введена модель «сервер».
2. **Сбор — гибрид:** `kind='local'` (хост, где работает бэкенд PF) читается напрямую;
   `kind='remote'` собирается агент-пушем (Ralph-стиль сборщик по SSH → push в PF). `ssh2`
   в прод-бэкенд НЕ добавляем (CLAUDE.md #8); SSH-ключи остаются на машине сборщика.
3. **UI** — живая вкладка «Мониторинг» + периодические markdown-снимки в KB.
4. **Сигналы** — pm2 (статус/ресурсы), pm2-логи, nginx-логи, диск + система.
5. **Глубина** — история (time-series) + алерты (in-app SSE + Telegram-бот).

Канонические решения по конфликтам: имена таблиц `project_servers`/`server_snapshots`/
`server_alert_rules`/`server_alerts`; `kind ENUM('local','remote')`; снимок-гибрид (JSON
`metrics`/`logs` + вынесенные числовые колонки); права owner-only (`view_monitoring`/
`manage_monitoring`); записью снимков владеет бэкенд (хук `onSnapshotStored` → алерты);
KB-снимки только метрики; редакция секретов в логах двухслойная.

## 2. Модель данных (db/050–052)

- **`project_servers`** — конфиг сервера: `kind`, `host`, `ssh_port/user`, `ssh_credential_ref`
  (непрозрачная метка, НЕ секрет), `pm2_process_names` JSON, `nginx_*_log_path`, `deploy_path`,
  `enabled`, `collect_interval_seconds`, денормализованные `last_snapshot_at`/`last_status`.
  `UNIQUE(project_id, name)`.
- **`server_snapshots`** — time-series: `metrics`/`logs`/`db_health`/`errors` JSON + числовые
  `cpu_load1/5/15`, `mem_used_pct`, `disk_used_pct`, `pm2_online`, `pm2_restart_total` +
  `source`, `status`, `reachable`, `pushed_by_user_id`, `agent_token_id`.
  `UNIQUE(server_id, collected_at)` (анти-реплей).
- **`server_alert_rules`** — per-project оверрайды (дефолты правил — в коде `alertRules.ts`).
- **`server_alerts`** — журнал с state-machine `firing`/`resolved`; партиальный UNIQUE через
  `active_dedup` (= `dedup_key` пока firing, NULL после resolve) → один активный firing на ключ.

Drizzle-определения — в `server/src/infrastructure/db/schema.ts`; value-типы payload'а —
`server/src/domain/monitoring/ServerSnapshot.ts`.

## 3. API

**Session REST** (`/api/projects/:projectId/monitoring/*`, cookie-auth, owner-only):
`GET /servers`, `GET /servers/:id/latest`, `GET /servers/:id/history`, `GET /servers/:id/logs?kind=`,
`GET /alerts`, `POST /servers/:id/collect` (on-demand local, rate-limit + TTL-кэш),
`POST|PATCH|DELETE /servers[/:id]`.

**Agent REST** (Bearer agent-token, gate `manage_monitoring`):
`GET /api/agent/monitoring/servers` (remote-серверы владельца/admin),
`POST /api/agent/projects/:projectId/monitoring/snapshots` (ingest; авто-создаёт сервер на
первом пуше; строгая Zod, монотонный `collectedAt`, серверная редакция логов).

**MCP** (`mcp-server` 0.22+): `pf_list_monitored_servers`, `pf_record_server_snapshot`.

## 4. Сбор метрик

- **Local** — `ShellLocalServerCollector`: `execFile` (argv-only, без shell, timeout 5s,
  maxBuffer cap), `pm2 jlist`, `os`, `df -Pk`, чтение pm2-лог-файлов (пути из `pm2 jlist`) и
  nginx-логов (allowlist путей; EACCES/ENOENT → graceful `{available:false}`). Периодический
  интервал в `index.ts` (~60с; на win32-dev OFF, env `MONITOR_LOCAL_COLLECT`).
- **Remote** — `C:\www\ralph\monitor-collect.ps1` + `.psm1`: GET список серверов, SSH-проба
  (один round-trip с маркерами секций), сборка снимка, push. Конфиг — блок `monitoring` в
  `config.local.json`. См. ONBOARDING § 6.7.

## 5. Алерты и доставка

`alertRules.ts` (чистые правила): `process_down`, `disk_usage` (>90/95%), `restart_spike`,
`snapshot_stale`. `EvaluateAlerts` вызывается на каждый снимок (хук `onSnapshotStored`) +
периодический staleness-sweep; state-machine firing/resolved с дедупом и re-notify throttle
(6 ч). `AlertNotificationDispatcher` шлёт владельцу in-app (NotificationHub SSE,
payload `server_alert`) + Telegram (`SendAgentTelegramNotification`, kind `server_alert`,
critical минует prefs). Pref `serverAlert` по умолчанию включён.

## 6. KB-снимки

`MonitoringKbSnapshotWriter` (hourly): рендерит `renderSnapshotMarkdown` (ТОЛЬКО метрики —
KB читаем editor'ом, логи там = утечка) и пишет `monitoring/<slug>-latest.md` через
`WriteKbDocument` (актор = `project.ownerId`, optimistic-lock по sha). Skip при `kbKind='none'`.
Добавлен KB-тип `monitoring` (`KB_FOLDERS` + `FrontmatterValidator`).

## 7. Frontend

Вкладка `/projects/:id/monitoring` (`MonitoringPage`), Clean Architecture: domain →
`MonitoringRepository` порт → `HttpMonitoringRepository` → `container.tsx`. Компоненты:
`ServerCard` (pm2-таблица + ресурс-бары + диски + on-demand «Обновить» для local + логи),
`LogTailViewer`, `AlertList`, `AddServerDialog`, `StatusBadge`, `ResourceBar`. Хук
`useMonitoring` — polling 15с с паузой на скрытой вкладке. Кнопка nav в `TasksPage` и сама
вкладка — owner-only (реактивный гейт: при 403 не показываются). Уведомление `server_alert`
ведёт на вкладку.

## 8. Безопасность

Owner-only гейты; SSH-ключи только на сборщике (PF хранит метаданные + opaque ref); shell-out
безопасен (execFile, timeouts, allowlist путей логов, charCode-проверка); ingest гейтится
`manage_monitoring` + строгая Zod + анти-реплей + форензика (`pushed_by_user_id`/`agent_token_id`);
редакция секретов двухслойная (`redactSecrets.ts` на сборщике и на сервере); KB-снимки без логов;
TTL-кэш + rate-limit на on-demand collect; прунинг снимков (TTL 30д).

## 9. Фазирование

- **v1** — local-мониторинг VPS end-to-end + вкладка + алерты (disk/process_down).
- **v2** — remote агент-пуш + MCP-тулы + сборщик + restart_spike/snapshot_stale.
- **v3** — KB markdown-снимки + KB-тип `monitoring`.

(Все три реализованы в этом релизе.)

## 10. Открытые вопросы / дальнейшее

- Тренд-графики (SVG sparkline) на вкладке — данные истории уже есть (`/history`), UI-графики
  можно добавить отдельно.
- Per-project оверрайды правил (`server_alert_rules`) — таблица есть, UI редактирования порогов — позже.
- pm2-логи remote-серверов сейчас сборщик не тянет (только статус + nginx) — можно добавить
  вторым SSH-round-trip по `pm_out_log_path` из `pm2 jlist`.

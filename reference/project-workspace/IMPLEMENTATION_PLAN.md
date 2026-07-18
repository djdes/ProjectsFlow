# Implementation plan: Preview Editor + полный Dashboard

## 1. Frontend

### Preview

- `PreviewToolbar`: Preview/Dashboard, Edit, Canvas, route combobox, reload, device, undo/redo, open result.
- `PreviewCanvas`: isolated iframe, loading/timeout/error, resize shell и bridge handshake.
- `previewEditorReducer`: bridge/session, hover/selection, panel, history, dirty/saving/AI states.
- `PreviewElementToolbar`: regenerate, prompt, colors/theme, duplicate/link/layout, code/source, hide/delete, clear selection.
- `PreviewStylePanel`: allowlisted foreground/background/border/radius/spacing/typography.
- `PreviewCodePanel`: escaped outerHTML, computed CSS and best-effort source context.
- `PreviewAiPrompt`: prompt + selected route/locator, progress, error, changed files/deployment result.
- `PreviewCanvasMap`: route frames, pan/zoom, add note, focus selected frame.

### Dashboard sections

- Overview; App users; Data; Analytics; SEO; Domains; Integrations; Security; Code; Agents; Workflows; Logs; API; Settings.
- Desktop sidebar, mobile section selector, independent content scroll.
- Existing Data/Logs are reused; new sections use explicit empty/loading/error states.

## 2. State and cache

- Workspace deep-link: `?workspace=preview&path=/catalog` or `?workspace=dashboard&section=data`.
- Preview editor reducer owns ephemeral session and undo/redo; server revision is optimistic-lock base.
- Cache keys: project site, edit session, route patches, edit jobs, dashboard overview, app users, analytics, deployments/domains/settings.
- Realtime events carry only ids/status/revision; protected data is refetched.

## 3. API contracts

- `POST /api/projects/:id/site-editor/sessions`
- `GET /api/projects/:id/site-editor/patches?route=&artifact=`
- `POST /api/projects/:id/site-editor/patches` (idempotency key + base revision)
- `PATCH/DELETE /api/projects/:id/site-editor/patches/:patchId`
- `POST /api/projects/:id/site-editor/jobs`
- `GET /api/projects/:id/site-editor/jobs/:jobId`
- `GET /api/projects/:id/site-editor/source?path=`
- Dashboard aggregate/app-users/analytics/deployments/domains/settings routes, project-scoped and paginated where needed.

Errors use the current platform envelope/status mapping: validation 400/422, auth 401, access 403, not found 404, revision 409, quota/rate 429, transient 503.

## 4. Database and storage

- `site_editor_sessions`: token hash, project/user/artifact, expiry/revocation.
- `site_patch_sets` + `site_patches`: route/artifact/revision, locator, kind, sanitized payload, enabled/order.
- `project_edit_jobs`: selected locator/snapshot/prompt/operation, project capability, status/result/error.
- `site_deployments`: immutable deployment metadata and current pointer compatibility.
- `site_events`: privacy-preserving page/session/event analytics with retention.
- `project_domains` and `project_app_settings`: verified domain/config/auth/SEO/visibility JSON without returning secret values.

New migration is append-only; foreign keys/indexes cover project/status/createdAt and expiry cleanup.

## 5. Permissions

- `read_project`: Preview only.
- `update_project`: Edit session/patches/AI jobs, Data CRUD, deployments.
- owner: app users/auth, domains, secrets, destructive reset/delete/rollback.
- Worker claims an edit job only with a capability scoped to the same project.

## 6. Transactions and concurrency

- Patch mutation validates base revision and increments once in a transaction.
- AI job creation stores a deployment/artifact version; stale completion is rejected/marked conflict.
- Domain verification and deployment side effects run after commit through jobs/outbox-compatible service boundaries.
- Delete/hide/restore retain revision history; undo/redo is a new revision, not history deletion.

## 7. Security

- Bridge injection only for a valid, short-lived edit session; public visitors never receive edit capability.
- `event.source`, exact `event.origin`, nonce, protocol version and message schema are mandatory.
- Style/attribute allowlists; block scripts, `on*`, `javascript:`, unsafe URLs and raw untrusted HTML.
- DOM snapshot is capped/redacted before AI; tokens/credentials/PII never enter prompt or logs.
- Source endpoint is text-only, project-scoped, path-normalized and size-limited.

## 8. Realtime and audit

- `preview_patch_changed`, `preview_edit_job_changed`, `site_deployment_changed`, `app_backend_data_changed`, `site_domain_changed`.
- Audit actor/project/action/route/locator/result for patch, AI, data, domain, auth and deployment changes.

## 9. Tests

- Unit: path/selector/locator, bridge protocol, sanitizer, reducer/history, redaction.
- API: project isolation, token expiry/replay, validation, 409 revision, idempotency, viewer denial.
- E2E: route/device/reload; select/style/undo/reload; targeted AI payload; code escaping; Dashboard section smoke; Data row CRUD; mobile/a11y.
- Visual: Preview desktop/tablet/mobile; edit hover/selected/palette/code/prompt; Dashboard desktop/mobile; Data grid/sheet.

## 10. Migration strategy

- Existing Preview/Data/Logs remain available during rollout.
- New editor endpoints are additive; no public runtime key is reused.
- Current site artifact remains compatibility projection while deployments are introduced.
- If a bridge cannot initialize (old artifact/CSP), Preview stays usable and Edit shows a recoverable fallback.

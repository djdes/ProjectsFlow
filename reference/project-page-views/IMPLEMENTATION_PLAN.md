# Implementation plan: project page views

## Goal

Bring the ProjectsFlow project page view system to the observed Notion interaction model while preserving ProjectsFlow task semantics, permissions and realtime behavior.

## 1. Frontend components

- Extract `ProjectViewTabs` from the current large coordinator.
- Add `ProjectViewContextMenu` with correct `Display as` semantics.
- Add `ProjectViewsOverflow` with search, per-view overflow actions and create actions.
- Add `ProjectViewSettingsPanel` with `Layout`, visibility, filter, sort, group, color and type-specific layout settings.
- Add `NewProjectViewPicker` for 11 view types.
- Keep existing Table, Kanban, List and Calendar renderers but normalize density and interaction.
- Add renderers:
  - `TimelineView`
  - `GalleryView`
  - `ChartView`
  - `FeedView`
  - `MapView`
  - `DashboardView`
  - `FormView`
- Extract table selection into `useTableSelection`.
- Extract property creation into `TablePropertyCreator`.
- Add a shared flat view shell and toolbar.

## 2. State ownership

- Server owns shared view identity, ordering, type and config.
- Client URL owns active view id.
- Local storage owns per-user `Display as` preference only.
- React component state owns open overlay, draft form fields and active selection.
- Query cache owns projects, tasks and views.

## 3. Query/cache keys

- `['project', projectId]`
- `['tasks', projectId]`
- `['projectViews', projectId]`
- `['projectView', projectId, viewId]`
- Existing SSE invalidation remains the realtime source.

## 4. API routes

Reuse and extend:

- `GET /api/projects/:projectId/views`
- `POST /api/projects/:projectId/views`
- `PATCH /api/projects/:projectId/views/:viewId`
- `POST /api/projects/:projectId/views/:viewId/duplicate`
- `DELETE /api/projects/:projectId/views/:viewId`

No separate API is needed for personal tab display preference.

## 5. Request/response schemas

- Extend view type union to:
  `kanban | table | list | calendar | timeline | gallery | chart | feed | map | dashboard | form`.
- Validate config by view type.
- Preserve unknown future config keys on round trip only when schema allows them.
- Validate name length, order integer and JSON payload size.

## 6. Database tables

The repository uses MariaDB/Drizzle, not PostgreSQL. Reuse `board_views` and expand its type enum. Continue storing typed view config in JSON. No new table is required for this iteration.

## 7. Indexes

Reuse project/order indexes on `board_views`. Verify an index exists for `(project_id, position)` or equivalent ordering column; add only if missing.

## 8. Permissions

- Project viewer: list/open views and use personal `Display as`.
- Project editor/owner: create, rename, configure, duplicate, reorder and delete views/properties.
- Server remains authoritative; hidden UI is not a permission boundary.
- Property deletion keeps its existing project-wide warning.

## 9. Transactions

- Create view and assign order atomically.
- Delete view and choose/fix a fallback active view atomically where server state requires it.
- Duplicate copies validated config and receives a unique order in one transaction.
- Property mutation continues through existing task-property service transaction boundaries.

## 10. Optimistic update

- Optimistically switch active view locally.
- Optimistically rename/reorder/create/duplicate/delete in the query cache.
- Roll back on API failure and show an inline/toast error.
- Property creation keeps a local placeholder until server success.

## 11. Conflict resolution

- Preserve existing last-write server behavior for view config in this iteration.
- Add `updatedAt` to mutation payload/response if already available.
- On stale failure, refetch views and preserve the user’s active view if it still exists.

## 12. Realtime events

- Continue using project SSE.
- Refetch `projectViews` for view created/updated/deleted/duplicated/reordered.
- Refetch tasks for task/property changes.
- Do not close an open settings panel on benign remote updates; merge or refresh its saved values.

## 13. Background jobs

None required.

## 14. Audit events

Reuse task/project activity infrastructure where available for:

- view created
- view renamed
- view layout changed
- view duplicated
- view deleted
- property created
- property deleted

Personal `Display as` is not a shared audit event.

## 15. Error mapping

- 400: validation message near the active field.
- 403: permission explanation and rollback.
- 404: remove stale view from cache and select fallback.
- 409/stale: refetch and show conflict message.
- 5xx/network: preserve draft, rollback optimistic shared state, allow retry.

## 16. Unit tests

- View type/config parsing.
- Personal display preference.
- Overflow calculation/search.
- View state transitions.
- Table rectangular selection and row promotion.
- Type-specific default config.

## 17. API tests

- Create every supported view type.
- Reject unsupported config/type.
- Editor can mutate; viewer cannot.
- Duplicate preserves config and creates a new id/order.
- Delete never removes another view.

## 18. Playwright tests

- visible tab switch
- overflow keyboard open/close
- context menu and `Display as`
- edit layout
- new view create/delete
- settings panel
- add-column open/cancel/create
- table range selection and two-stage dismiss
- desktop/tablet/compact screenshots

## 19. Visual tests

- Reference screenshots in `reference/project-page-views/screenshots`.
- Local screenshots in `reference/project-page-views/actual`.
- Pixel/structural diffs in `reference/project-page-views/diff`.
- Threshold focuses on shell, density, geometry and overlays; project-specific content is masked where needed.

## 20. Migration strategy

1. Add the new enum values in an append-only migration.
2. Deploy backend capable of reading old and new types.
3. Deploy frontend renderers.
4. Existing four types remain unchanged in storage.
5. Rollback frontend can still list unsupported types as a safe fallback table/list rather than corrupting data.

## Files expected to change

- `client/src/presentation/components/tasks/views/ProjectBoardViews.tsx`
- `client/src/presentation/components/tasks/views/ViewsOverflowMenu.tsx`
- `client/src/presentation/components/tasks/views/TableView.tsx`
- `client/src/presentation/components/tasks/views/ListView.tsx`
- `client/src/presentation/components/tasks/views/CalendarView.tsx`
- `client/src/presentation/components/tasks/views/KanbanBoard.tsx`
- new files under `client/src/presentation/components/tasks/views/projectViews/`
- shared view contracts/types used by client and server
- `server/src/infrastructure/db/schema.ts`
- append-only migration under `server/drizzle/`
- view route/service validation
- focused unit/API/e2e tests

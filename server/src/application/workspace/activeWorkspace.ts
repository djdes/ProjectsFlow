import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

// Активное пространство юзера: id + kind. Единый тип для use-case'ов, которым нужна
// изоляция по текущему пространству (ListProjects и лента «Входящих»).
export type ActiveWorkspace = { readonly id: string; readonly kind: WorkspaceKind };

// Резолвит активное пространство юзера (реализация — closure в index.ts поверх
// users.current_workspace_id). null = у юзера нет пространств → пустой список.
export type ResolveActiveWorkspace = (userId: string) => Promise<ActiveWorkspace | null>;

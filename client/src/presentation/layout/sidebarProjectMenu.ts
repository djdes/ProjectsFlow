import type { Project } from '@/domain/project/Project';
import { hasOwnerRights } from '@/domain/project/ProjectMembership';

export type SidebarProjectMenuAction =
  | 'rename'
  | 'settings'
  | 'favorite'
  | 'kb'
  | 'share'
  | 'moveUp'
  | 'moveDown'
  | 'duplicate'
  | 'archive'
  | 'delete';

export type SidebarProjectMenuItem = {
  readonly action: SidebarProjectMenuAction;
  readonly label: string;
  // Neighbouring items with different sections are split by a separator.
  readonly section: number;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
};

type Input = {
  readonly project: Pick<Project, 'role' | 'isInbox' | 'status' | 'isFavorite'>;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
};

// Single item list for the sidebar project menu: the «⋯» button and the right-click
// context menu render the same list. Order follows Todoist/Notion: edit and settings
// first, then the favorite toggle, navigation, reordering, and destructive actions last.
export function buildSidebarProjectMenu({
  project,
  canMoveUp,
  canMoveDown,
}: Input): SidebarProjectMenuItem[] {
  const isArchived = project.status === 'archived';
  // Viewers cannot change the project; the inbox is a service project.
  const canManage = project.role !== 'viewer' && !project.isInbox;
  // Only the owner deletes; the inbox cannot be deleted at all.
  const canDelete = hasOwnerRights(project.role) && !project.isInbox;
  // The favorites section lists active projects only, so the toggle is pointless for
  // archived ones; the inbox cannot be a favorite (server rejects it).
  const canFavorite = !isArchived && !project.isInbox;

  const items: SidebarProjectMenuItem[] = [
    { action: 'rename', label: 'Изменить имя', section: 0 },
    // The overview page holds project settings and is open to every member.
    { action: 'settings', label: 'Настройки', section: 0 },
  ];
  if (canFavorite) {
    items.push({
      action: 'favorite',
      label: project.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
      section: 0,
    });
  }
  items.push(
    { action: 'kb', label: 'База знаний', section: 1 },
    { action: 'share', label: 'Общий доступ', section: 1 },
    { action: 'moveUp', label: 'Переместить выше', section: 2, disabled: !canMoveUp },
    { action: 'moveDown', label: 'Переместить ниже', section: 2, disabled: !canMoveDown },
  );
  if (canManage) {
    items.push(
      { action: 'duplicate', label: 'Дублировать', section: 3 },
      { action: 'archive', label: isArchived ? 'Вернуть из архива' : 'В архив', section: 3 },
    );
  }
  if (canDelete) {
    items.push({ action: 'delete', label: 'Удалить проект…', section: 4, destructive: true });
  }
  return items;
}

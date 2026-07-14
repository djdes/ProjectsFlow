import { UserAvatarHover } from '@/presentation/components/user/UserAvatarHover';
import type { TaskAssignee } from '@/domain/task/TaskAssignee';

type Props = {
  assignee: TaskAssignee;
};

// На карточке показывается только текущий ответственный. Автор задачи намеренно
// не участвует в этой проекции: это отдельное audit-поле на сервере.
export function AssigneeBadge({ assignee }: Props): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      <UserAvatarHover
        displayName={assignee.displayName}
        avatarUrl={assignee.avatarUrl}
        subtitle="ответственный"
      />
    </span>
  );
}

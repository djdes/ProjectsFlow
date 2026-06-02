import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TaskComposer } from './TaskComposer';

type Props = {
  onCreate: (input: {
    description: string;
    status?: TaskStatus;
    ralphMode?: RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: TaskPriority | null;
  }) => Promise<Task>;
  isInbox?: boolean;
  isShared?: boolean;
  aiProjectId?: string | null;
};

// Глобальный floating quick-add (fixed снизу страницы). Тонкая обёртка над TaskComposer —
// вся логика (textarea, файлы, Ralph-режим, делегирование, AI-improve) живёт в нём.
export function QuickAddTodo({
  onCreate,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
}: Props): React.ReactElement {
  return (
    <TaskComposer
      variant="floating"
      onCreate={onCreate}
      isInbox={isInbox}
      isShared={isShared}
      aiProjectId={aiProjectId}
    />
  );
}

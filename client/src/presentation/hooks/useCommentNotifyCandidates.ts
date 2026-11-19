import { useEffect, useState } from 'react';
import type { CommentNotifyCandidate } from '@/domain/task/TaskComment';
import { useContainer } from '@/infrastructure/di/container';

export type CommentNotifyCandidatesState = {
  // null — ещё грузится.
  readonly candidates: readonly CommentNotifyCandidate[] | null;
  readonly failed: boolean;
};

// Адресаты «Уведомить → Выбрать» для композера комментария к задаче.
export function useCommentNotifyCandidates(projectId: string, taskId: string): CommentNotifyCandidatesState {
  const { taskRepository } = useContainer();
  const [state, setState] = useState<CommentNotifyCandidatesState>({ candidates: null, failed: false });

  useEffect(() => {
    let alive = true;
    setState({ candidates: null, failed: false });
    taskRepository
      .listCommentNotifyCandidates(projectId, taskId)
      .then((candidates) => {
        if (alive) setState({ candidates, failed: false });
      })
      // Без списка композер работает дальше: по умолчанию никого не уведомляет.
      .catch(() => {
        if (alive) setState({ candidates: [], failed: true });
      });
    return () => {
      alive = false;
    };
  }, [projectId, taskId, taskRepository]);

  return state;
}

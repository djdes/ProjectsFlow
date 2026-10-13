import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Task } from '@/domain/task/Task';
import type { TaskRepository } from '@/application/task/TaskRepository';
import { TaskDescriptionDraft } from './taskDescriptionDraft';

type DraftScope = {
  readonly taskId: string | undefined;
  readonly projectId: string | undefined;
  readonly repository: TaskRepository;
};

export function useTaskDescriptionDraft(task: Task | null, repository: TaskRepository, onSaved: () => void) {
  const taskId = task?.id;
  const projectId = task?.projectId;
  // A new opening owns its callbacks, including when the same task is reopened.
  const scope = useMemo(() => ({ taskId, projectId, repository }), [taskId, projectId, repository]);
  const [state, setState] = useState({ scope, description: task?.description ?? '', saving: false });
  const sessionRef = useRef<{ scope: DraftScope; draft: TaskDescriptionDraft } | null>(null);
  const initialRef = useRef(task);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { initialRef.current = task; onSavedRef.current = onSaved; });
  const report = useCallback((error: unknown) => {
    toast.error(`Не удалось сохранить: ${(error as Error).message}`);
  }, []);

  useEffect(() => {
    const current = initialRef.current;
    if (!current) { sessionRef.current = null; setState({ scope, description: '', saving: false }); return; }
    const onTaskSaved = onSavedRef.current;
    const draft = new TaskDescriptionDraft(current.description ?? '', async description => {
      const updated = await repository.update(current.projectId, current.id, { description });
      return updated.description ?? '';
    }, () => {
      if (sessionRef.current?.draft === draft)
        setState({ scope, description: draft.value, saving: draft.saving });
    }, onTaskSaved);
    sessionRef.current = { scope, draft };
    setState({ scope, description: draft.value, saving: false });
    return () => {
      if (sessionRef.current?.draft === draft) sessionRef.current = null;
      // Finish the original task's queue; callbacks from its editor are now inactive.
      void draft.commit().catch(report);
    };
  }, [scope, repository, report]);

  const onChange = useCallback((value: string) => {
    if (sessionRef.current?.scope === scope) sessionRef.current.draft.change(value);
  }, [scope]);
  // Status/project changes must wait for text edits and abort if saving fails.
  const flush = useCallback(async (): Promise<void> => {
    if (sessionRef.current?.scope === scope) await sessionRef.current.draft.commit();
  }, [scope]);
  const commit = useCallback(async (value?: string): Promise<void> => {
    const session = sessionRef.current;
    if (!session || session.scope !== scope) return;
    if (value !== undefined) session.draft.change(value);
    try { await session.draft.commit(); } catch (error) { report(error); }
  }, [scope, report]);

  // Effects initialise the new queue after render. Never mount that task's editor
  // with the previous task's text while waiting for the effect.
  return {
    description: state.scope === scope ? state.description : task?.description ?? '',
    saving: state.scope === scope && state.saving,
    onChange, commit, flush,
  };
}
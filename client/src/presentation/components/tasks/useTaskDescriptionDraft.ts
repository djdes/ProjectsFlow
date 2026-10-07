import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Task } from '@/domain/task/Task';
import type { TaskRepository } from '@/application/task/TaskRepository';
import { TaskDescriptionDraft } from './taskDescriptionDraft';

export function useTaskDescriptionDraft(task: Task | null, repository: TaskRepository, onSaved: () => void) {
  const [state, setState] = useState({ description: '', saving: false });
  const sessionRef = useRef<TaskDescriptionDraft | null>(null);
  const taskId = task?.id;
  const initialRef = useRef(task);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { initialRef.current = task; onSavedRef.current = onSaved; });
  const report = useCallback((error: unknown) => {
    toast.error(`Не удалось сохранить: ${(error as Error).message}`);
  }, []);

  useEffect(() => {
    const current = initialRef.current;
    if (!current) { sessionRef.current = null; setState({ description: '', saving: false }); return; }
    const onTaskSaved = onSavedRef.current;
    const session = new TaskDescriptionDraft(current.description ?? '', async description => {
      const updated = await repository.update(current.projectId, current.id, { description });
      return updated.description ?? '';
    }, () => {
      if (sessionRef.current === session) setState({ description: session.value, saving: session.saving });
    }, onTaskSaved);
    sessionRef.current = session;
    setState({ description: session.value, saving: false });
    return () => {
      sessionRef.current = null;
      // Finish the same queue on close/switch, even if a request is already in flight.
      void session.commit().catch(report);
    };
  }, [taskId, repository, report]);

  const onChange = useCallback((value: string) => sessionRef.current?.change(value), []);
  const commit = useCallback(async (value?: string): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (value !== undefined) session.change(value);
    try { await session.commit(); } catch (error) { report(error); }
  }, [report]);
  return { ...state, onChange, commit };
}

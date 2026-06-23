import { useState } from 'react';
import type { Workspace } from '@/domain/workspace/Workspace';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from './useNotificationStream';
import { useWorkspacesContext } from './WorkspacesProvider';

export function useCreateWorkspace(): {
  submit: (name: string, icon: string | null) => Promise<Workspace>;
  saving: boolean;
  error: Error | null;
} {
  const { createWorkspace } = useContainer();
  const { applyAppend } = useWorkspacesContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (name: string, icon: string | null): Promise<Workspace> => {
    setSaving(true);
    setError(null);
    try {
      // Сервер создаёт пространство, делает его активным и возвращает isCurrent=true.
      const ws = await createWorkspace.execute(name, icon);
      applyAppend(ws);
      // Новое пространство пустое — перечитываем проекты (список станет пустым).
      window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
      return ws;
    } catch (e) {
      const err = e as Error;
      setError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving, error };
}

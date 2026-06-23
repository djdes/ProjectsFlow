import { useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { PROJECT_CHANGED_EVENT } from './useNotificationStream';
import { useWorkspacesContext } from './WorkspacesProvider';

export function useDeleteWorkspace(): {
  submit: (id: string) => Promise<void>;
  saving: boolean;
} {
  const { workspaceRepository } = useContainer();
  const { applyRemove, refresh } = useWorkspacesContext();
  const [saving, setSaving] = useState(false);

  const submit = async (id: string): Promise<void> => {
    setSaving(true);
    try {
      await workspaceRepository.remove(id);
      applyRemove(id);
      // Сервер мог авто-переключить активное пространство — перечитываем список + проекты.
      refresh();
      window.dispatchEvent(new Event(PROJECT_CHANGED_EVENT));
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving };
}

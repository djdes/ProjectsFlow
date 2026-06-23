import { useState } from 'react';
import type { Workspace } from '@/domain/workspace/Workspace';
import { useContainer } from '@/infrastructure/di/container';
import { useWorkspacesContext } from './WorkspacesProvider';

export function useRenameWorkspace(): {
  submit: (id: string, patch: { name?: string; icon?: string | null }) => Promise<Workspace>;
  saving: boolean;
} {
  const { workspaceRepository } = useContainer();
  const { applyReplace } = useWorkspacesContext();
  const [saving, setSaving] = useState(false);

  const submit = async (
    id: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<Workspace> => {
    setSaving(true);
    try {
      const ws = await workspaceRepository.rename(id, patch);
      applyReplace(ws);
      return ws;
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving };
}

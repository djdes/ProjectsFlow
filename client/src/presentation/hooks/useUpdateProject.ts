import { useState } from 'react';
import type { Project } from '@/domain/project/Project';
import type { UpdateProjectInput } from '@/application/project/ProjectRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

export function useUpdateProject(): {
  submit: (id: string, patch: UpdateProjectInput) => Promise<Project>;
  saving: boolean;
  error: Error | null;
} {
  const { updateProject } = useContainer();
  const { applyReplace } = useProjectsContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (id: string, patch: UpdateProjectInput): Promise<Project> => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateProject.execute(id, patch);
      applyReplace(next);
      return next;
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

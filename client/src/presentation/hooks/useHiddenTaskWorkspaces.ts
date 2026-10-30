import { useCallback, useEffect, useRef, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';

export function useHiddenTaskWorkspaces() {
  const { userRepository } = useContainer();
  const [hiddenIds, setHiddenIds] = useState<readonly string[] | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void userRepository.getUiPrefs().then((prefs) => {
      if (!cancelled) setHiddenIds(prefs.hiddenTaskWorkspaceIds ?? []);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [userRepository, attempt]);

  const save = useCallback(async (next: readonly string[]): Promise<void> => {
    if (hiddenIds === null || pending.current) return;
    const previous = hiddenIds;
    pending.current = true;
    setSaving(true);
    setHiddenIds(next);
    try {
      await userRepository.setUiPrefs({ hiddenTaskWorkspaceIds: next });
    } catch {
      setHiddenIds(previous);
      toast.error('Не удалось сохранить видимость пространств. Попробуйте ещё раз.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }, [hiddenIds, userRepository]);

  return {
    hiddenIds,
    error,
    saving,
    retry: () => setAttempt(value => value + 1),
    setVisible: (id: string, visible: boolean) => save(visible
      ? (hiddenIds ?? []).filter(hidden => hidden !== id)
      : [...new Set([...(hiddenIds ?? []), id])]),
    showAll: () => save([]),
  };
}

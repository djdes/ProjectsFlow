import { useEffect, useState } from 'react';
import type { KbDocument } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';

export function useKbDocument(projectId: string, path: string | null): {
  document: KbDocument | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const { kbRepository } = useContainer();
  const [document, setDocument] = useState<KbDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) { setDocument(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    kbRepository.get(projectId, path)
      .then((d) => { if (!cancelled) setDocument(d); })
      .catch((e: Error) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kbRepository, projectId, path, version]);

  return { document, loading, error, reload: () => setVersion((v) => v + 1) };
}

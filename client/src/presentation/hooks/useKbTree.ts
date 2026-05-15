import { useEffect, useState } from 'react';
import type { KbDocumentSummary } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';

export function useKbTree(projectId: string): {
  documents: KbDocumentSummary[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const { kbRepository } = useContainer();
  const [documents, setDocuments] = useState<KbDocumentSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    kbRepository.list(projectId)
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .catch((e: Error) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kbRepository, projectId, version]);

  return { documents, loading, error, reload: () => setVersion((v) => v + 1) };
}

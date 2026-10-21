import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageGeneration } from '@/domain/image-generation/ImageGeneration';
import { useContainer } from '@/infrastructure/di/container';

type State = { conversationId: string; jobs: ImageGeneration[]; sending: boolean; error: string | null };
const REFRESH_ERROR = 'Не удалось обновить фотографии. Повторим через несколько секунд.';

export function useConversationImages(conversationId: string) {
  const { imageGenerationRepository } = useContainer();
  const [state, setState] = useState<State>({ conversationId, jobs: [], sending: false, error: null });
  const revision = useRef(0);
  const pending = useRef(new Map<string, symbol>());

  useEffect(() => {
    let alive = true;
    let refreshing = false;
    revision.current++;
    setState({ conversationId, jobs: [], sending: pending.current.has(conversationId), error: null });
    const refresh = (): void => {
      if (refreshing) return;
      refreshing = true;
      const requestedRevision = revision.current;
      void imageGenerationRepository.list(conversationId).then(jobs => {
        if (!alive || requestedRevision !== revision.current) return;
        setState(current => current.conversationId === conversationId
          ? { ...current, jobs: jobs.filter(job => job.conversationId === conversationId), error: current.error === REFRESH_ERROR ? null : current.error }
          : current);
      }).catch(() => {
        if (alive) setState(current => current.conversationId === conversationId
          ? { ...current, error: REFRESH_ERROR }
          : current);
      }).finally(() => { refreshing = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [conversationId, imageGenerationRepository]);

  const generate = useCallback(async (prompt: string): Promise<void> => {
    if (pending.current.has(conversationId)) throw new Error('Описание фотографии уже отправляется');
    const request = Symbol(conversationId);
    pending.current.set(conversationId, request);
    revision.current++;
    setState(current => current.conversationId === conversationId
      ? { ...current, sending: true, error: null }
      : { conversationId, jobs: [], sending: true, error: null });
    try {
      const job = await imageGenerationRepository.create(prompt, conversationId);
      setState(current => current.conversationId === conversationId
        ? { ...current, jobs: [...current.jobs.filter(item => item.id !== job.id), job] }
        : current);
    } catch (reason) {
      setState(current => current.conversationId === conversationId
        ? { ...current, error: reason instanceof Error ? reason.message : 'Не удалось отправить описание фотографии' }
        : current);
      throw reason;
    } finally {
      if (pending.current.get(conversationId) === request) pending.current.delete(conversationId);
      setState(current => current.conversationId === conversationId ? { ...current, sending: false } : current);
    }
  }, [conversationId, imageGenerationRepository]);

  return {
    jobs: state.conversationId === conversationId ? state.jobs : [],
    sending: state.conversationId === conversationId && state.sending,
    error: state.conversationId === conversationId ? state.error : null,
    generate,
  };
}

import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import type { PublicBoard } from '@/domain/public/PublicBoard';

type State = {
  readonly status: 'loading' | 'ready' | 'notfound' | 'error';
  readonly board: PublicBoard | null;
};

// Загрузка публичной доски по slug через контейнер (Clean Arch). 404 → notfound
// (доска не опубликована/не существует — не различаем, так задумано).
export function usePublicBoard(slug: string): State {
  const { publicBoardRepository } = useContainer();
  const [state, setState] = useState<State>({ status: 'loading', board: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', board: null });
    publicBoardRepository
      .getBoard(slug)
      .then((board) => {
        if (cancelled) return;
        setState(board ? { status: 'ready', board } : { status: 'notfound', board: null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', board: null });
      });
    return () => {
      cancelled = true;
    };
  }, [publicBoardRepository, slug]);

  return state;
}

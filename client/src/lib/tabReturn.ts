// Возврат на вкладку — один сигнал на одно возвращение. Раньше каждый поставщик данных сам
// слушал focus и/или visibilitychange: оба события приходят вместе (двойные запросы), а
// focus — ещё и после каждого клика во встроенный iframe или в DevTools. Перечитывать данные
// стоит, только если вкладку не видели заметное время: за короткий взгляд в другое окно
// ничего не поменялось, а живые изменения и так приходят по SSE (после переподключения —
// своим событием).

type Subscriber = { readonly callback: () => void; readonly minAwayMs: number };

export const TAB_RETURN_MIN_AWAY_MS = 15_000;

export class TabReturnSignal {
  private readonly subscribers = new Set<Subscriber>();
  private awaySince: number | null = null;

  constructor(
    win: Pick<Window, 'addEventListener'>,
    private readonly doc: Pick<Document, 'addEventListener' | 'visibilityState'>,
    private readonly now: () => number = () => performance.now(),
  ) {
    const leave = (): void => {
      this.awaySince ??= this.now();
    };
    const back = (): void => {
      if (this.doc.visibilityState === 'hidden' || this.awaySince === null) return;
      const away = this.now() - this.awaySince;
      this.awaySince = null;
      for (const subscriber of [...this.subscribers]) {
        if (away >= subscriber.minAwayMs) subscriber.callback();
      }
    };
    doc.addEventListener('visibilitychange', () => (this.doc.visibilityState === 'hidden' ? leave() : back()));
    win.addEventListener('blur', leave);
    win.addEventListener('pagehide', leave);
    win.addEventListener('focus', back);
    win.addEventListener('pageshow', back);
  }

  subscribe(callback: () => void, minAwayMs = TAB_RETURN_MIN_AWAY_MS): () => void {
    const subscriber = { callback, minAwayMs };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

let shared: TabReturnSignal | null = null;

/** Calls `callback` once when the user comes back to the tab after at least `minAwayMs` away. */
export function onTabReturn(callback: () => void, minAwayMs = TAB_RETURN_MIN_AWAY_MS): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  shared ??= new TabReturnSignal(window, document);
  return shared.subscribe(callback, minAwayMs);
}

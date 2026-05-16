import { useState } from 'react';

const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4317/api').replace(/\/+$/, '');

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'sent'; email: string; devUrl: string | null }
  | { kind: 'error'; message: string };

interface Props {
  /** Размер формы — в hero крупнее, в финальной CTA-секции компактнее. */
  size?: 'lg' | 'md';
  /** Айди для skip-link / aria. */
  id?: string;
}

export default function EmailForm({ size = 'lg', id }: Props): React.ReactElement {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!email.trim()) return;
    setState({ kind: 'submitting' });
    try {
      const res = await fetch(`${API_BASE}/auth/magic/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        setState({ kind: 'error', message: 'Слишком много запросов. Подожди и попробуй ещё раз.' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error', message: 'Не удалось отправить ссылку. Проверь email и попробуй ещё раз.' });
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { devMagicUrl?: string };
      setState({ kind: 'sent', email, devUrl: data.devMagicUrl ?? null });
    } catch (err) {
      console.error('[EmailForm] request failed:', err);
      setState({ kind: 'error', message: 'Сеть недоступна. Попробуй ещё раз.' });
    }
  };

  if (state.kind === 'sent') {
    return (
      <div
        id={id}
        className="glass relative overflow-hidden rounded-2xl p-5 text-left animate-fade-up"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="size-5">
              <path d="M4 12.5l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-ink-50">Проверь почту</p>
            <p className="text-sm leading-relaxed text-ink-200">
              Ссылка для входа отправлена на <span className="text-ink-50">{state.email}</span>.
              Действует 15&nbsp;минут и работает один раз.
            </p>
            {state.devUrl && (
              <a
                href={state.devUrl}
                className="mt-2 block break-all rounded-md border border-dashed border-white/10 bg-white/5 p-2 font-mono text-[11px] text-accent-400 hover:bg-white/10"
              >
                dev: {state.devUrl}
              </a>
            )}
            <button
              type="button"
              onClick={() => setState({ kind: 'idle' })}
              className="mt-3 text-xs font-medium text-accent-400 hover:text-accent-500"
            >
              Указать другой email →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const inputCls =
    size === 'lg'
      ? 'h-12 px-4 text-base'
      : 'h-11 px-3.5 text-sm';
  const buttonCls =
    size === 'lg'
      ? 'h-12 px-6 text-base'
      : 'h-11 px-5 text-sm';

  return (
    <form id={id} onSubmit={handleSubmit} className="space-y-2">
      <div className="glass flex items-center gap-2 rounded-2xl p-1.5 shadow-glow transition-shadow focus-within:shadow-[0_0_100px_-15px_rgba(59,130,246,0.65)]">
        <label htmlFor={`${id ?? 'email'}-input`} className="sr-only">
          Email
        </label>
        <input
          id={`${id ?? 'email'}-input`}
          type="email"
          autoComplete="email"
          required
          placeholder="ты@домен.ру"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state.kind === 'submitting'}
          className={`${inputCls} flex-1 bg-transparent text-ink-50 placeholder:text-ink-400 focus:outline-none disabled:opacity-50`}
        />
        <button
          type="submit"
          disabled={state.kind === 'submitting'}
          className={`${buttonCls} inline-flex items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white transition-all hover:bg-accent-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {state.kind === 'submitting' ? (
            <>
              <span className="size-3.5 animate-slow-spin rounded-full border-2 border-white/30 border-t-white" />
              Отправляем
            </>
          ) : (
            <>
              Прислать ссылку
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                <path d="M4 10h12m0 0l-4-4m4 4l-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>
      </div>
      {state.kind === 'error' && (
        <p className="px-3 text-xs text-red-400" role="alert">
          {state.message}
        </p>
      )}
      {state.kind !== 'error' && (
        <p className="px-3 text-xs text-ink-300">
          Без паролей. Без подтверждений. Просто email — мы пришлём ссылку для входа.
        </p>
      )}
    </form>
  );
}

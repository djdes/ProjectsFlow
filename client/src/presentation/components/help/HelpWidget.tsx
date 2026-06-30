import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { LifeBuoy, MessageCircle, Sparkles, X } from 'lucide-react';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { cn } from '@/lib/utils';
import { HelpAssistantPanel } from './HelpAssistantPanel';
import { HelpSupportPanel } from './HelpSupportPanel';
import { ASSISTANT_PREVIEW_REPLY, type ChatMessage } from './assistantContent';

type HelpTab = 'assistant' | 'support';

const TABS: ReadonlyArray<{ value: HelpTab; label: string; icon: React.ReactNode }> = [
  { value: 'assistant', label: 'Помощник', icon: <Sparkles className="size-3.5" /> },
  { value: 'support', label: 'Поддержка', icon: <LifeBuoy className="size-3.5" /> },
];

// Плавающий виджет помощи снизу справа (в приложении). Две вкладки: «Помощник»
// (AI-превью — пока без реальных ответов, см. план P2) и «Поддержка» (рабочая форма →
// тикет + Telegram). Портал в <body>, fixed, над мобильным таб-баром (см. CLAUDE.md →
// PWA-инсеты). Анимации гейтятся useMotion (reduced-motion → мгновенно).
export function HelpWidget({
  defaultOpen = false,
  defaultTab = 'assistant',
}: {
  defaultOpen?: boolean;
  defaultTab?: HelpTab;
} = {}): React.ReactElement | null {
  const { animations } = useMotion();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<HelpTab>(defaultTab);
  // Префилл для вкладки «Поддержка» при переходе из AI («Написать в поддержку»).
  const [supportPrefill, setSupportPrefill] = useState('');
  // Лента AI-диалога живёт здесь, чтобы «Очистить» в шапке могла её сбросить.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seqRef = useRef(0);

  // Esc закрывает панель.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sendAssistant = useCallback((raw: string) => {
    const text = raw.trim();
    if (text.length === 0) return;
    setMessages((prev) => {
      const base = seqRef.current;
      seqRef.current = base + 2;
      return [
        ...prev,
        { id: base + 1, role: 'user', text },
        { id: base + 2, role: 'assistant', text: ASSISTANT_PREVIEW_REPLY, cta: true },
      ];
    });
  }, []);

  const clearAssistant = useCallback(() => setMessages([]), []);

  const goToSupport = useCallback((prefill: string) => {
    setSupportPrefill(prefill);
    setTab('support');
  }, []);

  if (typeof document === 'undefined') return null;

  const fabTransition = animations
    ? { type: 'spring' as const, stiffness: 420, damping: 28 }
    : { duration: 0 };
  const panelTransition = animations
    ? { type: 'spring' as const, stiffness: 380, damping: 32 }
    : { duration: 0 };

  const isAssistant = tab === 'assistant';
  const showClear = isAssistant && messages.length > 0;

  return createPortal(
    <div className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
      <AnimatePresence mode="popLayout">
        {open && (
          <motion.div
            key="panel"
            role="dialog"
            aria-label="Помощь и поддержка"
            initial={animations ? { opacity: 0, scale: 0.94, y: 18 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={animations ? { opacity: 0, scale: 0.94, y: 18 } : { opacity: 0 }}
            transition={panelTransition}
            style={{ transformOrigin: 'bottom right' }}
            className="pointer-events-auto flex h-[min(36rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-[24rem] flex-col overflow-hidden rounded-[1.4rem] border bg-background shadow-[0_24px_60px_-12px_rgba(0,0,0,0.32),0_8px_20px_-8px_rgba(0,0,0,0.18)]"
          >
            {/* Шапка — фирменный синий с мягким бликом и матовым бейджем. */}
            <div className="relative flex items-center gap-3 overflow-hidden bg-primary px-4 py-3.5 text-primary-foreground">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/20 via-white/5 to-transparent"
              />
              <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/15 shadow-inner ring-1 ring-white/25 backdrop-blur-sm">
                {isAssistant ? <Sparkles className="size-5" /> : <LifeBuoy className="size-5" />}
              </span>
              <div className="relative min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">
                  {isAssistant ? 'AI-помощник' : 'Связаться с поддержкой'}
                </p>
                <p className="truncate text-xs text-primary-foreground/75">
                  {isAssistant ? 'Подскажу, как пользоваться ProjectsFlow' : 'Ответим как можно скорее'}
                </p>
              </div>
              {showClear && (
                <button
                  type="button"
                  onClick={clearAssistant}
                  className="relative shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary-foreground/80 transition-colors hover:bg-white/15 hover:text-primary-foreground"
                >
                  Очистить
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
                className="relative grid size-8 shrink-0 place-items-center rounded-full text-primary-foreground/80 transition-colors hover:bg-white/15 hover:text-primary-foreground"
              >
                <X className="size-[1.05rem]" />
              </button>
            </div>

            {/* Переключатель вкладок — мягкий iOS-сегмент с пружинной пилюлей. */}
            <div className="px-3 pt-3">
              <div role="tablist" className="flex rounded-xl bg-muted p-1">
                {TABS.map((t) => {
                  const active = t.value === tab;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.value)}
                      className={cn(
                        'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium transition-colors',
                        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {active && (
                        <motion.span
                          aria-hidden
                          layoutId={animations ? 'help-tab-pill' : undefined}
                          transition={
                            animations ? { type: 'spring', stiffness: 480, damping: 36 } : { duration: 0 }
                          }
                          className="absolute inset-0 rounded-lg bg-background shadow-sm ring-1 ring-black/[0.04] dark:ring-white/10"
                        />
                      )}
                      <span className="relative z-10 inline-flex items-center gap-1.5">
                        {t.icon}
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Тело вкладки. */}
            {isAssistant ? (
              <HelpAssistantPanel
                messages={messages}
                onSend={sendAssistant}
                onGoToSupport={goToSupport}
              />
            ) : (
              <HelpSupportPanel initialMessage={supportPrefill} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB — показываем, когда панель закрыта. */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Помощь и поддержка"
            initial={animations ? { opacity: 0, scale: 0.6 } : false}
            animate={{ opacity: 1, scale: 1 }}
            exit={animations ? { opacity: 0, scale: 0.6 } : { opacity: 0 }}
            transition={fabTransition}
            whileHover={animations ? { scale: 1.06 } : undefined}
            whileTap={animations ? { scale: 0.92 } : undefined}
            className="pointer-events-auto relative grid size-14 place-items-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/35 ring-1 ring-black/5 transition-shadow hover:shadow-xl hover:shadow-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-transparent"
            />
            <MessageCircle className="relative size-6" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

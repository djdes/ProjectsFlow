import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { LifeBuoy, MessageCircle, Sparkles, X } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { HelpAssistantPanel } from './HelpAssistantPanel';
import { HelpSupportPanel } from './HelpSupportPanel';

type HelpTab = 'assistant' | 'support';

const TAB_OPTIONS = [
  { value: 'assistant' as const, label: 'Помощник', icon: <Sparkles className="size-3.5" /> },
  { value: 'support' as const, label: 'Поддержка', icon: <LifeBuoy className="size-3.5" /> },
];

// Плавающий виджет помощи снизу справа (в приложении). Две вкладки:
// «Помощник» (AI-превью — пока без реальных ответов, см. план P2) и «Поддержка»
// (рабочая форма → тикет + Telegram). Портал в <body>, fixed, над мобильным таб-баром
// (см. CLAUDE.md → PWA-инсеты). Анимации гейтятся useMotion (reduced-motion → мгновенно).
export function HelpWidget(): React.ReactElement | null {
  const { animations } = useMotion();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<HelpTab>('assistant');
  // Префилл для вкладки «Поддержка» при переходе из AI («Написать в поддержку»).
  const [supportPrefill, setSupportPrefill] = useState('');

  // Esc закрывает панель.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const goToSupport = useCallback((prefill: string) => {
    setSupportPrefill(prefill);
    setTab('support');
  }, []);

  if (typeof document === 'undefined') return null;

  const fabTransition = animations
    ? { type: 'spring' as const, stiffness: 420, damping: 28 }
    : { duration: 0 };
  const panelTransition = animations
    ? { type: 'spring' as const, stiffness: 360, damping: 30 }
    : { duration: 0 };

  return createPortal(
    <div
      // Контейнер-якорь: fixed снизу справа, над таб-баром на мобиле (4.5rem + safe-area),
      // обычный отступ на десктопе. pointer-events-none — клики проходят мимо пустых зон.
      className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-3 md:bottom-6 md:right-6"
    >
      <AnimatePresence mode="popLayout">
        {open && (
          <motion.div
            key="panel"
            role="dialog"
            aria-label="Помощь и поддержка"
            initial={animations ? { opacity: 0, scale: 0.92, y: 16 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={animations ? { opacity: 0, scale: 0.92, y: 16 } : { opacity: 0 }}
            transition={panelTransition}
            style={{ transformOrigin: 'bottom right' }}
            className="pointer-events-auto flex h-[min(34rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-[23rem] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
          >
            {/* Шапка — тёплый primary-градиент, как акцент на скринах, но в наших токенах. */}
            <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15">
                {tab === 'assistant' ? (
                  <Sparkles className="size-[1.125rem]" />
                ) : (
                  <LifeBuoy className="size-[1.125rem]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">
                  {tab === 'assistant' ? 'AI-помощник' : 'Связаться с поддержкой'}
                </p>
                <p className="truncate text-xs text-primary-foreground/80">
                  {tab === 'assistant' ? 'Подскажу, как пользоваться ProjectsFlow' : 'Ответим вам в Telegram'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
                className="grid size-8 shrink-0 place-items-center rounded-full text-primary-foreground/80 transition-colors hover:bg-white/15 hover:text-primary-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Переключатель вкладок. */}
            <div className="flex justify-center border-b px-4 py-2.5">
              <SegmentedControl<HelpTab>
                options={TAB_OPTIONS}
                value={tab}
                onChange={setTab}
                className="w-full max-w-[16rem]"
              />
            </div>

            {/* Тело вкладки. */}
            {tab === 'assistant' ? (
              <HelpAssistantPanel onGoToSupport={goToSupport} />
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
            whileTap={animations ? { scale: 0.94 } : undefined}
            className="pointer-events-auto grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-black/5 transition-shadow hover:shadow-xl hover:shadow-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MessageCircle className="size-6" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

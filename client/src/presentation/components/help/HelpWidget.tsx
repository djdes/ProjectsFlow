import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { LifeBuoy, Plus, Sparkles, X } from 'lucide-react';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import { announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
import { cn } from '@/lib/utils';
import { HelpAiPanel } from './HelpAiPanel';
import { HelpSupportPanel } from './HelpSupportPanel';
import { helpAiContextKey, type HelpAiSession } from './helpAiSession';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useMobileSheet } from '@/components/ui/mobile-sheet';

type HelpTab = 'ai' | 'support';
type OpenHelpDetail = {
  // 'assistant' — историческое имя вкладки ИИ, приезжает из старых вызовов.
  readonly tab?: HelpTab | 'assistant';
  readonly prefill?: string;
};

const TABS: ReadonlyArray<{ value: HelpTab; label: string; icon: React.ReactNode }> = [
  { value: 'ai', label: 'ИИ', icon: <Sparkles className="size-3.5" /> },
  { value: 'support', label: 'Поддержка', icon: <LifeBuoy className="size-3.5" /> },
];

// Notion-геометрия: круглая кнопка 40×40 в 31px от правого и нижнего края и панель
// шириной 360, прижатая к правому краю во всю высоту (без скругления и тени). Тень кнопки —
// токен меню C4 (кольцо + мягкая тень; в тёмной теме — кольцо цвета линии и глубокая тень).
const FAB_SHADOW = 'shadow-menu';

function normalizeTab(tab: OpenHelpDetail['tab']): HelpTab | null {
  if (tab === 'support') return 'support';
  if (tab === 'ai' || tab === 'assistant') return 'ai';
  return null;
}

/**
 * Правая AI-панель приложения (референс — Notion). Круглая кнопка поверх интерфейса,
 * по клику — немодальная панель у правого края: вкладка «ИИ» (настоящий чат) и
 * «Поддержка» (форма → тикет + Telegram). Портал в <body>, над мобильным таб-баром
 * (см. CLAUDE.md → PWA-инсеты). Анимации гейтятся useMotion.
 */
export function HelpWidget({
  defaultOpen = false,
  defaultTab = 'ai',
  showLauncher = true,
}: {
  defaultOpen?: boolean;
  defaultTab?: HelpTab;
  showLauncher?: boolean;
} = {}): React.ReactElement | null {
  const { animations } = useMotion();
  const mobile = useMobileSheet();
  const { aiConversationRepository } = useContainer();
  const { pathname } = useLocation();
  const { data: projects } = useProjects();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<HelpTab>(defaultTab);
  // Префилл для вкладки «Поддержка» при переходе из справочных ссылок.
  const [supportPrefill, setSupportPrefill] = useState('');
  const [session, setSession] = useState<HelpAiSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // По беседе на контекст: вернувшись в проект, пользователь получает свой чат,
  // а не безымянную новую пустышку.
  const sessions = useRef(new Map<string, HelpAiSession>());

  // Текущий проект берём из маршрута: панель висит над всем приложением и своего
  // роут-параметра не имеет.
  const routeProjectId = useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(pathname);
    return match ? match[1] : null;
  }, [pathname]);
  const routeProjectName = useMemo(() => {
    if (!routeProjectId) return null;
    return projects?.find((project) => project.id === routeProjectId)?.name ?? null;
  }, [projects, routeProjectId]);

  // Остальные экраны открывают панель через DOM-событие, не создавая прямую
  // зависимость между несвязанными presentation-компонентами.
  useEffect(() => {
    const onOpenHelp = (event: Event): void => {
      const detail = (event as CustomEvent<OpenHelpDetail>).detail;
      const next = normalizeTab(detail?.tab);
      if (next) setTab(next);
      if (typeof detail?.prefill === 'string') setSupportPrefill(detail.prefill);
      setOpen(true);
    };
    window.addEventListener('pf:open-help', onOpenHelp);
    return () => window.removeEventListener('pf:open-help', onOpenHelp);
  }, []);

  // Esc закрывает панель.
  useEffect(() => {
    if (!open || mobile) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mobile]);

  const startSession = useCallback(
    async (projectId: string | null, projectName: string | null, fresh = false): Promise<void> => {
      const key = helpAiContextKey(projectId);
      const cached = sessions.current.get(key);
      if (cached && !fresh) {
        setSession(cached);
        setCreateError(null);
        return;
      }
      setCreating(true);
      setCreateError(null);
      try {
        const conversation = await aiConversationRepository.create({
          kind: 'personal',
          title: projectName ? `ИИ · ${projectName}` : 'Новый чат',
          ...(projectId ? { projectId } : {}),
        });
        const next: HelpAiSession = { conversationId: conversation.id, projectId, projectName };
        sessions.current.set(key, next);
        setSession(next);
        announceAiConversationsChanged();
      } catch (reason) {
        setCreateError(reason instanceof Error ? reason.message : 'Не удалось начать чат');
      } finally {
        setCreating(false);
      }
    },
    [aiConversationRepository],
  );

  // Ленивое создание: беседа появляется при первом показе вкладки «ИИ», а не при
  // монтировании виджета.
  useEffect(() => {
    if (!open || tab !== 'ai') return;
    if (session || creating || createError) return;
    void startSession(routeProjectId, routeProjectName);
  }, [open, tab, session, creating, createError, routeProjectId, routeProjectName, startSession]);

  const newChat = useCallback(() => {
    const projectId = session ? session.projectId : routeProjectId;
    const projectName = session ? session.projectName : routeProjectName;
    void startSession(projectId, projectName, true);
  }, [routeProjectId, routeProjectName, session, startSession]);

  const startProjectChat = useCallback(() => {
    void startSession(routeProjectId, routeProjectName);
  }, [routeProjectId, routeProjectName, startSession]);

  if (typeof document === 'undefined') return null;

  const fabTransition = animations
    ? { type: 'spring' as const, stiffness: 420, damping: 28 }
    : { duration: 0 };

  const isAi = tab === 'ai';

  return createPortal(
    <>
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
          <SheetContent
            side="right"
            showClose={false}
            onPointerDownOutside={mobile ? undefined : (event) => event.preventDefault()}
            onFocusOutside={(event) => event.preventDefault()}
            // Панель немодальная: интерфейс слева остаётся кликабельным, страница не
            // сужается. Встык к краю окна — без скругления и тени, только разделитель.
            className="flex w-full flex-col overflow-hidden border-s bg-card p-0 shadow-none sm:max-w-[360px]"
          >
            <SheetTitle className="sr-only">ИИ и поддержка</SheetTitle>
            <SheetDescription className="sr-only">Помощник проекта и обращение в поддержку</SheetDescription>
            <header className="flex shrink-0 items-center gap-2 border-be px-2.5 py-2">
              <div role="tablist" className="flex min-w-0 flex-1 rounded-xl bg-foreground/[0.06] dark:border dark:border-border dark:bg-panel p-1">
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
                        'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-medium transition-colors',
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
                          className="absolute inset-0 rounded-lg bg-background shadow-[0_1px_2px_oklch(16.84%_0_none/0.12)] dark:bg-raised dark:shadow-none"
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
              {isAi && (
                <button
                  type="button"
                  onClick={newChat}
                  disabled={creating}
                  aria-label="Новая беседа"
                  title="Новая беседа"
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            {isAi ? (
              <HelpAiPanel
                session={session}
                creating={creating}
                error={createError}
                routeProjectId={routeProjectId}
                routeProjectName={routeProjectName}
                onRetry={startProjectChat}
                onStartProjectChat={startProjectChat}
              />
            ) : (
              <HelpSupportPanel initialMessage={supportPrefill} />
            )}
          </SheetContent>
      </Sheet>

      {/* On mobile the same action lives in the app header, clear of task controls. */}
      <AnimatePresence>
        {!open && showLauncher && (
          <motion.button
            key="fab"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Открыть ИИ и поддержку"
            initial={animations ? { opacity: 0, scale: 0.6 } : false}
            animate={{ opacity: 1, scale: 1 }}
            exit={animations ? { opacity: 0, scale: 0.6 } : { opacity: 0 }}
            transition={fabTransition}
            whileHover={animations ? { scale: 1.06 } : undefined}
            whileTap={animations ? { scale: 0.92 } : undefined}
            className={cn(
              'fixed inset-be-[calc(4.5rem+env(safe-area-inset-bottom,0px))] end-4 z-40 grid size-10 place-items-center',
              // Кнопка висит над контентом — подложка по наведению непрозрачная (bg-muted), а не bg-hover.
              'rounded-full bg-card text-foreground/80 transition-colors hover:bg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'md:inset-be-[31px] md:end-[31px]',
              FAB_SHADOW,
            )}
          >
            <Sparkles className="size-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

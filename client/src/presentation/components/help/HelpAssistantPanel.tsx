import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { cn } from '@/lib/utils';

// Частые вопросы про продукт — заглушка-подсказки в стиле скринов, но про ProjectsFlow.
const SUGGESTIONS: readonly string[] = [
  'Как создать проект и добавить задачи?',
  'Что такое воркер и автоматизация?',
  'Как подключить Telegram-уведомления?',
  'Как устроен финучёт по проекту?',
];

type ChatMessage = {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  // assistant-сообщение с кнопкой «Написать в поддержку» (превью: AI пока не отвечает).
  readonly cta?: boolean;
};

const ASSISTANT_PREVIEW_REPLY =
  'AI-помощник скоро заработает — он будет отвечать на вопросы про ProjectsFlow прямо здесь. ' +
  'А пока я передам ваш вопрос команде: ответим в Telegram.';

export function HelpAssistantPanel({
  onGoToSupport,
}: {
  onGoToSupport: (prefill: string) => void;
}): React.ReactElement {
  const { animations } = useMotion();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const nextId = (): number => {
    seqRef.current += 1;
    return seqRef.current;
  };

  const send = (raw: string): void => {
    const text = raw.trim();
    if (text.length === 0) return;
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text },
      { id: nextId(), role: 'assistant', text: ASSISTANT_PREVIEW_REPLY, cta: true },
    ]);
    // Прокрутка к низу после рендера.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const started = messages.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {/* Приветствие — всегда сверху. */}
        <div className="flex gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            Привет! Я&nbsp;помогу разобраться, как пользоваться ProjectsFlow. Спросите, например:
          </p>
        </div>

        {/* Чипы-подсказки — пока пусто (диалог не начат). */}
        {!started && (
          <div className="flex flex-col gap-2 pl-9">
            {SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s}
                type="button"
                onClick={() => send(s)}
                initial={animations ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={animations ? { delay: 0.04 * i, duration: 0.2 } : { duration: 0 }}
                className="rounded-xl border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
              >
                {s}
              </motion.button>
            ))}
          </div>
        )}

        {/* Лента диалога. */}
        <AnimatePresence initial={animations}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={animations ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={animations ? { duration: 0.22, ease: 'easeOut' } : { duration: 0 }}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'gap-2.5')}
            >
              {m.role === 'assistant' && (
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-3.5" />
                </span>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md bg-muted text-foreground',
                )}
              >
                <p>{m.text}</p>
                {m.cta && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onGoToSupport(lastUserMessage)}
                    className="mt-2 gap-1.5 bg-background"
                  >
                    Написать в поддержку
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Дисклеймер — мягкая «янтарная» плашка как на скринах, но в наших тонах. */}
        <div className="mt-auto rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200/90">
          Ответы AI&nbsp;— рекомендация. Окончательное решение всегда за&nbsp;вами.
        </div>
      </div>

      {/* Поле ввода. */}
      <div className="border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ваш вопрос…"
            aria-label="Вопрос AI-помощнику"
            className="h-10 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <Button
            type="submit"
            size="icon"
            disabled={input.trim().length === 0}
            aria-label="Отправить"
            className="size-10 shrink-0 rounded-xl"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

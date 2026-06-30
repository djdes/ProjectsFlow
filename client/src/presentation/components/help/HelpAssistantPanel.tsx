import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { cn } from '@/lib/utils';
import { ASSISTANT_SUGGESTIONS, type ChatMessage } from './assistantContent';

export function HelpAssistantPanel({
  messages,
  onSend,
  onGoToSupport,
}: {
  messages: readonly ChatMessage[];
  onSend: (text: string) => void;
  onGoToSupport: (prefill: string) => void;
}): React.ReactElement {
  const { animations } = useMotion();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Автопрокрутка к низу при новом сообщении.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (raw: string): void => {
    const text = raw.trim();
    if (text.length === 0) return;
    onSend(text);
    setInput('');
  };

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const started = messages.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        {/* Приветствие. */}
        <div className="flex gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            Привет! Помогу разобраться, как пользоваться ProjectsFlow. Спросите, например:
          </p>
        </div>

        {/* Чипы-подсказки — только пока диалог не начат. */}
        {!started && (
          <div className="flex flex-col gap-2 pl-9">
            {ASSISTANT_SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s}
                type="button"
                onClick={() => submit(s)}
                initial={animations ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={animations ? { delay: 0.05 * i, duration: 0.22 } : { duration: 0 }}
                className="group flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-left text-[13px] leading-snug text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-hover"
              >
                <span>{s}</span>
                <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </motion.button>
            ))}
          </div>
        )}

        {/* Лента диалога. */}
        <AnimatePresence initial={false}>
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
                  'max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'rounded-br-md bg-primary text-primary-foreground shadow-sm'
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
                    className="mt-2.5 h-8 gap-1.5 bg-background"
                  >
                    Написать в поддержку
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Дисклеймер — мягкая янтарная плашка (как на скринах), но в наших тонах. */}
        <div className="mt-auto rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200/90">
          Ответы AI&nbsp;— рекомендация. Окончательное решение всегда за&nbsp;вами.
        </div>
      </div>

      {/* Поле ввода. */}
      <div className="border-t bg-background/60 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ваш вопрос…"
            aria-label="Вопрос AI-помощнику"
            className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/25"
          />
          <button
            type="submit"
            disabled={input.trim().length === 0}
            aria-label="Отправить"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <Send className="size-[1.05rem]" />
          </button>
        </form>
      </div>
    </div>
  );
}

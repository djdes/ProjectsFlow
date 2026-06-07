import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { TaskComment } from '@/domain/task/TaskComment';

// Вопрос Ralph (F11) из маркера комментария. qid берём из поля `id` (так его регистрирует
// диспетчер), ответ матчится по полю `q` — см. dispatch.ps1 Register-PendingFromTaskComments
// и Scan-PfAnswers. Делаем сайт полноценным каналом ответа — как inline keyboard в CLI/Telegram.
export type RalphQuestion = {
  qid: string;
  type: 'single' | 'multi' | 'open';
  options: string[];
  allowOpen: boolean;
};

// Парсит маркер <!-- ralph-question {json} --> из тела комментария. null — если нет/битый.
export function parseRalphQuestion(body: string): RalphQuestion | null {
  const m = body.match(/<!--\s*ralph-question\s+(\{[\s\S]*?\})\s*-->/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    const qid = String(j.id ?? j.qid ?? '');
    if (!qid) return null;
    const t = j.type === 'multi' || j.type === 'open' ? j.type : 'single';
    const options = Array.isArray(j.options) ? j.options.map((o) => String(o)) : [];
    return { qid, type: t, options, allowOpen: j.allowOpen === true };
  } catch {
    return null;
  }
}

// Набор qid, на которые уже есть ralph-answer в треде (чтобы прятать кнопки после ответа).
export function answeredQidSet(comments: readonly TaskComment[]): Set<string> {
  const s = new Set<string>();
  for (const c of comments) {
    const m = c.body.match(/<!--\s*ralph-answer\s+(\{[\s\S]*?\})\s*-->/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>;
      const q = String(j.q ?? j.qid ?? '');
      if (q) s.add(q);
    } catch {
      /* ignore */
    }
  }
  return s;
}

// Инлайн-контролы ответа прямо под комментарием с вопросом (как inline keyboard в CLI/Telegram):
// single → кнопки-варианты (клик = ответ); multi → чекбоксы + «Готово»; open/allowOpen → поле ввода.
// Постит комментарий с маркером ralph-answer (q=qid, value); сервер вернёт задачу в работу,
// диспетчер распознает ответ.
export function RalphAnswerControls({
  question,
  projectId,
  taskId,
  onCreated,
}: {
  question: RalphQuestion;
  projectId: string;
  taskId: string;
  onCreated: (created: TaskComment) => void;
}): React.ReactElement {
  const { taskRepository } = useContainer();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openText, setOpenText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const post = async (value: string | string[]): Promise<void> => {
    if (submitting) return;
    const human = Array.isArray(value) ? value.join(', ') : value;
    if (!human.trim()) return;
    setSubmitting(true);
    try {
      const ans = JSON.stringify({ v: 1, q: question.qid, value, source: 'pf-web' });
      const body = `**✅ Ответ:** ${human}\n\n<!-- ralph-answer ${ans} -->`;
      const created = await taskRepository.createComment(projectId, taskId, body, { mode: 'none' });
      onCreated(created);
      toast.success('Ответ отправлен — Ralph продолжит работу');
    } catch (e) {
      toast.error(`Не удалось ответить: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (opt: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  };

  const isMulti = question.type === 'multi';
  const isOpenOnly = question.type === 'open' || question.options.length === 0;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-primary/20 bg-primary/[0.03] p-2">
      {!isOpenOnly && question.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((opt) =>
            isMulti ? (
              <button
                key={opt}
                type="button"
                disabled={submitting}
                onClick={() => toggle(opt)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50',
                  checked.has(opt)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30 hover:border-primary/60',
                )}
              >
                {opt}
              </button>
            ) : (
              <Button
                key={opt}
                type="button"
                size="sm"
                className="h-7 gap-1.5 px-3"
                disabled={submitting}
                onClick={() => void post(opt)}
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {opt}
              </Button>
            ),
          )}
        </div>
      )}
      {isMulti && (
        <Button
          type="button"
          size="sm"
          className="h-7 w-fit gap-1.5 px-3"
          disabled={submitting || checked.size === 0}
          onClick={() => void post(Array.from(checked))}
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Готово
        </Button>
      )}
      {(question.allowOpen || isOpenOnly) && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={openText}
            onChange={(e) => setOpenText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void post(openText);
              }
            }}
            placeholder={isOpenOnly ? 'Ответь словами…' : 'или ответь словами…'}
            disabled={submitting}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs focus:border-primary/50 focus:outline-none disabled:opacity-50"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 px-3"
            disabled={submitting || openText.trim().length === 0}
            onClick={() => void post(openText)}
          >
            Отправить
          </Button>
        </div>
      )}
    </div>
  );
}

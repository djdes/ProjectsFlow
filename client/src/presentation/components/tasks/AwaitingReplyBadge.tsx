import { AtSign } from 'lucide-react';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';

// «Ответить»: в задаче мне адресовали комментарий, а я ещё не ответил. Тон приёмки —
// «ждёт вашего решения»; подсказка показывает, кто и о чём спросил.
export function AwaitingReplyBadge({
  question,
}: {
  question: AwaitingReplyTask['question'];
}): React.ReactElement {
  const who = question.authorDisplayName || 'Коллега';
  return (
    <span
      data-pf-awaiting-reply
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-approval-soft px-1.5 py-px font-medium text-approval-ink"
      title={`${who} ждёт вашего ответа: ${question.excerpt}`}
    >
      <AtSign aria-hidden className="size-3" />
      Ответить
    </span>
  );
}

import { cn } from '@/lib/utils';
import { parseTitleHeading } from '@/lib/taskTitleBody';
import { MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';

// Типографика текста задачи на карточках (доска проекта и «Входящие») — одна на обе
// поверхности, чтобы карточка выглядела одинаково, где бы её ни увидели.
//
// Первая строка по умолчанию обычной жирности: задача, написанная одним абзацем, иначе
// превращалась в сплошной жирный блок. Полужирным остаётся то, что выделил автор: `**…**`
// (так композер из Telegram оформляет заголовок; рендерится через TaskTitleText authoredBold)
// и markdown-заголовок `# …`.
export function taskCardTitleClass(rawTitle: string): string {
  return cn(
    // Дизайн C4: заголовок карточки 13.5px.
    'text-task leading-snug',
    parseTitleHeading(rawTitle).level > 0 ? 'font-semibold' : 'font-normal',
    'text-foreground',
  );
}

// Тело — подпись вторичным цветом, 12.5px (дизайн C4). Выделенные слова (`**…**`) — средней
// жирности и основного цвета: раньше они были жирнее самого заголовка и спорили с ним за
// внимание. Заголовки разметки внутри тела не «раздуваются» — выглядят как обычный текст.
export const TASK_CARD_BODY_CLASS = cn(
  MARKDOWN_COMPACT,
  'mbs-0.5 text-meta leading-[1.42] text-muted-foreground',
  '[&_h1]:text-meta [&_h2]:text-meta [&_h3]:text-meta [&_h4]:text-meta',
  '[&_h1]:font-normal [&_h2]:font-normal [&_h3]:font-normal [&_h4]:font-normal',
  '[&_strong]:font-medium [&_b]:font-medium [&_strong]:text-foreground [&_b]:text-foreground',
);

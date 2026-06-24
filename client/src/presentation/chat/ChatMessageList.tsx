import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/domain/chat/ChatMessage';
import { ChatBubble } from './ChatBubble';

type Props = {
  readonly messages: ChatMessage[];
  readonly currentUserId: string;
  readonly canModerate: boolean;
  readonly hasMoreOlder: boolean;
  readonly loadingOlder: boolean;
  readonly loadOlder: () => void;
  readonly onReply: (m: ChatMessage) => void;
  readonly onEdit: (m: ChatMessage) => void;
  readonly onDelete: (m: ChatMessage) => void;
  readonly onToggleReaction: (messageId: string, emoji: string, reactedByMe: boolean) => void;
  readonly onReachedBottom: () => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
};

const BOTTOM_THRESHOLD = 80;
const TOP_THRESHOLD = 120;

// Группируем подряд идущие сообщения одного автора в коротком окне (показываем имя/аватар
// только у первого). Возвращает true, если у сообщения нужно показать автора.
function showAuthorFor(messages: ChatMessage[], i: number): boolean {
  if (i === 0) return true;
  const prev = messages[i - 1]!;
  const cur = messages[i]!;
  if (prev.authorUserId !== cur.authorUserId) return true;
  // Разрыв > 5 минут — новая «голова» группы.
  return cur.createdAt.getTime() - prev.createdAt.getTime() > 5 * 60 * 1000;
}

export function ChatMessageList(props: Props): React.ReactElement {
  const { messages, currentUserId } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const atBottomRef = useRef(true);
  const beforeRef = useRef({ scrollHeight: 0, atBottom: true });
  const prevFirstSeq = useRef<number | null>(null);
  const prevLastSeq = useRef<number | null>(null);
  const [showPill, setShowPill] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowPill(false);
    setNewCount(0);
    props.onReachedBottom();
  }, [props]);

  // Перед обновлением DOM запоминаем метрики (через onScroll держим их свежими).
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    beforeRef.current = { scrollHeight: el.scrollHeight, atBottom };
    if (atBottom && showPill) {
      setShowPill(false);
      setNewCount(0);
      props.onReachedBottom();
    }
    if (el.scrollTop < TOP_THRESHOLD && props.hasMoreOlder && !props.loadingOlder) {
      props.loadOlder();
    }
  };

  // Поддержание позиции: prepend (скролл вверх) сохраняет якорь; append прилипает к низу.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = messages[0]?.seq ?? null;
    const last = messages.at(-1)?.seq ?? null;
    const prevFirst = prevFirstSeq.current;
    const prevLast = prevLastSeq.current;

    const isPrepend = prevFirst !== null && first !== null && first < prevFirst;
    const isAppend = prevLast !== null && last !== null && last > prevLast;
    const firstLoad = prevLast === null && last !== null;

    if (firstLoad) {
      el.scrollTop = el.scrollHeight;
      props.onReachedBottom();
    } else if (isPrepend) {
      // Компенсируем прирост высоты сверху — вид не «прыгает».
      el.scrollTop = el.scrollHeight - beforeRef.current.scrollHeight + el.scrollTop;
    } else if (isAppend) {
      const ownNew = messages.at(-1)?.authorUserId === currentUserId;
      if (beforeRef.current.atBottom || ownNew) {
        el.scrollTop = el.scrollHeight;
        props.onReachedBottom();
      } else {
        setShowPill(true);
        setNewCount((n) => n + 1);
      }
    }

    prevFirstSeq.current = first;
    prevLastSeq.current = last;
    beforeRef.current = { scrollHeight: el.scrollHeight, atBottom: atBottomRef.current };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Drag-выделение: зажать в области рядом с сообщением и протянуть мышью → сообщения под
  // протяжкой выделяются (для массового удаления). На пузыре/кнопке/ссылке не начинаем —
  // там работает выделение текста / клик.
  const dragStart = useRef<{ y: number; base: Set<string> } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onSelMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-chat-bubble]') || t.closest('button') || t.closest('a')) return;
    dragStart.current = { y: e.clientY, base: new Set(props.selectedIds) };
  };
  const onSelMouseMove = (e: React.MouseEvent): void => {
    const d = dragStart.current;
    if (!d) return;
    const lo = Math.min(d.y, e.clientY);
    const hi = Math.max(d.y, e.clientY);
    if (hi - lo < 5) return;
    if (!dragging) setDragging(true);
    const next = new Set(d.base);
    for (const [id, node] of rowRefs.current) {
      const r = node.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      if (mid >= lo && mid <= hi) next.add(id);
    }
    props.onSelectionChange(next);
    window.getSelection()?.removeAllRanges();
  };
  const endSelDrag = (): void => {
    dragStart.current = null;
    if (dragging) setDragging(false);
  };

  const jumpTo = useCallback((messageId: string) => {
    const node = rowRefs.current.get(messageId);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1600);
  }, []);

  useEffect(() => {
    if (highlightId === null) return;
    // авто-сброс подстрахован в jumpTo; здесь ничего не делаем.
  }, [highlightId]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onMouseDown={onSelMouseDown}
        onMouseMove={onSelMouseMove}
        onMouseUp={endSelDrag}
        onMouseLeave={endSelDrag}
        className={cn('pf-scroll-visible h-full space-y-0.5 px-0.5 py-1', dragging && 'select-none')}
      >
        {props.loadingOlder && (
          <div className="py-2 text-center text-xs text-muted-foreground">Загрузка…</div>
        )}
        {!props.hasMoreOlder && messages.length > 0 && (
          <div className="py-2 text-center text-[11px] text-muted-foreground/70">
            Начало переписки
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={m.id}
            ref={(node) => {
              if (node) rowRefs.current.set(m.id, node);
              else rowRefs.current.delete(m.id);
            }}
            onDoubleClick={() => props.onReply(m)}
            className={cn(
              'rounded-lg transition-colors',
              highlightId === m.id && 'bg-primary/10',
              props.selectedIds.has(m.id) && 'bg-primary/15 ring-1 ring-inset ring-primary/30',
            )}
          >
            <ChatBubble
              message={m}
              isOwn={m.authorUserId === currentUserId}
              showAuthor={showAuthorFor(messages, i)}
              currentUserId={currentUserId}
              onReply={props.onReply}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
              onToggleReaction={props.onToggleReaction}
              onJumpTo={jumpTo}
              canModerate={props.canModerate}
            />
          </div>
        ))}
      </div>

      {/* пилюля «↓ новые» */}
      {showPill && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md transition-transform hover:scale-105"
        >
          <ArrowDown className="size-3.5" />
          {newCount > 0 ? `${newCount} новых` : 'Вниз'}
        </button>
      )}
    </div>
  );
}

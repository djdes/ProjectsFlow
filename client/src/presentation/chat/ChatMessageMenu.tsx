import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { CornerUpLeft, Copy, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

type ReactionLite = { readonly emoji: string; readonly userIds: readonly string[] };

// Цель контекст-меню сообщения: координаты клика + данные для пунктов.
export type ChatMenuTarget = {
  readonly x: number;
  readonly y: number;
  readonly isOwn: boolean;
  readonly canModerate: boolean;
  readonly currentUserId: string;
  readonly body: string;
  readonly reactions: readonly ReactionLite[];
};

// Контекст-меню сообщения в стиле TG: открывается в точке клика (правый клик / long-press /
// «⋯»), портал в body — не обрезается и не зависит от ширины пузыря. Сверху ряд эмодзи,
// ниже действия. Отлетает от краёв экрана; закрывается по клику снаружи / Esc / скроллу.
export function ChatMessageMenu({
  target,
  onClose,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  readonly target: ChatMenuTarget;
  readonly onClose: () => void;
  readonly onReact: (emoji: string, reactedByMe: boolean) => void;
  readonly onReply: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement {
  const { animations } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // После монтирования замеряем меню и отлетаем от краёв экрана.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = target.x;
    let top = target.y;
    if (left + r.width > window.innerWidth - pad) left = window.innerWidth - r.width - pad;
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, target.y - r.height);
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [target.x, target.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDownOutside = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDownOutside, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', onDownOutside, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const reactedByMe = (emoji: string): boolean =>
    target.reactions.find((r) => r.emoji === emoji)?.userIds.includes(target.currentUserId) ?? false;

  const item =
    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06]';

  return createPortal(
    <motion.div
      ref={ref}
      initial={animations ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      style={{ position: 'fixed', left: pos.left, top: pos.top, transformOrigin: 'top left' }}
      className="z-[60] w-52 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* быстрые реакции */}
      <div className="flex justify-between gap-0.5 px-1 pb-1">
        {QUICK_EMOJIS.map((e) => {
          const mine = reactedByMe(e);
          return (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e, mine);
                onClose();
              }}
              className={cn(
                'grid size-8 place-items-center rounded-md text-lg transition-transform hover:scale-110',
                mine && 'bg-primary/10',
              )}
            >
              {e}
            </button>
          );
        })}
      </div>

      <div className="my-1 h-px bg-border" />

      <button
        type="button"
        className={item}
        onClick={() => {
          onReply();
          onClose();
        }}
      >
        <CornerUpLeft className="size-4" />
        Ответить
      </button>
      <button
        type="button"
        className={item}
        onClick={() => {
          void navigator.clipboard?.writeText(target.body);
          onClose();
        }}
      >
        <Copy className="size-4" />
        Копировать текст
      </button>
      {target.isOwn && (
        <button
          type="button"
          className={item}
          onClick={() => {
            onEdit();
            onClose();
          }}
        >
          <Pencil className="size-4" />
          Редактировать
        </button>
      )}
      {(target.isOwn || target.canModerate) && (
        <button
          type="button"
          className={cn(item, 'text-destructive hover:bg-destructive/10')}
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 className="size-4" />
          Удалить
        </button>
      )}
    </motion.div>,
    document.body,
  );
}

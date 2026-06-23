import { useState } from 'react';
import { motion } from 'motion/react';
import { CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import type { ChatMessage } from '@/domain/chat/ChatMessage';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

// Подсветка @упоминаний (приблизительно: токен @… до пробела). Линкификация опущена в v1.
function renderBody(body: string): React.ReactNode {
  const parts = body.split(/(@[^\s@]+)/g);
  return parts.map((p, i) =>
    p.startsWith('@') ? (
      <span key={i} className="font-medium text-primary">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

type Props = {
  readonly message: ChatMessage;
  readonly isOwn: boolean;
  readonly showAuthor: boolean;
  readonly currentUserId: string;
  readonly onReply: (m: ChatMessage) => void;
  readonly onEdit: (m: ChatMessage) => void;
  readonly onDelete: (m: ChatMessage) => void;
  readonly onToggleReaction: (messageId: string, emoji: string, reactedByMe: boolean) => void;
  readonly onJumpTo: (messageId: string) => void;
  readonly canModerate: boolean;
};

export function ChatBubble({
  message,
  isOwn,
  showAuthor,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onJumpTo,
  canModerate,
}: Props): React.ReactElement {
  const { animations } = useMotion();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (message.deleted) {
    return (
      <div className={cn('flex px-2 py-0.5', isOwn ? 'justify-end' : 'justify-start')}>
        <div className="rounded-2xl bg-foreground/[0.04] px-3 py-1.5 text-xs italic text-muted-foreground dark:bg-white/[0.04]">
          Сообщение удалено
        </div>
      </div>
    );
  }

  const Wrapper = animations ? motion.div : 'div';
  const motionProps = animations
    ? {
        initial: { opacity: 0, y: 8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { type: 'spring' as const, stiffness: 500, damping: 34, mass: 0.7 },
        layout: true,
      }
    : {};

  return (
    <Wrapper
      {...motionProps}
      className={cn('group flex gap-2 px-2 py-0.5', isOwn ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Аватар (только у чужих и только на первом сообщении группы) */}
      {!isOwn && (
        <div className="w-7 shrink-0">
          {showAuthor &&
            (message.authorAvatarUrl ? (
              <img
                src={message.authorAvatarUrl}
                alt=""
                className="size-7 rounded-full object-cover"
              />
            ) : (
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full text-[11px] font-semibold',
                  avatarColor(message.authorDisplayName),
                )}
              >
                {getInitials(message.authorDisplayName)}
              </span>
            ))}
        </div>
      )}

      <div className={cn('relative min-w-0 max-w-[85%]', isOwn ? 'items-end' : 'items-start')}>
        {showAuthor && !isOwn && (
          <div className="mb-0.5 px-1 text-xs font-medium text-primary/90">
            {message.authorDisplayName}
          </div>
        )}

        <div
          className={cn(
            'relative rounded-2xl px-3 py-1.5 text-sm',
            isOwn
              ? 'bg-primary text-primary-foreground'
              : 'bg-foreground/[0.05] text-foreground dark:bg-white/[0.07]',
          )}
        >
          {/* reply-цитата */}
          {message.replyTo && (
            <button
              type="button"
              onClick={() => onJumpTo(message.replyTo!.id)}
              className={cn(
                'mb-1 flex w-full flex-col items-start rounded-md border-l-2 px-2 py-0.5 text-left text-xs',
                isOwn
                  ? 'border-primary-foreground/50 bg-primary-foreground/10'
                  : 'border-primary/50 bg-primary/5',
              )}
            >
              <span className="font-medium opacity-90">{message.replyTo.authorDisplayName}</span>
              <span className="line-clamp-1 opacity-70">{message.replyTo.excerpt}</span>
            </button>
          )}

          {message.body && (
            <div className="whitespace-pre-wrap break-words">{renderBody(message.body)}</div>
          )}

          {/* вложения */}
          {message.attachments.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {message.attachments.map((a) =>
                a.mimeType.startsWith('image/') ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={a.url}
                      alt={a.filename}
                      className="max-h-48 w-auto rounded-lg object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    download={a.filename}
                    className={cn(
                      'truncate rounded-md px-2 py-1 text-xs underline-offset-2 hover:underline',
                      isOwn ? 'bg-primary-foreground/10' : 'bg-foreground/[0.04] dark:bg-white/[0.05]',
                    )}
                  >
                    📎 {a.filename}
                  </a>
                ),
              )}
            </div>
          )}

          <div
            className={cn(
              'mt-0.5 flex items-center gap-1 text-[10px]',
              isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
          >
            <span>{formatTime(message.createdAt)}</span>
            {message.editedAt && <span>· изм.</span>}
          </div>
        </div>

        {/* реакции */}
        {message.reactions.length > 0 && (
          <div className={cn('mt-0.5 flex flex-wrap gap-1', isOwn ? 'justify-end' : 'justify-start')}>
            {message.reactions.map((r) => {
              const mine = r.userIds.includes(currentUserId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onToggleReaction(message.id, r.emoji, mine)}
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
                    mine
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-transparent bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.08] dark:bg-white/[0.06]',
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* hover-тулбар действий */}
        <div
          className={cn(
            'absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border bg-background px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            isOwn ? 'left-0' : 'right-0',
          )}
        >
          <div className="relative">
            <button
              type="button"
              aria-label="Реакция"
              onClick={() => setPickerOpen((v) => !v)}
              className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <SmilePlus className="size-3.5" />
            </button>
            {pickerOpen && (
              <div
                className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border bg-background p-1 shadow-md"
                style={isOwn ? { left: 0 } : { right: 0 }}
              >
                {QUICK_EMOJIS.map((e) => {
                  const mine = message.reactions.find((r) => r.emoji === e)?.userIds.includes(currentUserId) ?? false;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        onToggleReaction(message.id, e, mine);
                        setPickerOpen(false);
                      }}
                      className="grid size-7 place-items-center rounded-full text-base hover:bg-foreground/[0.06]"
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Ответить"
            onClick={() => onReply(message)}
            className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <CornerUpLeft className="size-3.5" />
          </button>
          {isOwn && (
            <button
              type="button"
              aria-label="Редактировать"
              onClick={() => onEdit(message)}
              className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {(isOwn || canModerate) && (
            <button
              type="button"
              aria-label="Удалить"
              onClick={() => onDelete(message)}
              className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </Wrapper>
  );
}

import { useState } from 'react';
import { motion } from 'motion/react';
import { CornerUpLeft, Download, Pencil, SmilePlus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null);

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
            'relative rounded-2xl px-3 py-1.5 text-sm text-foreground',
            // Мягкий полупрозрачный акцент вместо «бьющего» синего — нежно, как в TG.
            isOwn
              ? 'bg-primary/10 dark:bg-primary/20'
              : 'bg-foreground/[0.05] dark:bg-white/[0.06]',
          )}
        >
          {/* reply-цитата */}
          {message.replyTo && (
            <button
              type="button"
              onClick={() => onJumpTo(message.replyTo!.id)}
              className="mb-1 flex w-full flex-col items-start rounded-md border-l-2 border-primary/40 bg-primary/5 px-2 py-0.5 text-left text-xs"
            >
              <span className="font-medium text-primary/90">{message.replyTo.authorDisplayName}</span>
              <span className="line-clamp-1 text-muted-foreground">{message.replyTo.excerpt}</span>
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
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPreview({ url: a.url, filename: a.filename })}
                    className="block overflow-hidden rounded-lg transition-transform hover:scale-[1.01]"
                  >
                    <img
                      src={a.url}
                      alt={a.filename}
                      className="max-h-48 w-auto rounded-lg object-cover"
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    download={a.filename}
                    className="truncate rounded-md bg-foreground/[0.04] px-2 py-1 text-xs underline-offset-2 hover:underline dark:bg-white/[0.05]"
                  >
                    📎 {a.filename}
                  </a>
                ),
              )}
            </div>
          )}

          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
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

        {/* Действия: портал-меню (DropdownMenu) — НЕ обрезается скроллом, в отличие от
            прежнего абсолютного тулбара над пузырём. Триггер сидит во внутреннем углу. */}
        <div
          className={cn(
            'absolute top-0.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 data-[state=open]:opacity-100',
            isOwn ? 'left-0.5' : 'right-0.5',
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Действия с сообщением"
                className="grid size-6 place-items-center rounded-full border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
              >
                <SmilePlus className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align={isOwn ? 'start' : 'end'} className="w-auto min-w-44 p-1">
              <div className="flex gap-0.5 pb-1">
                {QUICK_EMOJIS.map((e) => {
                  const mine =
                    message.reactions.find((r) => r.emoji === e)?.userIds.includes(currentUserId) ?? false;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onToggleReaction(message.id, e, mine)}
                      className={cn(
                        'grid size-7 place-items-center rounded-md text-base transition-transform hover:scale-110 hover:bg-foreground/[0.06]',
                        mine && 'bg-primary/10',
                      )}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onReply(message)}>
                <CornerUpLeft />
                Ответить
              </DropdownMenuItem>
              {isOwn && (
                <DropdownMenuItem onSelect={() => onEdit(message)}>
                  <Pencil />
                  Редактировать
                </DropdownMenuItem>
              )}
              {(isOwn || canModerate) && (
                <DropdownMenuItem
                  onSelect={() => onDelete(message)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 />
                  Удалить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Лайтбокс картинки — открываем прямо на сайте (модалка), а не отдельной вкладкой. */}
      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="grid max-h-[90dvh] max-w-3xl gap-0 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="truncate text-sm font-medium">{preview?.filename ?? ''}</p>
            <div className="flex items-center gap-1">
              <a
                href={preview?.url}
                download={preview?.filename}
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Скачать"
              >
                <Download className="size-4" />
              </a>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Закрыть"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid place-items-center overflow-auto bg-muted/30 p-2 sm:p-4">
            {preview && (
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-h-[75dvh] max-w-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Wrapper>
  );
}

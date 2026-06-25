import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useContainer } from '@/infrastructure/di/container';
import type { ChatParticipant } from '@/domain/chat/ChatParticipant';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { fadeInUp, staggerContainer } from '@/presentation/components/motion/presets';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';

// Поповер состава чат-комнаты: триггер — чип «кол-во участников» в шапке чата (и иконка,
// и число — единая кликабельная цель). На открытие тянет участников через контейнер
// (HTTP-репозиторий чата), показывает аватар + имя + приглушённый email. Минимализм,
// токены сайта; мягкое появление, гейтится useMotion().
export function ParticipantsPopover({
  workspaceId,
  memberCount,
}: {
  readonly workspaceId: string;
  readonly memberCount: number;
}): React.ReactElement {
  const { chatRepository } = useContainer();
  const { animations } = useMotion();
  const [open, setOpen] = useState(false);
  const [participants, setParticipants] = useState<ChatParticipant[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Грузим только при первом открытии (как открытая SSE-вкладка — ленивая загрузка по требованию).
  useEffect(() => {
    if (!open || participants !== null || loading) return;
    let alive = true;
    setLoading(true);
    setError(false);
    chatRepository
      .listRoomParticipants(workspaceId)
      .then((list) => {
        if (alive) setParticipants(list);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, participants, loading, chatRepository, workspaceId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Участники чата"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <Users className="size-3.5" />
          {memberCount}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 max-w-[calc(100vw-1.5rem)] p-1.5"
      >
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Участники</div>
        {loading ? (
          <div className="px-1.5 py-2 text-sm text-muted-foreground">Загрузка…</div>
        ) : error ? (
          <div className="px-1.5 py-2 text-sm text-destructive">Не удалось загрузить.</div>
        ) : participants && participants.length > 0 ? (
          <motion.ul
            variants={animations ? staggerContainer : undefined}
            initial={animations ? 'hidden' : false}
            animate="visible"
            className="max-h-72 space-y-0.5 overflow-y-auto"
          >
            {participants.map((p) => (
              <motion.li
                key={p.userId}
                variants={animations ? fadeInUp : undefined}
                className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-foreground/[0.06]"
              >
                <UserAvatar
                  displayName={p.displayName}
                  avatarUrl={p.avatarUrl}
                  className="size-8 text-xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.displayName}</div>
                  {p.email && (
                    <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                  )}
                </div>
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <div className="px-1.5 py-2 text-sm text-muted-foreground">Пока никого нет.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

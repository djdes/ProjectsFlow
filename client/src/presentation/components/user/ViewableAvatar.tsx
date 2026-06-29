import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from './UserAvatar';

// Аватар, который по клику открывается во весь размер (lightbox-диалог) — чтобы
// рассмотреть фото. Если фото нет (avatarUrl пустой) — показываем крупные инициалы.
// Используется там, где аватар «свой» и есть смысл посмотреть: шапка переключателя
// воркспейсов (слева сверху) и страница профиля (настройки).
export function ViewableAvatar({
  displayName,
  avatarUrl,
  className,
}: {
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Внутри dropdown/триггеров — не даём клику всплыть и закрыть/навигировать.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-[25%] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        title="Посмотреть аватар"
        aria-label={`Посмотреть аватар: ${displayName}`}
      >
        <UserAvatar displayName={displayName} avatarUrl={avatarUrl} className={className} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[92vw] border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Аватар: {displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            Полноразмерный аватар пользователя {displayName}
          </DialogDescription>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="max-h-[80vh] max-w-[92vw] rounded-2xl object-contain"
            />
          ) : (
            <UserAvatar
              displayName={displayName}
              avatarUrl={null}
              className="size-64 max-w-[80vw] text-7xl"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from './AuthProvider';

// Администратор вошёл от имени пользователя (админка → «Войти как»): плашка поверх интерфейса
// напоминает, чьими глазами он смотрит, и возвращает в его учётную запись.
export function ImpersonationBanner(): React.ReactElement | null {
  const { user } = useAuth();
  const { authRepository } = useContainer();
  const [busy, setBusy] = useState(false);
  if (!user?.impersonatedBy) return null;

  const back = (): void => {
    setBusy(true);
    authRepository
      .stopImpersonation()
      // Полная перезагрузка: всё состояние приложения сейчас пользовательское.
      .then(() => window.location.assign('/admin'))
      .catch((e: unknown) => {
        setBusy(false);
        toast.error(actionErrorMessage(e, 'Не удалось вернуться в свою учётную запись'));
      });
  };

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 inset-be-[calc(4.5rem_+_env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-3 md:inset-be-4"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-foreground py-1.5 ps-3 pe-1.5 text-ui text-background shadow-float">
        <Eye className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          Вы смотрите как <span className="font-semibold">{user.displayName}</span>
        </span>
        <button
          type="button"
          onClick={back}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/15 px-2.5 py-1 font-medium transition-colors hover:bg-background/25 disabled:opacity-60"
        >
          <LogOut className="size-3.5" aria-hidden />
          Вернуться в админку
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { cn } from '@/lib/utils';
import { isDesktopAppOnline } from '@/domain/desktop-notes/DesktopNote';
import { useDesktopNotes } from '@/presentation/hooks/useDesktopNotes';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';

// «На экран»: закрепляет задачу стикером поверх окон (приложение «ProjectsFlow Заметки»).
// Только для компьютера — на телефоне стикерам негде жить: там кнопка не монтируется вовсе,
// и список заметок (/desktop-notes) телефон не запрашивает.
export function PinToScreenButton({ taskId }: { taskId: string }): React.ReactElement | null {
  const wide = useMediaQuery('(min-width: 640px)');
  return wide ? <PinToScreenToggle taskId={taskId} /> : null;
}

function PinToScreenToggle({ taskId }: { taskId: string }): React.ReactElement {
  const navigate = useNavigate();
  const { isPinned, pin, unpin } = useDesktopNotes();
  const [busy, setBusy] = useState(false);
  const pinned = isPinned(taskId);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (pinned) {
        await unpin(taskId);
        toast.success('Заметка убрана с экрана');
        return;
      }
      const fresh = await pin(taskId);
      if (isDesktopAppOnline(fresh, Date.now())) {
        toast.success('Задача на экране');
      } else {
        toast.success('Задача закреплена', {
          description: 'Чтобы она появилась на экране, установите приложение «Заметки» для Windows.',
          action: { label: 'Установить', onClick: () => navigate('/desktop-notes') },
          duration: 10000,
        });
      }
    } catch (e) {
      toast.error(actionErrorMessage(e, pinned ? 'Не удалось убрать заметку' : 'Не удалось закрепить задачу'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      aria-pressed={pinned}
      title={pinned ? 'Убрать заметку с экрана' : 'Закрепить задачу заметкой поверх окон'}
      className={cn(
        'h-8 shrink-0 gap-1.5 px-2',
        pinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={() => void toggle()}
    >
      <StickyNote className={cn('size-4', pinned && 'fill-primary/20 text-primary')} />
      <span className="hidden text-sm xl:inline">{pinned ? 'На экране' : 'На экран'}</span>
    </Button>
  );
}

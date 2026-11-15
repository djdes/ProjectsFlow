import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, StickyNote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { actionErrorMessage } from '@/lib/actionFeedback';
import { cn } from '@/lib/utils';
import {
  DESKTOP_NOTES_DOWNLOAD_URL,
  isDesktopAppOnline,
  type DesktopNote,
} from '@/domain/desktop-notes/DesktopNote';
import { useDesktopNotes } from '@/presentation/hooks/useDesktopNotes';
import { SectionPage } from '@/presentation/pages/SectionPage';

// Страница приложения «ProjectsFlow Заметки»: скачать, как подключить, что сейчас на экране.
export function DesktopNotesPage(): React.ReactElement {
  const { state, unpin, refresh } = useDesktopNotes();
  // Статус приложения сверяем с моментом открытия страницы; список при этом перечитываем.
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const online = state ? isDesktopAppOnline(state, openedAt) : false;

  const remove = async (note: DesktopNote): Promise<void> => {
    try {
      await unpin(note.taskId);
    } catch (e) {
      toast.error(actionErrorMessage(e, 'Не удалось убрать заметку'));
    }
  };

  return (
    <SectionPage icon={StickyNote} label="Заметки на рабочем столе" back={{ to: '/', label: 'Назад к задачам' }} narrow>
      <div className="space-y-5">
        <Card>
          <CardContent className="grid gap-6 pbs-6 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Закрепите задачу кнопкой «На экран» — она появится маленьким стикером поверх всех окон,
                как бумажная заметка на мониторе. Стикер можно перетащить куда угодно, сменить цвет
                и снять, когда задача сделана.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <a href={DESKTOP_NOTES_DOWNLOAD_URL} download="ProjectsFlowNotes.exe">
                    <Download className="size-4" /> Скачать для Windows
                  </a>
                </Button>
                <AppStatus loading={!state} online={online} everConnected={Boolean(state?.appLastSeenAt)} />
              </div>
              <ol className="space-y-1.5 text-sm">
                <Step n={1}>Запустите скачанный файл — установка не нужна, приложение само добавится в автозапуск.</Step>
                <Step n={2}>Откроется браузер — нажмите «Подключить». Пароль вводить не придётся.</Step>
                <Step n={3}>В любой задаче нажмите «На экран» — через пару секунд появится стикер.</Step>
              </ol>
              <p className="text-meta text-muted-foreground">
                Если Windows покажет «Система Windows защитила ваш компьютер», нажмите «Подробнее» →
                «Выполнить в любом случае». Приложение пока без цифровой подписи. Значок приложения — рядом
                с часами: через него можно скрыть заметки, выйти из аккаунта или удалить приложение.
              </p>
            </div>
            <NotesPreview />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Сейчас на экране</CardTitle>
            <CardDescription>Задачи, закреплённые стикерами. Удалённые задачи исчезают сами.</CardDescription>
          </CardHeader>
          <CardContent>
            {!state ? (
              <Skeleton className="h-16" />
            ) : state.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пока ничего не закреплено. Откройте задачу и нажмите «На экран».
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {state.notes.map((note) => (
                  <li key={note.taskId} className="flex items-center gap-3 py-2">
                    <Link to={note.path} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm font-medium">{note.title}</span>
                      <span className="block truncate text-meta text-muted-foreground">{note.projectName}</span>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={`Убрать с экрана: ${note.title}`}
                      onClick={() => void remove(note)}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </SectionPage>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex gap-2.5">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-panel text-2xs font-semibold tabular-nums">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function AppStatus({
  loading,
  online,
  everConnected,
}: {
  loading: boolean;
  online: boolean;
  everConnected: boolean;
}): React.ReactElement | null {
  if (loading) return null;
  const text = online ? 'Приложение подключено' : everConnected ? 'Приложение сейчас не запущено' : 'Ещё не подключено';
  return (
    <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', online ? 'bg-done' : 'bg-muted-foreground/40')}
      />
      {text}
    </span>
  );
}

// Как это выглядит на мониторе: два стикера, как в приложении (бумага, без рамок окна).
function NotesPreview(): React.ReactElement {
  return (
    <div aria-hidden="true" className="relative mx-auto h-44 w-48 max-sm:hidden">
      <PreviewNote
        className="absolute inset-bs-0 start-0 -rotate-3"
        paper="oklch(93% 0.11 98)"
        project="Wesetup"
        title="Исправить сохранение реквизитов"
        meta="сегодня"
      />
      <PreviewNote
        className="absolute inset-be-0 end-0 rotate-2"
        paper="oklch(90% 0.06 160)"
        project="Личные"
        title="Обсудить выбор NVMe для сервера"
        meta="завтра"
      />
    </div>
  );
}

function PreviewNote({
  className,
  paper,
  project,
  title,
  meta,
}: {
  className: string;
  paper: string;
  project: string;
  title: string;
  meta: string;
}): React.ReactElement {
  return (
    <div
      className={cn('w-32 rounded-sm p-2.5 text-[oklch(28%_0.03_80)] shadow-card', className)}
      style={{ background: paper }}
    >
      <p className="text-2xs opacity-70">{project}</p>
      <p className="mbs-0.5 text-xs font-semibold leading-snug">{title}</p>
      <p className="mbs-1.5 text-2xs opacity-70">{meta}</p>
    </div>
  );
}

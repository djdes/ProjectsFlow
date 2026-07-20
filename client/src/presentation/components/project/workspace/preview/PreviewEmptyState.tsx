import { useState } from 'react';
import { ArrowRight, Loader2, Monitor, ServerCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { ProjectRuntimeSignals } from '@/application/project/ProjectRepository';

/**
 * Что показывать вместо превью, пока сайта нет.
 *
 * Раньше здесь всегда стояло «Preview появится после первого запуска». Для статики это правда:
 * воркер опубликует сборку, и превью включится само. Для проекта со своим сервером — вечное
 * обещание: платформа не исполняет пользовательский код, запускать такой проект здесь нечему,
 * и пользователь ждёт события, которое не наступит.
 *
 * Поэтому текст ветвится по вердикту сервера. Вердикт консервативный: если распознать не
 * удалось, приходит null и остаётся прежний, оптимистичный текст.
 */
export function PreviewEmptyState({
  projectId,
  runtime,
}: {
  projectId: string;
  runtime: ProjectRuntimeSignals | null;
}): React.ReactElement {
  if (runtime?.kind === 'server_app') {
    return (
      <div className="grid min-h-[440px] place-items-center rounded-xl border border-dashed bg-muted/10 px-6 py-10">
        <div className="max-w-lg text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
            <ServerCog className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Проекту нужен собственный сервер</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Платформа раздаёт статическую сборку и обслуживает вход и данные приложения сама, но
            чужой серверный процесс не запускает. Поэтому превью этого проекта не появится само —
            его нужно перевести на бэкенд платформы.
          </p>

          <div className="mt-5 rounded-lg border bg-background/60 px-4 py-3 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Что об этом говорит код
            </p>
            <ul className="mt-2 space-y-1.5">
              {runtime.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm leading-6">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 break-words">{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Перевод заменит свой сервер на <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/auth</code>{' '}
            и <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/data</code>, а внешнюю базу —
            на базу проекта. После этого сборка публикуется как обычно и превью включится.
          </p>

          <ConvertButton projectId={projectId} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[440px] place-items-center rounded-xl border border-dashed bg-muted/10 px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600">
          <Monitor className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Preview появится после первого запуска</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Как только воркер опубликует результат, сайт откроется здесь автоматически — без
          перезагрузки страницы.
        </p>
      </div>
    </div>
  );
}

/**
 * Ставит воркеру задачу на перевод. Бриф и контракт собирает сервер — здесь только запрос
 * и честный ответ о том, что произошло.
 *
 * Кнопка намеренно не обещает результата: она создаёт задачу, а не выполняет переезд.
 * «Заявка принята» вместо «готово» — потому что дальше работает воркер, и сколько это займёт,
 * отсюда не видно.
 */
function ConvertButton({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const convert = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await projectRepository.convertProjectToPlatformBackend(projectId);
      setDone(result.taskId);
      toast.success(
        result.created ? 'Задача воркеру создана' : 'Задача уже стоит в работе',
        {
          description: result.title,
          action: {
            label: 'Открыть',
            onClick: () => { window.location.href = `/projects/${projectId}/tasks/${result.taskId}`; },
          },
        },
      );
    } catch (error) {
      // Сервер объясняет отказ по-русски (нет прав, проект не серверный, контракт недоступен) —
      // показываем именно его текст, а не «что-то пошло не так».
      toast.error(error instanceof Error ? error.message : 'Не удалось создать задачу');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <a
        href={`/projects/${projectId}/tasks/${done}`}
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
      >
        Открыть задачу на перевод
        <ArrowRight className="size-4" />
      </a>
    );
  }

  return (
    <Button className="mt-5" onClick={() => void convert()} disabled={busy}>
      {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
      Перевести на бэкенд платформы
    </Button>
  );
}

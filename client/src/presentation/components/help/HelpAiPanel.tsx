import { Folder, Loader2, RefreshCw } from 'lucide-react';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import type { HelpAiSession } from './helpAiSession';

/**
 * Вкладка «ИИ» правой панели — настоящий чат в компактном режиме.
 * Владелец беседы — HelpWidget: он же создаёт её лениво и хранит между
 * переключениями вкладок, поэтому сюда приезжает готовая сессия.
 */
export function HelpAiPanel({
  session,
  creating,
  error,
  routeProjectId,
  routeProjectName,
  onRetry,
  onStartProjectChat,
}: {
  session: HelpAiSession | null;
  creating: boolean;
  error: string | null;
  routeProjectId: string | null;
  routeProjectName: string | null;
  onRetry: () => void;
  onStartProjectChat: () => void;
}): React.ReactElement {
  if (error && !session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-hover"
        >
          <RefreshCw className="size-4" />
          Попробовать снова
        </button>
      </div>
    );
  }

  if (!session || creating) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Беседа навсегда привязана к проекту, в котором её начали. Если пользователь ушёл
  // в другой проект — контекст молча не переписываем, а предлагаем начать чат там.
  const movedToOtherProject = routeProjectId !== null && routeProjectId !== session.projectId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AiConversationView
        key={session.conversationId}
        conversationId={session.conversationId}
        projectId={session.projectId ?? undefined}
        compact
        hideHeader
        contextSlot={
          <>
            {session.projectName && (
              <div className="pb-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  <Folder className="size-3 shrink-0" />
                  <span className="truncate">{session.projectName}</span>
                </span>
              </div>
            )}
            {movedToOtherProject && (
              <div className="mb-2 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200/90">
                Этот чат привязан к проекту{' '}
                {session.projectName ? `«${session.projectName}»` : 'из которого он начат'}.
                <button
                  type="button"
                  onClick={onStartProjectChat}
                  className="ml-1 font-medium underline underline-offset-2"
                >
                  Начать чат о «{routeProjectName ?? 'текущем проекте'}»
                </button>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}

import { PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import type { StudioSplitPane } from './useStudioSplitPane';

export function StudioChatPane({
  conversationId,
  projectName,
  splitPane,
}: {
  conversationId: string;
  projectName: string;
  splitPane: StudioSplitPane;
}): React.ReactElement {
  return (
    <>
      <aside
        aria-label="AI-чат проекта"
        aria-hidden={splitPane.hidden || undefined}
        inert={splitPane.hidden || undefined}
        style={splitPane.paneStyle}
        className={cn(
          'relative hidden h-full min-h-0 shrink-0 overflow-hidden bg-background lg:block',
          splitPane.dragging && 'select-none',
        )}
      >
        <div style={{ width: splitPane.width }} className="relative h-full min-h-0">
          <AiConversationView conversationId={conversationId} projectName={projectName} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 z-10 size-8 bg-background/90 backdrop-blur"
            aria-label="Скрыть AI-чат"
            onClick={() => splitPane.setHidden(true)}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </aside>
      {!splitPane.hidden && (
        <div
          {...splitPane.separatorProps}
          className={cn(
            'group relative z-20 hidden h-full w-px shrink-0 cursor-col-resize bg-border outline-none lg:block',
            'before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
            'hover:after:bg-primary/50 focus-visible:after:bg-primary',
            splitPane.dragging && 'after:bg-primary',
          )}
        />
      )}
    </>
  );
}

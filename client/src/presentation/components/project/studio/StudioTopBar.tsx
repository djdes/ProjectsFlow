import { MessageSquareText, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type StudioPanel = 'preview' | 'dashboard';

export function StudioTopBar({
  panel,
  actions,
  chatHidden,
  onPanelChange,
  onShowChat,
  onOpenMobileChat,
  embedded,
}: {
  panel: StudioPanel;
  actions?: React.ReactNode;
  chatHidden: boolean;
  onPanelChange: (panel: StudioPanel) => void;
  onShowChat: () => void;
  onOpenMobileChat: () => void;
  embedded?: 'leading' | 'trailing';
}): React.ReactElement {
  const items = [
    { id: 'preview' as const, label: 'Preview' },
    { id: 'dashboard' as const, label: 'Dashboard' },
  ];

  const leading = (
    <>
      {chatHidden ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden size-8 lg:inline-flex"
          aria-label="Показать AI-чат"
          onClick={onShowChat}
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      ) : null}

      <div role="tablist" aria-label="Раздел Project Studio" className="inline-flex items-center rounded-md border bg-background p-0.5">
        {items.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            onClick={() => onPanelChange(id)}
            className={cn(
              'inline-flex h-7 items-center rounded-[5px] px-2.5 text-sm font-medium transition-colors motion-reduce:transition-none',
              panel === id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
    </>
  );

  const trailing = (
    <>
      <TooltipProvider delayDuration={550}>
        <div className="hidden shrink-0 items-center gap-0.5 lg:flex">{actions}</div>
      </TooltipProvider>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 lg:hidden"
        onClick={onOpenMobileChat}
      >
        <MessageSquareText className="size-4" />
        <span className="hidden sm:inline">AI-чат</span>
      </Button>
    </>
  );

  if (embedded === 'leading') return <>{leading}</>;
  if (embedded === 'trailing') return <>{trailing}</>;

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-background px-2">
      {leading}

      <span className="min-w-0 flex-1" aria-hidden />
      {trailing}
    </header>
  );
}

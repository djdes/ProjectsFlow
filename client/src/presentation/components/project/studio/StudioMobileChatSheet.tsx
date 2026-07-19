import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';

export function StudioMobileChatSheet({
  open,
  onOpenChange,
  conversationId,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  projectId: string;
  projectName: string;
}): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        dimmed
        showClose={false}
        className="w-[min(94vw,420px)] max-w-none p-0 lg:hidden"
      >
        <SheetTitle className="sr-only">AI-чат проекта {projectName}</SheetTitle>
        <AiConversationView conversationId={conversationId} projectId={projectId} projectName={projectName} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-10 size-8 bg-background/90 backdrop-blur"
          aria-label="Закрыть AI-чат"
          onClick={() => onOpenChange(false)}
        >
          <X className="size-4" />
        </Button>
      </SheetContent>
    </Sheet>
  );
}

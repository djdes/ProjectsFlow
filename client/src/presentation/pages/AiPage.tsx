import { useEffect, useRef, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { WorkspaceCrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { PageTopBar } from '@/presentation/layout/PageChrome';
import { announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import { AiComposer } from '@/presentation/components/ai/AiComposer';
import { AiComposerPresets } from '@/presentation/components/ai/AiComposerPresets';
import { ImageGenerationPanel } from '@/presentation/components/ai/ImageGenerationPanel';

export function AiPage(): React.ReactElement {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { aiConversationRepository, imageGenerationRepository } = useContainer();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'images' ? 'images' : 'chat';

  useEffect(() => {
    document.title = conversationId ? 'Чат с ИИ — ProjectsFlow' : tab==='images'?'Генерация фото — ProjectsFlow':'ИИ — ProjectsFlow';
  }, [conversationId, tab]);

  if (conversationId) return <AiConversationView key={conversationId} conversationId={conversationId} initialImageMode={(location.state as { imageMode?: boolean } | null)?.imageMode === true} />;

  const create = async (prompt?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      if (prompt) {
        try { sessionStorage.setItem(`pf-ai-draft:${conversation.id}`, prompt); } catch { /* ignore */ }
      }
      announceAiConversationsChanged();
      navigate(`/ai/c/${conversation.id}`);
    } finally {
      setBusy(false);
    }
  };

  const createAndSend = async (body: string, image = false): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    let conversationIdForRetry: string | null = null;
    try {
      const conversation = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      conversationIdForRetry = conversation.id;
      if (image) await imageGenerationRepository.create(body, conversation.id);
      else await aiConversationRepository.sendMessage(conversation.id, {
        body,
        clientRequestId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mode: 'chat',
        expectedConversationVersion: conversation.version,
      });
      announceAiConversationsChanged();
      navigate(`/ai/c/${conversation.id}`, { state: { imageMode: image } });
    } catch (error) {
      if (conversationIdForRetry) {
        try { sessionStorage.setItem(`pf-ai-draft:${conversationIdForRetry}`, body); } catch { /* ignore */ }
        navigate(`/ai/c/${conversationIdForRetry}`, { state: { imageMode: image } });
      }
      toast.error((error as Error).message || 'Не удалось отправить сообщение');
      throw error;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      {/* Шапка C4, как у остальных разделов пространства; на мобиле — шапка приложения. */}
      <PageTopBar className="hidden sm:flex">
        <WorkspaceCrumbs icon={<Sparkles className="size-3.5 shrink-0" />} label="ИИ" />
      </PageTopBar>
      <div className="flex shrink-0 gap-2 border-be border-border px-4 py-3" role="tablist" aria-label="Разделы ИИ">
        <Button role="tab" aria-selected={tab==='chat'} variant={tab==='chat'?'secondary':'ghost'} onClick={()=>navigate('/ai',{replace:true})}>Чат</Button>
        <Button role="tab" aria-selected={tab==='images'} variant={tab==='images'?'secondary':'ghost'} onClick={()=>navigate('/ai?tab=images',{replace:true})}>Генерация фото</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab==='images'?<ImageGenerationPanel />:
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-8 sm:px-6 md:py-12">
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center md:py-10">
            <div className="mbe-6 grid size-14 place-items-center rounded-xl bg-foreground text-background">
              <Sparkles className="size-7" />
            </div>
            <h1 className="text-display font-semibold tracking-tight">ProjectsFlow ИИ</h1>
            <p className="mbs-3 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">Отдельное рабочее пространство для идей, анализа и помощи с проектами. Разговоры сохраняются и доступны в левой панели.</p>
            <div className="mbs-7 w-full max-w-2xl text-start">
              <AiComposer conversationId={null} sending={busy} onSend={(body) => createAndSend(body)} imageMode={{ enabled: photoMode, onChange: setPhotoMode, onSend: (body) => createAndSend(body, true) }} autoFocus />
              <AiComposerPresets className="mbs-3" disabled={busy} onPick={(prompt) => void create(prompt)} />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void create()}
              disabled={busy}
              className="mbs-3 gap-2 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4" />
              Открыть пустой чат
            </Button>
          </div>
        </div>}
      </div>
    </main>
  );
}

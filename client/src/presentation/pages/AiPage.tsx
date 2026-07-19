import { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useContainer } from '@/infrastructure/di/container';
import { announceAiConversationsChanged } from '@/presentation/hooks/useAiConversations';
import { AiConversationView } from '@/presentation/components/ai/AiConversationView';
import { AiComposer } from '@/presentation/components/ai/AiComposer';
import { AiComposerPresets } from '@/presentation/components/ai/AiComposerPresets';

export function AiPage(): React.ReactElement {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { aiConversationRepository } = useContainer();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = conversationId ? 'Чат с ИИ — ProjectsFlow' : 'ИИ — ProjectsFlow';
  }, [conversationId]);

  if (conversationId) return <AiConversationView conversationId={conversationId} />;

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

  const createAndSend = async (body: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    let conversationIdForRetry: string | null = null;
    try {
      const conversation = await aiConversationRepository.create({ kind: 'personal', title: 'Новый чат' });
      conversationIdForRetry = conversation.id;
      await aiConversationRepository.sendMessage(conversation.id, {
        body,
        clientRequestId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mode: 'chat',
        expectedConversationVersion: conversation.version,
      });
      announceAiConversationsChanged();
      navigate(`/ai/c/${conversation.id}`);
    } catch (error) {
      if (conversationIdForRetry) {
        try { sessionStorage.setItem(`pf-ai-draft:${conversationIdForRetry}`, body); } catch { /* ignore */ }
        navigate(`/ai/c/${conversationIdForRetry}`);
      }
      throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center md:py-10">
          <div className="mb-6 grid size-16 place-items-center rounded-[22px] bg-foreground text-background shadow-[0_18px_60px_rgba(15,23,42,0.2)]"><Sparkles className="size-8" /></div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">ProjectsFlow ИИ</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">Отдельное рабочее пространство для идей, анализа и помощи с проектами. Разговоры сохраняются и доступны в левой панели.</p>
          <div className="mt-7 w-full max-w-2xl text-left">
            <AiComposer conversationId={null} sending={busy} onSend={createAndSend} autoFocus />
            <AiComposerPresets className="mt-3" disabled={busy} onPick={(prompt) => void create(prompt)} />
          </div>
          <button type="button" onClick={() => void create()} disabled={busy} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:bg-hover hover:text-foreground disabled:opacity-50"><Plus className="size-4" />Открыть пустой чат</button>
        </div>
      </div>
      </div>
    </main>
  );
}

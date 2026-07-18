import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AlertCircle, Loader2, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl } from '@/lib/publicBoardUrl';
import type { ProjectSite } from '@/application/project/ProjectRepository';
import type { SiteEditorPatch, SiteEditorPersistedPatch, SiteEditorSession } from '@/application/site-editor/SiteEditorRepository';
import { AiPromptSheet } from './preview/AiPromptSheet';
import { CanvasRouteMap } from './preview/CanvasRouteMap';
import { CodeSheet } from './preview/CodeSheet';
import { PreviewCanvas } from './preview/PreviewCanvas';
import { PreviewToolbar } from './preview/PreviewToolbar';
import { createHostMessage, isTrustedBridgeEvent } from './preview/bridgeProtocol';
import { joinPreviewUrl, normalizePreviewPath } from './preview/path';
import { createPreviewEditorState, previewEditorReducer } from './preview/reducer';
import { capSnapshot, sanitizeAttribute, sanitizePrompt, sanitizeStylePatch } from './preview/sanitization';

type ActiveSession = SiteEditorSession & { remote: boolean };

export function ProjectPreview({ projectId }: { projectId: string }): React.ReactElement {
  const { projectRepository, siteEditorRepository, openSiteEditorSession, applySiteEditorPatch, startSiteEditorAiJob } = useContainer();
  const [site, setSite] = useState<ProjectSite | null>(null);
  const [loadingSite, setLoadingSite] = useState(true);
  const [siteError, setSiteError] = useState(false);
  const [state, dispatch] = useReducer(previewEditorReducer, undefined, () => createPreviewEditorState('/'));
  const [frameKey, setFrameKey] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [slowFrame, setSlowFrame] = useState(false);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [, setPersistedPatches] = useState<readonly SiteEditorPersistedPatch[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeTimerRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const patchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const deploymentRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const serverRedoDepthRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      projectRepository.getProjectSite(projectId).then((result) => {
        if (cancelled) return;
        setSite(result);
        setSiteError(false);
      }).catch(() => { if (!cancelled) setSiteError(true); }).finally(() => { if (!cancelled) setLoadingSite(false); });
    };
    load();
    const timer = window.setInterval(load, site?.deployedAt ? 60_000 : 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, projectRepository, site?.deployedAt]);

  const baseUrl = site?.siteSlug ? siteResultUrl(site.siteSlug) : null;
  const currentUrl = baseUrl ? joinPreviewUrl(baseUrl, state.path) : null;
  const routes = [...new Set([...(site?.routes?.length ? site.routes : ['/']), state.path])];

  useEffect(() => {
    if (baseUrl && !frameSrc) setFrameSrc(joinPreviewUrl(baseUrl, state.path));
  }, [baseUrl, frameSrc, state.path]);

  useEffect(() => {
    if (!frameLoading) return;
    setSlowFrame(false);
    const timer = window.setTimeout(() => setSlowFrame(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [frameKey, frameLoading, frameSrc]);

  const sendBridge = useCallback((type: Parameters<typeof createHostMessage>[1], payload?: Parameters<typeof createHostMessage>[2]): void => {
    if (!session || !frameSrc || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(createHostMessage(session.nonce, type, payload), new URL(frameSrc).origin);
  }, [frameSrc, session]);

  const resetFrame = useCallback((): void => {
    dispatch({ type: 'BRIDGE_CONNECTING' });
    setFrameLoading(true);
    setFrameKey((key) => key + 1);
  }, []);

  useEffect(() => { activeSessionIdRef.current = session?.id ?? null; }, [session]);

  useEffect(() => {
    if (!session?.remote) return;
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const renewIn = Math.max(0, expiresAt - Date.now() - 15_000);
    const timer = window.setTimeout(() => {
      setSession((current) => current?.id === session.id ? null : current);
      revisionRef.current = 0;
      serverRedoDepthRef.current = 0;
      resetFrame();
    }, renewIn);
    return () => window.clearTimeout(timer);
  }, [resetFrame, session]);

  useEffect(() => {
    if (state.mode !== 'edit' || !session || !frameSrc) return;
    const expectedOrigin = new URL(frameSrc).origin;
    const onMessage = (event: MessageEvent): void => {
      const message = isTrustedBridgeEvent(event, iframeRef.current?.contentWindow ?? null, expectedOrigin, session.nonce);
      if (!message) return;
      if (bridgeTimerRef.current) window.clearTimeout(bridgeTimerRef.current);
      switch (message.type) {
        case 'ready': dispatch({ type: 'BRIDGE_READY' }); break;
        case 'hover': dispatch({ type: 'HOVER', element: message.payload.element }); break;
        case 'select': dispatch({ type: 'SELECT', element: message.payload.element }); break;
        case 'navigation': {
          const nextPath = normalizePreviewPath(message.payload.path);
          if (nextPath && nextPath !== state.path) {
            if (session.remote) void siteEditorRepository.closeSession(projectId, session.id).catch(() => undefined);
            setSession(null);
            setPersistedPatches([]);
            revisionRef.current = 0;
            serverRedoDepthRef.current = 0;
            dispatch({ type: 'APPLY_PATH', path: nextPath });
            if (baseUrl) setFrameSrc(joinPreviewUrl(baseUrl, nextPath));
            resetFrame();
          }
          break;
        }
        case 'history': if (!session.remote) dispatch({ type: 'HISTORY', ...message.payload }); break;
        case 'error': dispatch({ type: 'BRIDGE_ERROR', message: message.payload.message.slice(0, 300) }); break;
      }
    };
    window.addEventListener('message', onMessage);
    dispatch({ type: 'BRIDGE_CONNECTING' });
    sendBridge('hello', { mode: 'edit', path: state.path });
    sendBridge('set-mode', { mode: 'edit' });
    bridgeTimerRef.current = window.setTimeout(() => dispatch({ type: 'BRIDGE_ERROR', message: 'Preview не ответил. Перезагрузите его или проверьте подключение editor bridge.' }), 8_000);
    return () => {
      window.removeEventListener('message', onMessage);
      if (bridgeTimerRef.current) window.clearTimeout(bridgeTimerRef.current);
    };
  }, [baseUrl, frameSrc, projectId, resetFrame, sendBridge, session, siteEditorRepository, state.mode, state.path]);

  useEffect(() => {
    if (state.mode !== 'edit' || state.bridgeStatus !== 'ready' || !session?.remote) return;
    let cancelled = false;
    siteEditorRepository.getPatches(projectId, state.path).then((snapshot) => {
      if (cancelled) return;
      revisionRef.current = snapshot.revision;
      setPersistedPatches(snapshot.patches);
      dispatch({ type: 'HISTORY', revision: snapshot.revision, undoDepth: snapshot.patches.length, redoDepth: serverRedoDepthRef.current });
      sendBridge('replay', { patches: snapshot.patches, revision: snapshot.revision });
    }).catch(() => dispatch({ type: 'BRIDGE_ERROR', message: 'Не удалось восстановить сохранённые изменения страницы.' }));
    return () => { cancelled = true; };
  }, [frameKey, projectId, sendBridge, session, siteEditorRepository, state.bridgeStatus, state.mode, state.path]);

  useEffect(() => () => {
    if (session?.remote) void siteEditorRepository.closeSession(projectId, session.id).catch(() => undefined);
  }, [projectId, session, siteEditorRepository]);

  useEffect(() => {
    const version = site?.deployedAt ?? null;
    if (deploymentRef.current && version && deploymentRef.current !== version) {
      setSession(null);
      setPersistedPatches([]);
      revisionRef.current = 0;
      serverRedoDepthRef.current = 0;
      resetFrame();
    }
    deploymentRef.current = version;
  }, [resetFrame, site?.deployedAt]);

  useEffect(() => {
    if (state.mode !== 'edit' || session || !currentUrl) return;
    let cancelled = false;
    dispatch({ type: 'BRIDGE_CONNECTING' });
    openSiteEditorSession.execute(projectId, currentUrl, state.path).then((opened) => {
      if (cancelled) return;
      revisionRef.current = opened.revision;
      dispatch({ type: 'SESSION_READY', revision: opened.revision });
      setSession({ ...opened, remote: true });
    }).catch(() => {
      if (cancelled) return;
      revisionRef.current = 0;
      setSession({ id: `local-${crypto.randomUUID()}`, nonce: crypto.randomUUID(), revision: 0, canEdit: true, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), remote: false });
      dispatch({ type: 'BRIDGE_ERROR', message: 'Editor backend пока недоступен. Инспектор может подключиться, но изменения нельзя сохранить.' });
    });
    return () => { cancelled = true; };
  }, [currentUrl, openSiteEditorSession, projectId, session, state.mode, state.path]);

  const setMode = (mode: 'preview' | 'edit' | 'canvas'): void => {
    dispatch({ type: 'SET_MODE', mode });
    if (mode !== 'edit') sendBridge('set-mode', { mode: 'preview' });
  };

  const applyPath = (raw: string): void => {
    const normalized = normalizePreviewPath(raw);
    if (!normalized || !baseUrl) { toast.error('Укажите путь внутри сайта, например /catalog'); return; }
    if (session?.remote) void siteEditorRepository.closeSession(projectId, session.id).catch(() => undefined);
    setSession(null);
    setPersistedPatches([]);
    revisionRef.current = 0;
    serverRedoDepthRef.current = 0;
    dispatch({ type: 'APPLY_PATH', path: normalized });
    setFrameSrc(joinPreviewUrl(baseUrl, normalized));
    resetFrame();
  };

  const reload = (): void => resetFrame();

  const applyPatch = async (rawPatch: SiteEditorPatch): Promise<void> => {
    if (!state.selected || !session) return;
    let patch = rawPatch;
    if (patch.kind === 'style') { const safe = sanitizeStylePatch(patch.property, patch.value); if (!safe) { toast.error('Это CSS-свойство или значение нельзя применить.'); return; } patch = { kind: 'style', ...safe }; }
    if (patch.kind === 'attribute' && patch.value !== null) { const safe = sanitizeAttribute(patch.name, patch.value); if (!safe) { toast.error('Небезопасная ссылка или атрибут.'); return; } patch = { kind: 'attribute', ...safe }; }
    if (patch.kind === 'text') patch = { kind: 'text', value: patch.value.slice(0, 4_000) };
    const selected = capSnapshot(state.selected);
    dispatch({ type: 'PATCH_START' });
    sendBridge('patch', { patch });
    if (!session.remote) { dispatch({ type: 'PATCH_ERROR', message: 'Изменение показано в Preview, но editor backend недоступен.' }); return; }
    patchQueueRef.current = patchQueueRef.current.then(async () => {
      try {
        const result = await applySiteEditorPatch.execute(projectId, session.id, revisionRef.current, selected, patch);
        if (activeSessionIdRef.current !== session.id) return;
        revisionRef.current = result.revision;
        serverRedoDepthRef.current = 0;
        dispatch({ type: 'PATCH_SUCCESS', revision: result.revision });
      } catch {
        dispatch({ type: 'PATCH_ERROR', message: 'Не удалось сохранить изменение. Страница восстановлена из последней сохранённой версии.' });
        resetFrame();
      }
    });
    await patchQueueRef.current;
  };

  const changeHistory = async (direction: 'undo' | 'redo'): Promise<void> => {
    if (!session) return;
    if (!session.remote) { sendBridge(direction); return; }
    try {
      const result = direction === 'undo' ? await siteEditorRepository.undo(projectId, session.id, revisionRef.current) : await siteEditorRepository.redo(projectId, session.id, revisionRef.current);
      if (activeSessionIdRef.current !== session.id) return;
      revisionRef.current = result.revision;
      serverRedoDepthRef.current = Math.max(0, serverRedoDepthRef.current + (direction === 'undo' ? 1 : -1));
      dispatch({ type: 'HISTORY', revision: result.revision, undoDepth: Math.max(0, state.undoDepth + (direction === 'undo' ? -1 : 1)), redoDepth: serverRedoDepthRef.current });
      resetFrame();
    } catch { dispatch({ type: 'PATCH_ERROR', message: 'Не удалось изменить историю.' }); }
  };

  const submitAi = async (rawPrompt: string): Promise<void> => {
    if (!state.selected || !session?.remote) { dispatch({ type: 'AI_STATUS', status: 'error', message: 'Editor backend не подключён.' }); return; }
    const prompt = sanitizePrompt(rawPrompt);
    if (!prompt) return;
    dispatch({ type: 'AI_STATUS', status: 'queued', message: 'Задача поставлена в очередь…' });
    try {
      let job = await startSiteEditorAiJob.execute(projectId, session.id, prompt, capSnapshot(state.selected));
      const deadline = Date.now() + 120_000;
      while ((job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
        dispatch({ type: 'AI_STATUS', status: job.status, message: job.message ?? (job.status === 'running' ? 'ИИ изменяет выбранный элемент…' : 'Ожидаем ИИ…') });
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        job = await siteEditorRepository.getAiJob(projectId, session.id, job.id);
      }
      if (job.status === 'completed') { dispatch({ type: 'AI_STATUS', status: 'completed', message: job.message ?? 'Готово' }); reload(); }
      else dispatch({ type: 'AI_STATUS', status: 'error', message: job.error ?? 'ИИ не успел завершить изменение.' });
    } catch { dispatch({ type: 'AI_STATUS', status: 'error', message: 'Не удалось выполнить изменение с ИИ.' }); }
  };

  if (loadingSite) return <div className="grid min-h-[420px] place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Загружаем Preview…</div>;
  if (siteError) return <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed"><div className="max-w-sm text-center"><AlertCircle className="mx-auto mb-3 size-6 text-destructive" /><p className="font-medium">Не удалось получить результат проекта</p><p className="mt-1 text-sm text-muted-foreground">Проверьте соединение и попробуйте обновить Preview.</p><Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Повторить</Button></div></div>;
  if (!site?.siteSlug || !site.deployedAt || !currentUrl || !baseUrl || !frameSrc) return <div className="grid min-h-[440px] place-items-center rounded-xl border border-dashed bg-muted/10 px-6"><div className="max-w-md text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600"><Monitor className="size-6" /></span><h2 className="mt-4 text-lg font-semibold">Preview появится после первого запуска</h2><p className="mt-1.5 text-sm leading-6 text-muted-foreground">Как только воркер опубликует результат, сайт откроется здесь автоматически — без перезагрузки страницы.</p></div></div>;

  return (
    <section className="overflow-hidden rounded-xl border bg-muted/20" aria-label="Preview результата проекта">
      <PreviewToolbar mode={state.mode} device={state.device} path={state.path} draftPath={state.draftPath} routes={routes} routeMenuOpen={state.routeMenuOpen} saveStatus={state.saveStatus} undoDepth={state.undoDepth} redoDepth={state.redoDepth} onMode={setMode} onDevice={(device) => dispatch({ type: 'SET_DEVICE', device })} onDraftPath={(path) => dispatch({ type: 'SET_DRAFT_PATH', path })} onApplyPath={applyPath} onRouteMenu={(open) => dispatch({ type: 'SET_ROUTE_MENU', open })} onReload={reload} onOpen={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')} onUndo={() => void changeHistory('undo')} onRedo={() => void changeHistory('redo')} onCode={() => dispatch({ type: 'SET_PANEL', panel: 'code', open: true })} />
      {state.mode === 'canvas' ? <CanvasRouteMap routes={routes} baseUrl={baseUrl} onOpenRoute={(path) => { applyPath(path); dispatch({ type: 'SET_MODE', mode: 'preview' }); }} /> : <PreviewCanvas ref={iframeRef} frameKey={frameKey} previewUrl={frameSrc} path={state.path} mode={state.mode} device={state.device} loading={frameLoading} slow={slowFrame} bridgeStatus={state.bridgeStatus} bridgeError={state.bridgeError} hovered={state.hovered} selected={state.selected} styleOpen={state.styleOpen} onLoad={() => { setFrameLoading(false); if (state.mode === 'edit') { sendBridge('hello', { mode: 'edit', path: state.path }); sendBridge('set-mode', { mode: 'edit' }); } }} onStyleOpen={(open) => dispatch({ type: 'SET_PANEL', panel: 'style', open })} onPatch={(patch) => void applyPatch(patch)} onAi={() => dispatch({ type: 'SET_PANEL', panel: 'ai', open: true })} onCode={() => dispatch({ type: 'SET_PANEL', panel: 'code', open: true })} onDelete={() => setDeleteOpen(true)} onCloseSelection={() => dispatch({ type: 'SELECT', element: null })} />}
      <CodeSheet open={state.codeOpen} onOpenChange={(open) => dispatch({ type: 'SET_PANEL', panel: 'code', open })} element={state.selected} />
      <AiPromptSheet open={state.aiOpen} onOpenChange={(open) => dispatch({ type: 'SET_PANEL', panel: 'ai', open })} element={state.selected} status={state.aiStatus} message={state.aiMessage} onSubmit={(prompt) => void submitAi(prompt)} />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Удалить выбранный элемент?</DialogTitle><DialogDescription>Элемент исчезнет из страницы. Изменение можно будет отменить кнопкой «Отменить» после сохранения.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button><Button variant="destructive" onClick={() => { setDeleteOpen(false); void applyPatch({ kind: 'command', command: 'delete' }); }}>Удалить</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

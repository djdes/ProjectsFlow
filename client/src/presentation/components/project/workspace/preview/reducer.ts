import type { InspectedElement, PreviewDevice, PreviewEditorState, PreviewMode } from './types';

export type PreviewEditorAction =
  | { type: 'SET_MODE'; mode: PreviewMode }
  | { type: 'SET_DEVICE'; device: PreviewDevice }
  | { type: 'SET_DRAFT_PATH'; path: string }
  | { type: 'APPLY_PATH'; path: string }
  | { type: 'SET_ROUTE_MENU'; open: boolean }
  | { type: 'BRIDGE_CONNECTING' }
  | { type: 'BRIDGE_READY' }
  | { type: 'BRIDGE_ERROR'; message: string }
  | { type: 'SESSION_READY'; revision: number }
  | { type: 'HOVER'; element: InspectedElement | null }
  | { type: 'SELECT'; element: InspectedElement | null }
  | { type: 'PATCH_START' }
  | { type: 'PATCH_SUCCESS'; revision: number; draftCount: number; redoDepth: number; queuedCount: number }
  | { type: 'PATCH_ERROR'; message: string }
  | { type: 'HISTORY'; revision: number; undoDepth: number; redoDepth: number; draftCount?: number; queuedCount?: number }
  | { type: 'DRAFT_STATE'; revision: number; draftCount: number; redoDepth: number; queuedCount: number }
  | { type: 'SET_PANEL'; panel: 'style' | 'code' | 'ai'; open: boolean }
  | { type: 'AI_STATUS'; status: PreviewEditorState['aiStatus']; message?: string | null };

export function createPreviewEditorState(path = '/'): PreviewEditorState {
  return {
    mode: 'preview', device: 'desktop', path, draftPath: path, routeMenuOpen: false,
    bridgeStatus: 'disconnected', bridgeError: null, hovered: null, selected: null,
    saveStatus: 'clean', revision: 0, undoDepth: 0, redoDepth: 0, draftCount: 0, queuedCount: 0,
    styleOpen: false, codeOpen: false, aiOpen: false, aiStatus: 'idle', aiMessage: null,
  };
}

export function previewEditorReducer(state: PreviewEditorState, action: PreviewEditorAction): PreviewEditorState {
  switch (action.type) {
    case 'SET_MODE':
      return {
        ...state,
        mode: action.mode,
        hovered: null,
        selected: action.mode === 'edit' ? state.selected : null,
        routeMenuOpen: false,
        styleOpen: false,
        codeOpen: false,
        aiOpen: false,
      };
    case 'SET_DEVICE': return { ...state, device: action.device };
    case 'SET_DRAFT_PATH': return { ...state, draftPath: action.path };
    case 'APPLY_PATH': return { ...state, path: action.path, draftPath: action.path, routeMenuOpen: false, hovered: null, selected: null, draftCount: 0, queuedCount: 0, undoDepth: 0, redoDepth: 0, saveStatus: 'clean' };
    case 'SET_ROUTE_MENU': return { ...state, routeMenuOpen: action.open };
    case 'BRIDGE_CONNECTING': return { ...state, bridgeStatus: 'connecting', bridgeError: null };
    case 'BRIDGE_READY': return { ...state, bridgeStatus: 'ready', bridgeError: null };
    case 'BRIDGE_ERROR': return { ...state, bridgeStatus: 'error', bridgeError: action.message };
    case 'SESSION_READY': return { ...state, revision: action.revision, saveStatus: 'clean', undoDepth: 0, redoDepth: 0, draftCount: 0, queuedCount: 0 };
    case 'HOVER': return { ...state, hovered: action.element };
    case 'SELECT': return { ...state, selected: action.element, hovered: null, styleOpen: false, codeOpen: false, aiOpen: false };
    case 'PATCH_START': return { ...state, saveStatus: 'saving' };
    case 'PATCH_SUCCESS': return { ...state, saveStatus: action.draftCount ? 'dirty' : 'clean', revision: action.revision, undoDepth: action.draftCount, redoDepth: action.redoDepth, draftCount: action.draftCount, queuedCount: action.queuedCount, bridgeError: null };
    case 'PATCH_ERROR': return { ...state, saveStatus: 'error', bridgeError: action.message };
    case 'HISTORY': return { ...state, saveStatus: (action.draftCount ?? state.draftCount) ? 'dirty' : 'clean', revision: action.revision, undoDepth: action.undoDepth, redoDepth: action.redoDepth, draftCount: action.draftCount ?? state.draftCount, queuedCount: action.queuedCount ?? state.queuedCount };
    case 'DRAFT_STATE': return { ...state, saveStatus: action.draftCount ? 'dirty' : 'clean', revision: action.revision, undoDepth: action.draftCount, redoDepth: action.redoDepth, draftCount: action.draftCount, queuedCount: action.queuedCount };
    case 'SET_PANEL': return { ...state, [`${action.panel}Open`]: action.open } as PreviewEditorState;
    case 'AI_STATUS': return { ...state, aiStatus: action.status, aiMessage: action.message ?? null };
    default: return state;
  }
}

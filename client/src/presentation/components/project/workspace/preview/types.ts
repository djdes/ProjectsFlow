import type { SiteEditorSnapshot } from '@/application/site-editor/SiteEditorRepository';

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
export type PreviewMode = 'preview' | 'edit' | 'canvas';
export type BridgeStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'error';

export type ElementBounds = { x: number; y: number; width: number; height: number };
export type InspectedElement = SiteEditorSnapshot & { bounds: ElementBounds; label: string };

export type PreviewEditorState = {
  mode: PreviewMode;
  device: PreviewDevice;
  path: string;
  draftPath: string;
  routeMenuOpen: boolean;
  bridgeStatus: BridgeStatus;
  bridgeError: string | null;
  hovered: InspectedElement | null;
  selected: InspectedElement | null;
  saveStatus: SaveStatus;
  revision: number;
  undoDepth: number;
  redoDepth: number;
  draftCount: number;
  queuedCount: number;
  styleOpen: boolean;
  codeOpen: boolean;
  aiOpen: boolean;
  aiStatus: 'idle' | 'submitting' | 'queued' | 'running' | 'completed' | 'error';
  aiMessage: string | null;
};

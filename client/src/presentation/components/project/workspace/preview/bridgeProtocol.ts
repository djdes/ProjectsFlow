import type { SiteEditorPatch, SiteEditorPersistedPatch } from '@/application/site-editor/SiteEditorRepository';
import type { InspectedElement } from './types';

export const SITE_EDITOR_PROTOCOL = 'projectsflow.site-editor';
export const SITE_EDITOR_VERSION = 1;

type Envelope = { protocol: typeof SITE_EDITOR_PROTOCOL; version: typeof SITE_EDITOR_VERSION; sessionNonce: string; type: string; payload?: unknown };
export type FrameMessage =
  | (Envelope & { type: 'ready'; payload: { path: string } })
  | (Envelope & { type: 'hover'; payload: { element: InspectedElement | null } })
  | (Envelope & { type: 'select'; payload: { element: InspectedElement | null } })
  | (Envelope & { type: 'navigation'; payload: { path: string } })
  | (Envelope & { type: 'history'; payload: { revision: number; undoDepth: number; redoDepth: number } })
  | (Envelope & { type: 'error'; payload: { message: string } });

export type HostMessage = Envelope & {
  type: 'hello' | 'set-mode' | 'navigate' | 'patch' | 'replay' | 'undo' | 'redo' | 'reload';
  payload?: { mode?: 'preview' | 'edit'; path?: string; patch?: SiteEditorPatch; patches?: readonly SiteEditorPersistedPatch[]; revision?: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseElement(value: unknown): InspectedElement | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.locator) || !isRecord(value.bounds)) return undefined;
  const { locator, bounds } = value;
  if (typeof locator.selector !== 'string' || locator.selector.length < 1 || locator.selector.length > 1_000) return undefined;
  if (typeof locator.tagName !== 'string' || locator.tagName.length < 1 || locator.tagName.length > 64) return undefined;
  if (typeof value.label !== 'string' || value.label.length > 120) return undefined;
  const numbers = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item)) || Number(bounds.width) < 0 || Number(bounds.height) < 0) return undefined;
  if (value.source !== undefined && (typeof value.source !== 'string' || value.source.length > 50_000)) return undefined;
  if (value.styles !== undefined && !isRecord(value.styles)) return undefined;
  if (locator.text !== undefined && (typeof locator.text !== 'string' || locator.text.length > 1_000)) return undefined;
  if (locator.attributes !== undefined && !isRecord(locator.attributes)) return undefined;
  return value as InspectedElement;
}

export function parseFrameMessage(value: unknown, nonce: string): FrameMessage | null {
  if (!isRecord(value) || value.protocol !== SITE_EDITOR_PROTOCOL || value.version !== SITE_EDITOR_VERSION || value.sessionNonce !== nonce || typeof value.type !== 'string') return null;
  if (!['ready', 'hover', 'select', 'navigation', 'history', 'error'].includes(value.type)) return null;
  if (!isRecord(value.payload)) return null;
  const payload = value.payload;
  if (value.type === 'ready' || value.type === 'navigation') return typeof payload.path === 'string' ? value as FrameMessage : null;
  if (value.type === 'history') return typeof payload.revision === 'number' && typeof payload.undoDepth === 'number' && typeof payload.redoDepth === 'number' ? value as FrameMessage : null;
  if (value.type === 'error') return typeof payload.message === 'string' ? value as FrameMessage : null;
  if (value.type === 'hover' || value.type === 'select') {
    const element = parseElement(payload.element);
    return element !== undefined ? { ...value, payload: { element } } as FrameMessage : null;
  }
  return null;
}

export function createHostMessage(nonce: string, type: HostMessage['type'], payload?: HostMessage['payload']): HostMessage {
  return { protocol: SITE_EDITOR_PROTOCOL, version: SITE_EDITOR_VERSION, sessionNonce: nonce, type, payload };
}

export function isTrustedBridgeEvent(event: MessageEvent, frameWindow: Window | null, expectedOrigin: string, nonce: string): FrameMessage | null {
  if (!frameWindow || event.source !== frameWindow || event.origin !== expectedOrigin) return null;
  return parseFrameMessage(event.data, nonce);
}

export type AiAttachmentDraft = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'text' | 'file';
  data: string | null;
  previewUrl?: string;
};

const MARKER = /<!--PF_ATTACHMENT:([A-Za-z0-9+/=]+)-->/gu;

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  return btoa(binary);
}

function decode(value: string): AiAttachmentDraft | null {
  try {
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const id = typeof parsed['id'] === 'string' ? parsed['id'].trim().slice(0, 100) : '';
    const name = typeof parsed['name'] === 'string' ? parsed['name'].trim().slice(0, 240) : '';
    const mimeType = typeof parsed['mimeType'] === 'string' ? parsed['mimeType'].trim().slice(0, 160) : '';
    const size = typeof parsed['size'] === 'number' && Number.isFinite(parsed['size']) && parsed['size'] >= 0
      ? Math.floor(parsed['size'])
      : -1;
    const kind = parsed['kind'];
    const data = parsed['data'];
    if (!id || !name || !mimeType || size < 0 || (kind !== 'image' && kind !== 'text' && kind !== 'file')) return null;
    if (data !== null && typeof data !== 'string') return null;
    if (kind === 'image' && (typeof data !== 'string' || data.length > 34_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/u.test(data))) return null;
    if (kind === 'text' && typeof data === 'string' && data.length > 14_000) return null;
    if (kind === 'file' && typeof data === 'string' && (data.length > 24_000 || !/^[A-Za-z0-9+/=]*$/u.test(data))) return null;
    return { id, name, mimeType, size, kind, data };
  } catch { return null; }
}

async function imageData(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('image_canvas_unavailable');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let result = canvas.toDataURL('image/webp', 0.62);
  if (result.length > 30_000) result = canvas.toDataURL('image/jpeg', 0.42);
  return result.slice(0, 34_000);
}

export async function prepareAiAttachment(file: File): Promise<AiAttachmentDraft> {
  const base = { id: crypto.randomUUID(), name: file.name || 'screenshot.png', mimeType: file.type || 'application/octet-stream', size: file.size };
  if (file.type.startsWith('image/')) {
    const data = await imageData(file);
    return { ...base, kind: 'image', data, previewUrl: data };
  }
  if (file.type.startsWith('text/') || /\.(?:md|txt|json|csv|ts|tsx|js|jsx|css|html|xml|ya?ml|sql)$/iu.test(file.name)) {
    return { ...base, kind: 'text', data: (await file.text()).slice(0, 14_000) };
  }
  const bytes = new Uint8Array(await file.slice(0, 18_000).arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  return { ...base, kind: 'file', data: btoa(binary) };
}

export function composeAiMessage(body: string, attachments: readonly AiAttachmentDraft[]): string {
  let result = body.trim();
  for (const attachment of attachments) {
    const transportAttachment: AiAttachmentDraft = {
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      data: attachment.data,
    };
    const marker = `<!--PF_ATTACHMENT:${encode(transportAttachment)}-->`;
    if (result.length + marker.length > 49_000) break;
    result += `${result ? '\n\n' : ''}${marker}`;
  }
  return result;
}

export function extractAiAttachments(body: string): { text: string; attachments: AiAttachmentDraft[] } {
  const attachments: AiAttachmentDraft[] = [];
  const text = body.replace(MARKER, (_match, encoded: string) => {
    const attachment = decode(encoded);
    if (attachment) {
      attachments.push(attachment.kind === 'image' && attachment.data
        ? { ...attachment, previewUrl: attachment.data }
        : attachment);
    }
    return '';
  }).trim();
  return { text, attachments };
}

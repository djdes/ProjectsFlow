// Разбор потока Server-Sent Events в формате Responses API: события `data: {json}`,
// разделённые пустой строкой. Строки `event:` дублируют поле type внутри JSON.

export type SseEvent = Record<string, unknown> & { readonly type?: unknown };

export function parseSseEvents(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  let dataLines: string[] = [];
  const flush = (): void => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    dataLines = [];
    if (payload === '' || payload === '[DONE]') return;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') events.push(parsed as SseEvent);
    } catch {
      // Не JSON — пропускаем (комментарии, keep-alive).
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  flush();
  return events;
}

const EVENT_END_RE = /\r?\n\r?\n/;
const OUTPUT_ITEM_DONE = 'response.output_item.done';

// Поток SSE «на лету»: события уходят дальше без изменений, кроме response.output_item.done,
// у которого transform вернул замену элемента. Буферизуется только одно незаконченное событие.
export function transformSseOutputItems(
  body: ReadableStream<Uint8Array>,
  transform: (item: unknown) => Record<string, unknown> | null,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const takeCompleteEvents = (): string => {
    let out = '';
    for (let match = EVENT_END_RE.exec(buffer); match; match = EVENT_END_RE.exec(buffer)) {
      out += rewriteEvent(buffer.slice(0, match.index), transform) + match[0];
      buffer = buffer.slice(match.index + match[0].length);
    }
    return out;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const tail = takeCompleteEvents() + (buffer ? rewriteEvent(buffer, transform) : '');
          buffer = '';
          if (tail) controller.enqueue(encoder.encode(tail));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const out = takeCompleteEvents();
        if (out) {
          controller.enqueue(encoder.encode(out));
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function rewriteEvent(block: string, transform: (item: unknown) => Record<string, unknown> | null): string {
  if (!block.includes(OUTPUT_ITEM_DONE)) return block;
  const lines = block.split(/\r?\n/);
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, ''));
  if (data.length === 0) return block;
  let event: unknown;
  try {
    event = JSON.parse(data.join('\n'));
  } catch {
    return block;
  }
  if (typeof event !== 'object' || event === null || (event as SseEvent).type !== OUTPUT_ITEM_DONE) return block;
  const replacement = transform((event as Record<string, unknown>)['item']);
  if (!replacement) return block;
  const kept = lines.filter((line) => !line.startsWith('data:'));
  return [...kept, `data: ${JSON.stringify({ ...(event as Record<string, unknown>), item: replacement })}`].join('\n');
}

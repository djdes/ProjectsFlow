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

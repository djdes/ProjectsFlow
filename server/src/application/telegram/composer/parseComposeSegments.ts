// Серверный парсер результата AI-compose pass-1 (mode='compose'): JSON-строка из
// improvedType job'а → массив сегментов-задач. Зеркалит клиентский parseComposeResult
// (client/src/application/ai/ComposeTasks.ts), но без advancedBody (pass-2 не используем).
// Устойчив к ```-обёрткам и тексту вокруг JSON. Бросает на нераспознаваемом ответе.

export type ParsedComposeSegment = {
  readonly title: string;
  readonly body: string; // simpleBody
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeName: string | null;
  readonly deadline: string | null; // YYYY-MM-DD
};

export class ComposeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeParseError';
  }
}

// Дедлайн: строгий YYYY-MM-DD + проверка реального календаря (источник — LLM, может выдать
// 2026-13-40). Невалидное → null, чтобы не утекло в DATE-колонку.
function validDeadline(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? v : null;
}

function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Достаёт JSON-объект из ответа модели: устойчив к ```-обёрткам и тексту до/после JSON.
function extractJsonObject(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new ComposeParseError('AI вернул нераспознаваемый ответ');
  }
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ComposeParseError('AI вернул нераспознаваемый ответ');
  }
}

export function parseComposeSegments(raw: string): ParsedComposeSegment[] {
  const obj = extractJsonObject(raw) as { segments?: unknown };
  if (!Array.isArray(obj.segments)) {
    throw new ComposeParseError('AI вернул ответ без сегментов');
  }
  const segments: ParsedComposeSegment[] = (obj.segments as unknown[]).map((rawSeg) => {
    const o = (rawSeg ?? {}) as Record<string, unknown>;
    const title = str(o, 'title') ?? '';
    const simpleBody = str(o, 'simpleBody') ?? '';
    return {
      title,
      body: simpleBody.length > 0 ? simpleBody : title,
      projectId: str(o, 'projectId'),
      projectName: str(o, 'projectName'),
      assigneeUserId: str(o, 'assigneeUserId'),
      assigneeName: str(o, 'assigneeName'),
      deadline: validDeadline(o['deadline']),
    };
  });
  // Сегменты без какого-либо текста выкидываем — создавать пустую задачу нельзя.
  const nonEmpty = segments.filter((s) => s.title.trim().length > 0 || s.body.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new ComposeParseError('AI вернул пустой список задач');
  }
  return nonEmpty;
}

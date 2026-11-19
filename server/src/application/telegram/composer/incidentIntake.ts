import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { stripCsharpFixerOrigin, type IntakeSource } from './csharpFixerIntake.js';
import { pickProjectByHints, type HintedProject } from './projectHints.js';

// Режим группы `incident` (spec 2026-11-17, раздел 3) — обобщение чата CSharpFixer: chatId и
// projectId берутся из рабочей группы, а не из env. Подпись HMAC — общий секрет сервер ↔ воркер
// (TELEGRAM_ORIGIN_SIGNING_KEY). Подписанный источник хранит реального автора и сообщение, на
// которое воркер/сервер отвечает в группе.
export const INCIDENT_ORIGIN_MARKER = 'tg-incident-origin';

export type IncidentOrigin = {
  readonly chatId: number;
  readonly userId: number;
  readonly messageId: number;
  readonly messageThreadId: number | null;
  readonly senderName: string;
  readonly projectId: string;
  readonly textSha256: string;
  readonly replyToMessageId?: number;
  // Смешанная группа (db/193): задача воркеру из сообщения без исполнителя. runMode — выбран по
  // флагу проекта «Полный прогон по умолчанию для задач из групп». Нет полей — режим incident.
  readonly mode?: 'mixed';
  readonly runMode?: 'full' | 'quick';
};

// Проект ещё не выбран (смешанная группа ждёт кнопку): подпись с заглушкой, задача не создаётся.
export const PENDING_PROJECT_ID = '-';

export function incidentSigningKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.TELEGRAM_ORIGIN_SIGNING_KEY;
  return key && key.length >= 32 ? key : null;
}

const MARKER_RE = /\s*<!-- tg-incident-origin:([A-Za-z0-9+/=]+):([a-f0-9]{64}) -->/;

// Убирает и новый, и старый (csharp-fixer-origin) маркер — старые задачи читаются ещё релиз.
export function stripIntakeOrigin(text: string): string {
  return stripCsharpFixerOrigin(text.replace(new RegExp(MARKER_RE.source, 'g'), '')).trim();
}

const positive = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

export function signIncidentRequest(
  rawText: string,
  source: IntakeSource,
  projectId: string,
  signingKey: string,
  extra?: { readonly mode: 'mixed'; readonly runMode: 'full' | 'quick' },
): string {
  if (!Number.isSafeInteger(source.chatId) || source.chatId >= 0 || !positive(source.userId) ||
      !positive(source.messageId) ||
      (source.messageThreadId !== null && !positive(source.messageThreadId)) ||
      (source.replyToMessageId !== undefined && source.replyToMessageId !== null && !positive(source.replyToMessageId)) ||
      !projectId)
    throw new Error('Incident: invalid Telegram source');
  const text = stripIntakeOrigin(rawText);
  if (!text) throw new Error('Incident: empty request');
  const data: Record<string, unknown> = {
    chatId: source.chatId,
    userId: source.userId,
    messageId: source.messageId,
    messageThreadId: source.messageThreadId,
    senderName: source.senderName.slice(0, 200),
    projectId,
    textSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
  if (source.replyToMessageId !== undefined && source.replyToMessageId !== null) {
    data.replyToMessageId = source.replyToMessageId;
  }
  if (extra) {
    data.mode = extra.mode;
    data.runMode = extra.runMode;
  }
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const signature = createHmac('sha256', signingKey).update(payload, 'utf8').digest('hex');
  return `${text}\n\n<!-- ${INCIDENT_ORIGIN_MARKER}:${payload}:${signature} -->`;
}

// Проверенный источник из текста задачи/черновика. null — маркера нет или подпись чужая.
export function readIncidentOrigin(text: string, signingKey: string | null): IncidentOrigin | null {
  if (!signingKey) return null;
  const match = MARKER_RE.exec(text);
  if (!match) return null;
  const [, payload, signature] = match as unknown as [string, string, string];
  const expected = createHmac('sha256', signingKey).update(payload, 'utf8').digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as IncidentOrigin;
    if (!Number.isSafeInteger(data.chatId) || data.chatId >= 0 || !positive(data.messageId) ||
        typeof data.projectId !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

// Проект инцидента по тексту среди проектов группы. Один проект — без вопросов; иначе ищем
// название, привычное название (aliases, db/192) или их основу. null — не понять, переспросить.
export function pickIncidentProject(
  text: string,
  projects: readonly HintedProject[],
): string | null {
  if (projects.length === 1) return projects[0]!.id;
  return pickProjectByHints(text, projects)?.id ?? null;
}

// Переподписать источник под выбранный проект (смешанная группа: проект выбрали кнопкой).
// null — подпись чужая/битая.
export function resignIncidentForProject(
  text: string,
  projectId: string,
  signingKey: string,
  extra?: { readonly mode: 'mixed'; readonly runMode: 'full' | 'quick' },
): string | null {
  const origin = readIncidentOrigin(text, signingKey);
  if (!origin) return null;
  return signIncidentRequest(stripIntakeOrigin(text), {
    chatId: origin.chatId,
    userId: origin.userId,
    messageId: origin.messageId,
    messageThreadId: origin.messageThreadId,
    senderName: origin.senderName,
    ...(origin.replyToMessageId !== undefined ? { replyToMessageId: origin.replyToMessageId } : {}),
  }, projectId, signingKey, extra);
}

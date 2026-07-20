/**
 * Ссылка на зону сайта, к которой был привязан промпт правки. Зеркало серверного
 * `server/src/domain/ai-conversation/AiSelectionRef.ts`: сервер кладёт её в
 * `metadata_json` ПОЛЬЗОВАТЕЛЬСКОГО сообщения (ключ `selection`), клиент рисует по
 * ней чип зоны внутри пузыря.
 *
 * Здесь сознательно НЕТ снапшота элемента (outerHTML, computed styles) — только то,
 * чем зону можно назвать и найти повторно в предпросмотре. Полный снапшот живёт в
 * project_edit_jobs, где он и нужен воркеру.
 */
export type AiSelectionRef = {
  readonly kind: 'site_element';
  readonly route: string;
  readonly selector: string;
  readonly tagName: string;
  readonly label: string | null;
  readonly artifactVersion: string | null;
  readonly jobId: string | null;
};

// Пределы повторяют серверные: клиент режет ещё раз, потому что metadata приезжает
// как непроверенный JSON и утекает в title/aria чипа.
const MAX_SELECTOR = 1_000;
const MAX_LABEL = 120;
const MAX_ROUTE = 500;
const MAX_TAG_NAME = 64;
const MAX_ARTIFACT_VERSION = 128;
const MAX_JOB_ID = 36;

// Управляющие и форматирующие символы в чипе невидимы, но ломают вёрстку и подсказку.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]+/gu;

/**
 * Достать ссылку на зону из metadata сообщения. Как и у шагов агента, кривой вход
 * молча отбрасывается: сообщение обязано отрисоваться и без чипа — промпт
 * пользователю важнее полноты телеметрии.
 */
export function readAiSelectionRef(metadata: unknown): AiSelectionRef | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)['selection'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw['kind'] !== 'site_element') return null;

  const selector = text(raw['selector'], MAX_SELECTOR);
  const tagName = text(raw['tagName'], MAX_TAG_NAME).toLowerCase();
  // Без селектора и тега зона не идентифицируется, а чип «правка <неизвестно>»,
  // который ещё и никуда не ведёт, вводит в заблуждение сильнее, чем его отсутствие.
  if (!selector || !tagName) return null;

  const route = text(raw['route'], MAX_ROUTE);
  const label = text(raw['label'], MAX_LABEL);
  return {
    kind: 'site_element',
    // Только site-relative путь: route уходит в навигацию превью, абсолютный URL
    // здесь означал бы попытку открыть чужой домен прямо из ленты диалога.
    route: route.startsWith('/') ? route : '/',
    selector,
    tagName,
    label: label || null,
    artifactVersion: text(raw['artifactVersion'], MAX_ARTIFACT_VERSION) || null,
    jobId: text(raw['jobId'], MAX_JOB_ID) || null,
  };
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}

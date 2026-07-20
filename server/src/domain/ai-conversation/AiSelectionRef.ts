/**
 * Ссылка на зону сайта, к которой относится сообщение. Хранится в `metadata_json`
 * пользовательского сообщения (миграция не нужна, колонка есть с db/132) и рисуется
 * чипом «правка элемента» над телом промпта.
 *
 * Здесь сознательно НЕТ outerHTML и computed styles: снапшот элемента доходит до 50 КБ,
 * а сообщений в диалоге сотни — в metadata живёт только то, чем зону можно назвать и
 * найти повторно. Полный снапшот остаётся в project_edit_jobs, где он и нужен воркеру.
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

export const MAX_AI_SELECTION_SELECTOR = 1_000;
export const MAX_AI_SELECTION_LABEL = 120;
const MAX_ROUTE = 500;
const MAX_TAG_NAME = 64;
const MAX_ARTIFACT_VERSION = 128;
const MAX_JOB_ID = 36;

// Управляющие и форматирующие символы в metadata бессмысленны: они невидимы в чипе,
// но ломают вёрстку и логи. Пробельное схлопывается отдельно, уже после замены.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]+/gu;

type RawSelectionRef = {
  readonly kind?: unknown;
  readonly route?: unknown;
  readonly selector?: unknown;
  readonly tagName?: unknown;
  readonly label?: unknown;
  readonly artifactVersion?: unknown;
  readonly jobId?: unknown;
};

/**
 * Привести ссылку на зону к домену. Как и у шагов агента, кривой вход не роняет
 * сообщение — оно просто уходит в чат без чипа зоны: промпт пользователю важнее
 * полноты телеметрии.
 */
export function normalizeSelectionRef(value: unknown): AiSelectionRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as RawSelectionRef;
  if (raw.kind !== 'site_element') return null;

  const selector = text(raw.selector, MAX_AI_SELECTION_SELECTOR);
  const tagName = text(raw.tagName, MAX_TAG_NAME).toLowerCase();
  // Без селектора и тега зона не идентифицируется, а чип «правка <неизвестно>» вводит
  // в заблуждение сильнее, чем его отсутствие.
  if (!selector || !tagName) return null;

  const route = text(raw.route, MAX_ROUTE);
  const label = text(raw.label, MAX_AI_SELECTION_LABEL);
  return {
    kind: 'site_element',
    // Только site-relative путь: route уходит в ссылку «открыть зону», абсолютный URL
    // здесь означал бы переход на чужой домен прямо из ленты диалога.
    route: route.startsWith('/') ? route : '/',
    selector,
    tagName,
    label: label || null,
    artifactVersion: text(raw.artifactVersion, MAX_ARTIFACT_VERSION) || null,
    jobId: text(raw.jobId, MAX_JOB_ID) || null,
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

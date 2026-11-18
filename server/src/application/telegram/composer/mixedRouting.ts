import { parseComposerMessage } from './parseComposerMessage.js';
import { extractWorkerMention } from './workerMention.js';

// Смешанный режим рабочей группы (db/193, решение владельца 2026-11-18): «если указан
// исполнитель — задача человеку; если не указан — воркеру».
//
// Исполнитель указан, если в сообщении (после вырезания @бота) есть @-упоминание человека:
// @username в Telegram, @Имя из ProjectsFlow или «@мне». «@воркер»/«@ralph» — это просьба к
// воркеру, а не исполнитель. Голое «мне» без @ не считаем: «мне нужно, чтобы скрипт…» — обычная
// жалоба, а не назначение себе.
export function hasExplicitAssignee(text: string): boolean {
  const worker = extractWorkerMention(text);
  const query = parseComposerMessage(worker.text).assigneeQuery;
  return query !== null && query.trim().length > 0;
}

// Кому задача в смешанной группе: 'person' — обычный поток группы (#75), 'worker' — воркеру.
export function mixedRouteOf(text: string): 'person' | 'worker' {
  return hasExplicitAssignee(text) ? 'person' : 'worker';
}

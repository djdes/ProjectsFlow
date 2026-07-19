import { and, isNull, isNotNull, type SQL } from 'drizzle-orm';
import { tasks } from '../db/schema.js';

/**
 * Единственный источник правды для фильтра мягкого удаления (db/134).
 *
 * Пропущенный фильтр = удалённая задача «воскресает» в одной выборке и отсутствует
 * в другой, поэтому КАЖДАЯ выборка, читающая `tasks`, обязана пройти через эти
 * хелперы, а не писать `isNull(tasks.deletedAt)` руками — так их можно найти грепом
 * по одному имени.
 *
 * Осознанные исключения (там фильтр НЕ нужен и его отсутствие намеренно):
 *  - `DrizzleProjectRepository.deleteCascade` — физическое удаление проекта должно
 *    забрать и задачи из корзины, иначе они переживут проект сиротами;
 *  - `DrizzleTaskAttachmentRepository.listStorageKeysByProject` — собирает файлы для
 *    удаления с диска при сносе проекта, файлы удалённых задач тоже нужно подчистить;
 *  - `DrizzleTaskBillingAttributionRepository` — атрибуция расхода должна работать и
 *    после удаления задачи, иначе биллинг «теряет» плательщика.
 */
export function taskNotDeleted(): SQL {
  return isNull(tasks.deletedAt);
}

// То же для trash-выборок: только задачи в корзине.
export function taskDeleted(): SQL {
  return isNotNull(tasks.deletedAt);
}

/** Довесить фильтр «не удалена» к произвольному условию выборки задач. */
export function activeTasks(...conditions: readonly (SQL | undefined)[]): SQL {
  return and(...conditions, taskNotDeleted()) as SQL;
}

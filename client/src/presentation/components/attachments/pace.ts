// Троттлинг работы с пачкой файлов. Идея: пока файлов МАЛО — всё как раньше (превью разом,
// заливка параллельно); от порога MANY_FILES_THRESHOLD включаем ограничение скорости, чтобы
// большая пачка не фризила UI (синхронный декод кучи превью) и не забивала аплинк (буря
// заливок через Promise.all). См. жалобу владельца: «дофига файлов разом → лаг + грузит вайфай».

// «Много файлов»: 1..5 — быстро (прежнее поведение), 6+ — с троттлингом. Одна строка на правку.
export const MANY_FILES_THRESHOLD = 6;

// Сколько заливок из пачки идёт одновременно при троттлинге — аплинк не забиваем целиком.
export const UPLOAD_CONCURRENCY = 2;

// Размер порции для постепенного добавления превью (декод разносим по кадрам).
const APPEND_CHUNK = 3;

// Добавляет элементы порциями с уступкой кадра между ними. Мало элементов
// (< MANY_FILES_THRESHOLD) — один вызов append со всей пачкой (в точности прежнее поведение).
export function paceAppend<T>(items: readonly T[], append: (chunk: T[]) => void): void {
  if (items.length === 0) return;
  if (items.length < MANY_FILES_THRESHOLD) {
    append(items.slice());
    return;
  }
  let i = 0;
  const pump = (): void => {
    const slice = items.slice(i, i + APPEND_CHUNK);
    i += APPEND_CHUNK;
    if (slice.length === 0) return;
    append(slice);
    // Уступаем кадр: декод превью предыдущей порции не блокирует ввод/скролл.
    if (i < items.length) setTimeout(pump, 0);
  };
  pump();
}

// Прогоняет задачи с ограничением на число одновременных, сохраняя порядок результатов.
// Мало задач (< MANY_FILES_THRESHOLD) — обычный Promise.all (как раньше, все разом); от порога —
// не больше UPLOAD_CONCURRENCY заливок одновременно.
export async function runFilesLimited<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = items.length < MANY_FILES_THRESHOLD ? items.length : UPLOAD_CONCURRENCY;
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await fn(items[idx]!, idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

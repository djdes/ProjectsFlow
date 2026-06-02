// MariaDB отдаёт JSON-колонки (там JSON — алиас longtext) СТРОКОЙ, а не распарсенным
// объектом — в отличие от нативного JSON в MySQL, который mysql2 парсит сам. Drizzle json()
// это НЕ нормализует. Поэтому ЛЮБОЕ чтение JSON-колонки должно проходить через этот хелпер,
// иначе значение приедет строкой и сломает потребителей (индексация settings[key], спред
// {...value}, итерация) — а спред строки ещё и даёт мусорные числовые ключи в payload'ах.
export function parseJsonCol<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

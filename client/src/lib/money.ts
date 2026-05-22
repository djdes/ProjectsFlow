// Деньги хранятся целыми копейками. Здесь — форматирование и парсинг для UI (рубли).

const rub = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

// Копейки → «1 234 567 ₽» (без копеек в отображении — суммы крупные).
export function formatRub(kopecks: number): string {
  return rub.format(Math.round(kopecks / 100));
}

// Введённые пользователем рубли (строка/число) → копейки (целое). Пусто/мусор → 0.
export function rublesToKopecks(rubles: string | number): number {
  const n = typeof rubles === 'number' ? rubles : Number(String(rubles).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

// Копейки → рубли (число) для префила инпутов.
export function kopecksToRubles(kopecks: number): number {
  return Math.round(kopecks / 100);
}

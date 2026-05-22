// Чистая функция: помесячная пропорция трудозатрат. Без I/O — легко тестируется.
//
// Логика: оклад — месячный; за каждый календарный месяц, в котором сотрудник был назначен
// на проект, начисляем оклад × allocation% × (активных дней в месяце / дней в месяце).
// Дни считаем по UTC-датам (без времени), границы включительны.

const DAY_MS = 86_400_000;

// Нормализуем Date к UTC-полуночи (отбрасываем время и TZ-сдвиг).
function toUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * @param start дата начала назначения (date-only)
 * @param end   дата конца (включительно) — обычно min(ended_at ?? today, today)
 * @returns стоимость в копейках (целое)
 */
export function laborCostKopecks(
  monthlySalaryKopecks: number,
  allocationPercent: number,
  start: Date,
  end: Date,
): number {
  const startMs = toUtcDay(start);
  const endMs = toUtcDay(end);
  if (endMs < startMs) return 0;

  const share = allocationPercent / 100;
  let total = 0;

  let year = new Date(startMs).getUTCFullYear();
  let month = new Date(startMs).getUTCMonth();
  const endYear = new Date(endMs).getUTCFullYear();
  const endMonth = new Date(endMs).getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const dim = daysInMonth(year, month);
    const monthFirst = Date.UTC(year, month, 1);
    const monthLast = Date.UTC(year, month, dim);

    const segStart = Math.max(startMs, monthFirst);
    const segEnd = Math.min(endMs, monthLast);
    const activeDays = Math.floor((segEnd - segStart) / DAY_MS) + 1; // включительно

    if (activeDays > 0) {
      total += Math.round((monthlySalaryKopecks * share * activeDays) / dim);
    }

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return total;
}

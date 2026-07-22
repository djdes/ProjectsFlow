/**
 * Срок по умолчанию для задач из Telegram — «до конца недели».
 *
 * Зачем вообще: без явного срока CreateTask ставит СЕГОДНЯ (см. его `preserveEmptyDeadline`).
 * Для задачи, надиктованной в чат, это неоправданно жёстко — она становится просроченной
 * в тот же вечер. «Конец недели» даёт разумный запас и при этом не оставляет задачу без срока.
 *
 * Конец недели считаем ПЯТНИЦЕЙ: в рабочем контексте «до конца недели» означает рабочую
 * неделю, а не календарную. Если сегодня уже пятница, суббота или воскресенье — берём пятницу
 * СЛЕДУЮЩЕЙ недели: срок «сегодня вечером» или «во вчера» не помогает никому.
 */
const FRIDAY = 5; // getDay(): 0 — воскресенье, 5 — пятница

export function endOfWeekDeadline(now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay();
  // Сколько дней до ближайшей пятницы (пн→4, чт→1). В пятницу и на выходных — до следующей.
  const daysAhead = day > 0 && day < FRIDAY ? FRIDAY - day : FRIDAY + 7 - (day === 0 ? 7 : day);
  date.setDate(date.getDate() + daysAhead);
  return toIsoDate(date);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

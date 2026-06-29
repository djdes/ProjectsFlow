// Простой relative-time formatter для русской локали. Используется в notifications
// и на карточках задач. Для большего нашлось бы date-fns/relative-time-format,
// но ради короткой логики не тянем зависимость.

export function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - date.getTime());
  const sec = Math.floor(diff / 1000);
  // «Только что» — строго для свежих событий (<60с). Дальше — точная минутная
  // гранулярность: floor, а не round, чтобы 90с не округлялось до «2 мин», а
  // 30-минутное уведомление никогда не показывалось как «только что».
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

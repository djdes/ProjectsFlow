// Палитра цветов в стиле Notion (текст + фон). Значения — фиксированные мягкие hex,
// согласованные между светлой read-вью и редактором. Сериализуются в markdown как
// inline-HTML: `<span style="color:…">` / `<span style="background-color:…">`
// (см. TextStyle.renderMarkdown в buildExtensions.ts и SANITIZE_SCHEMA в Markdown.tsx).
//
// «По умолчанию» = null (снимает mark, текст наследует цвет темы).

export interface ColorSwatch {
  /** Стабильный id для key/aria. */
  id: string;
  /** Русская подпись (UI). */
  label: string;
  /** hex-значение для CSS `color` / `background-color`; null = «По умолчанию» (сброс). */
  value: string | null;
}

// Цвета текста (Notion text colors). value=null → сброс к цвету темы.
export const TEXT_COLORS: ColorSwatch[] = [
  { id: 'default', label: 'По умолчанию', value: null },
  { id: 'gray', label: 'Серый', value: '#9b9a97' },
  { id: 'brown', label: 'Коричневый', value: '#937264' },
  { id: 'orange', label: 'Оранжевый', value: '#d9730d' },
  { id: 'yellow', label: 'Жёлтый', value: '#cb912f' },
  { id: 'green', label: 'Зелёный', value: '#448361' },
  { id: 'blue', label: 'Синий', value: '#337ea9' },
  { id: 'purple', label: 'Фиолетовый', value: '#9065b0' },
  { id: 'pink', label: 'Розовый', value: '#c14c8a' },
  { id: 'red', label: 'Красный', value: '#d44c47' },
];

// Цвета фона (Notion background colors). value=null → сброс.
export const BG_COLORS: ColorSwatch[] = [
  { id: 'default', label: 'По умолчанию', value: null },
  { id: 'gray', label: 'Серый', value: '#ebeced' },
  { id: 'brown', label: 'Коричневый', value: '#e9e5e3' },
  { id: 'orange', label: 'Оранжевый', value: '#faebdd' },
  { id: 'yellow', label: 'Жёлтый', value: '#fbf3db' },
  { id: 'green', label: 'Зелёный', value: '#ddedea' },
  { id: 'blue', label: 'Синий', value: '#ddebf1' },
  { id: 'purple', label: 'Фиолетовый', value: '#eae4f2' },
  { id: 'pink', label: 'Розовый', value: '#f4dfeb' },
  { id: 'red', label: 'Красный', value: '#fbe4e4' },
];

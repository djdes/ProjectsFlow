import { defaultSchema } from 'rehype-sanitize';

// Дефолтная схема rehype-sanitize уже разрешает <del>/<s> (~~зачёркнутый~~) и <blockquote>
// (> цитата), но НЕ <u> — в markdown нет подчёркивания, поэтому меню форматирования пишет
// сырой <u>…</u>. Расширяем whitelist тегов на 'u'/'mark'/'span'.
//
// Цвет текста/фона хранится как inline-HTML (`<span style="color:…">` /
// `<span style="background-color:…">`, см. buildExtensions.ts → TextStyle.renderMarkdown).
// Чтобы цвета показывались в read-вью, разрешаем атрибут `style` на span/mark, НО строго
// ограничиваем его значение регуляркой: только свойства `color`/`background-color` со
// значениями named/hex/rgb(a)/hsl(a). Любой `url()`, `expression()`, посторонние свойства
// → атрибут целиком вырезается (см. propertyValuePrimitive в hast-util-sanitize: при
// нескольких элементах в PropertyDefinition значение проверяется по allow-list/регуляркам).
// Остальная XSS-санитизация (script/on*/javascript:) остаётся нетронутой.
const SAFE_COLOR_STYLE =
  /^(?:(?:color|background-color)\s*:\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([\d.,%\s]*\)|hsla?\([\d.,%\s]*\)|[a-zA-Z]+)\s*;?\s*)+$/;

export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  // figure/figcaption — блок-картинка с подписью (inline-скрины в описании, см.
  // FigureImage.ts → renderMarkdown пишет <figure><img><figcaption>). img уже в дефолте.
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark', 'span', 'figure', 'figcaption'],
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ['style', SAFE_COLOR_STYLE]],
    mark: [...(defaultSchema.attributes?.mark ?? []), ['style', SAFE_COLOR_STYLE]],
    figure: [...(defaultSchema.attributes?.figure ?? []), 'dataFigureImage'],
  },
};

// Notion-style выделение фоном: ==текст== → <mark> (remark-gfm такого синтаксиса
// не знает, поэтому лёгкий препроцессинг до парсера). Не лезем в код: сегменты
// внутри backtick-ов (инлайн `код` и ```блоки```) пропускаются как есть.
export function applyInlineMarkSyntax(src: string): string {
  return src
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((seg, i) => (i % 2 === 1 ? seg : seg
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
      // Tiptap 3 stores underline as ++text++; keep older <u> HTML readable too.
      .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>')))
    .join('');
}

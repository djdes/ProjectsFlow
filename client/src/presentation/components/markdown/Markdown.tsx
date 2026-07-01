import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/utils';

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

const SANITIZE_SCHEMA = {
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
function applyHighlightSyntax(src: string): string {
  return src
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/==([^=\n]+)==/g, '<mark>$1</mark>')))
    .join('');
}

// Общий рендер markdown (GFM + перенос строк + безопасный html). Используется для
// пользовательского ввода в мульти-юзер-проектах (описания задач, комментарии,
// текст ассистента), поэтому санитизация обязательна: rehype-raw парсит сырой html,
// rehype-sanitize вырезает XSS (script / on*-атрибуты / javascript:). Порядок плагинов
// важен: raw → sanitize. remark-breaks превращает одиночный перенос строки в <br>,
// чтобы сохранить разметку как её набрал автор (поведение прежнего whitespace-pre-wrap).
//
// Защита от «разъезжания» вёрстки: контент НЕ должен расширять родителя по горизонтали —
// длинные слова/ссылки переносятся (overflow-wrap), а блоки кода и таблицы скроллятся
// внутри своего бокса (overflow-x-auto), а не толкают layout наружу. min-w-0 позволяет
// компоненту ужиматься, когда он живёт во flex/grid-родителе.
const BASE_PROSE = cn(
  'prose prose-sm dark:prose-invert max-w-none min-w-0 break-words [overflow-wrap:anywhere]',
  // компактнее дефолтного prose: меньше отступы у блоков
  'prose-p:my-1 prose-pre:my-2 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1',
  // overflow-guard: код/таблицы скроллятся внутри себя, картинки не вылезают за ширину
  'prose-pre:max-w-full prose-pre:overflow-x-auto prose-img:max-w-full prose-img:h-auto',
  '[&_table]:block [&_table]:w-fit [&_table]:max-w-full [&_table]:overflow-x-auto',
);

export function Markdown({
  children,
  className,
  onCheckboxToggle,
}: {
  children: string;
  className?: string;
  // Интерактивные GFM-чеклисты: если задан — чекбоксы кликабельны, колбэк получает
  // порядковый индекс чекбокса в исходнике (см. lib/checklist.ts) и новое состояние.
  onCheckboxToggle?: (index: number, checked: boolean) => void;
}): React.ReactElement {
  // Счётчик чекбоксов текущего render-pass: порядок вызова компонентов = порядок
  // документа, поэтому простая нумерация однозначно мапится на строки источника.
  // Обычная локальная переменная (не ref): components-замыкания пересоздаются на
  // каждый рендер и видят свой свежий счётчик.
  const checkboxCounter = { value: 0 };

  return (
    <div className={cn(BASE_PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
        components={{
          input: (inputProps) => {
            // node не должен утекать в DOM-атрибуты при spread'е props.
            const { node, ...props } = inputProps;
            void node;
            if (props.type !== 'checkbox') return <input {...props} />;
            if (!onCheckboxToggle) {
              return (
                <input
                  type="checkbox"
                  checked={!!props.checked}
                  readOnly
                  disabled
                  className="size-3.5 translate-y-px accent-primary"
                />
              );
            }
            const index = checkboxCounter.value;
            checkboxCounter.value += 1;
            return (
              <input
                type="checkbox"
                checked={!!props.checked}
                onChange={(e) => onCheckboxToggle(index, e.target.checked)}
                // Не даём клику всплыть в контейнеры с onClick (открытие редактора и т.п.).
                onClick={(e) => e.stopPropagation()}
                className="size-3.5 translate-y-px cursor-pointer accent-primary"
                aria-label="Пункт чеклиста"
              />
            );
          },
        }}
      >
        {applyHighlightSyntax(children)}
      </ReactMarkdown>
    </div>
  );
}

// Пресет для «карточного» рендера (kanban-карточка, строки списка, inbox). Текст
// прижат (нулевые отступы блоков), заголовки не «раздуваются» (выглядят как жирный
// текст body-размера), картинки скрыты (на превью не нужны — есть бейдж вложений),
// ссылки некликабельны (клик по карточке открывает задачу — ссылку откроют внутри).
// Сам line-clamp-N задаёт вызывающая сторона (на карточке 3 строки, в списке — 2).
export const MARKDOWN_COMPACT = cn(
  'text-sm leading-snug',
  // hr скрыт: на 3-строчном превью разделитель (например, `---` frontmatter-стиля
  // в начале описания) выглядит как случайная полоска поверх карточки.
  '[&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0 [&_li]:my-0 [&_blockquote]:my-0 [&_pre]:my-1 [&_hr]:hidden',
  '[&_h1]:my-0 [&_h2]:my-0 [&_h3]:my-0 [&_h4]:my-0',
  '[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_pre]:text-xs [&_img]:hidden [&_a]:pointer-events-none',
);

# Reference: project page views

## COPY_ZONE

`главная страница проекта и все режимы отображения`

Эталон исследован в уже открытой вкладке Notion через Chrome DevTools Protocol. Вкладка ProjectsFlow использовалась только для последующей локальной проверки и во время исследования эталона не изменялась.

## Reference page

- Product: Notion
- Page: `Projectsflow`
- Reference tab title: `(4) Projectsflow | … | Notion`
- Desktop viewport: `1440 × 900`
- Tablet viewport: `1024 × 768`
- Compact viewport: `390 × 844`
- Desktop sidebar: `270 px`
- Desktop top bar: `44 px`

Секреты, cookies, local storage, приватные запросы и исходный код Notion не копировались. Исследовались только отображаемая геометрия, доступное DOM-поведение и пользовательские сценарии.

## Captured modes

1. Table
2. Board
3. Timeline
4. Calendar
5. List
6. Gallery
7. Chart
8. Feed
9. Map
10. Dashboard
11. Form

Для Timeline, Chart, Feed, Map и Form создавались только специально названные/однозначно определённые временные тестовые views. Они были удалены после фиксации поведения. Временный столбец `PF_REF_COLUMN_20260716` также был удалён после сценария создания.

## Files

- `repository-audit.md` — архитектура ProjectsFlow до изменений.
- `behavior.md` — наблюдаемое поведение эталона.
- `geometry.json` — размеры, позиции и плотность.
- `scroll-map.json` — владельцы скролла и sticky-поведение.
- `state-machine.json` — состояния и переходы UI.
- `scenarios.json` — воспроизводимые сценарии.
- `accessibility.md` — клавиатура, роли и focus.
- `screenshots/desktop` — desktop-состояния эталона.
- `screenshots/tablet` — tablet-состояния эталона.
- `screenshots/mobile` — compact-состояния эталона.

## Important observed constraints

- Строка режимов и правая панель действий не sticky: они уезжают вверх вместе с содержимым.
- Заголовок таблицы sticky относительно главного collection-scroller и фиксируется под верхней панелью на `top: 44px`.
- Главный collection-scroller одновременно владеет вертикальным и горизонтальным скроллом.
- Первая колонка таблицы не sticky по горизонтали.
- `Display as` в ПКМ меняет только представление вкладки (`Text and icon`, `Text only`, `Icon only`), а не layout данных.
- Layout меняется через `Edit view → Layout`.
- Создание столбца сначала добавляет временную область шириной `350 px`, сдвигает таблицу в сторону нового края и открывает type picker; после выбора типа столбец становится обычным `200 px`.
- Выделение диапазона ячеек и выделение строк — разные состояния. ПКМ по диапазону переводит его в выделение строк.

## Known observation limits

- Перетаскивание существующих production-вкладок не выполнялось, чтобы не менять порядок пользовательских views.
- Compact viewport отражает desktop-web Notion с открытым sidebar: при ширине `390 px` контент остаётся в отдельном узком scroller, а не перестраивается в полноценную мобильную оболочку.
- Map был пустым, потому что в выбранном поле не оказалось валидных координат.
- Gallery в существующем наборе была настроена как compact list без preview.

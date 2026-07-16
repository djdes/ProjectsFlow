# Behavior specification

## 1. Page composition

На desktop слева находится постоянный sidebar шириной `270 px`, сверху — глобальная панель высотой `44 px`. Остальная область принадлежит одному collection-scroller. Внутри него идут:

1. cover;
2. заголовок и описание проекта;
3. строка вкладок views;
4. правая группа действий;
5. тело активного view.

Блок views не закрепляется при вертикальном скролле. Заголовок таблицы закрепляется относительно collection-scroller, когда доходит до верхней панели.

## 2. View tabs

- Вкладка имеет высоту `32 px`.
- Активная вкладка — нейтральная pill с большим радиусом, без тени и бордера.
- Обычная вкладка прозрачная.
- Левый клик переключает view и обновляет URL-параметр `v`.
- ПКМ открывает меню относительно вкладки.
- Если места недостаточно, часть views скрывается под `N more…`.
- Overflow открывается с фокусом на кнопку и клавишей Enter.
- Overflow содержит поиск, список views, drag handles, icon, название и `…` каждой строки, затем `New view` и `New data source`.

### ПКМ по view

Наблюдаемый состав:

1. Rename
2. Display as
3. Edit view
4. Source
5. Copy link to view
6. Duplicate view
7. Delete view
8. Manage in Calendar — только для поддерживаемых views

`Display as` содержит:

- Text and icon
- Text only
- Icon only
- подпись `Only applies to you`

Это персональная настройка отображения вкладки. Она не меняет layout.

`Rename` открывает `View settings`, фокусирует поле имени и выделяет текущее значение. Escape отменяет несохранённый ввод и закрывает overlay.

`Delete view` требует подтверждения. Для Form используется отдельное подтверждение `Permanently delete … / Delete form`.

## 3. View settings

Desktop:

- правая панель начинается рядом с телом активного view;
- её видимая ширина около `386 px`;
- контент проекта сужается;
- таблица сохраняет собственный горизонтальный scroller;
- панель имеет отдельный вертикальный scroll;
- фон страницы не затемняется.

Tablet:

- панель занимает правую часть доступного main content;
- остаётся видимым узкий фрагмент активного view;
- горизонтальный скролл таблицы сохраняется.

Основные секции:

- Layout
- Property visibility
- Filter
- Sort
- Group
- Conditional color
- Copy link to view
- Source
- Edit properties
- Automations
- AI Autofill
- View archived pages
- More settings
- Manage data sources
- Lock database
- Manage in Calendar

## 4. Layout picker

Layout picker содержит:

- Table
- Board
- Timeline
- Calendar
- List
- Gallery
- Chart
- Feed
- Map

Dashboard и Form создаются как отдельные типы через `New view`.

### Type-specific settings

| Layout | Наблюдаемые настройки |
|---|---|
| Table | Show vertical lines; Show page icon; Wrap all content; Open pages in |
| Board | Show page icon; Wrap all content; Group by; Color columns; Open pages in; Card preview; Card size; Card layout |
| Timeline | Show page icon; Show timeline by; Show table; Open pages in |
| Calendar | Show page icon; Wrap page titles; Show calendar by; Show calendar as; Show weekends; Open pages in |
| List | Show page icon; Open pages in |
| Gallery | Show page icon; Wrap all content; Open pages in; Card preview; Card size; Fit media; Card layout |
| Chart | Edit chart; Learn about charts |
| Feed | Show page icon; Wrap properties; Show author byline; Open pages in; Load limit |
| Map | Show page icon; Map by; Open pages in |

## 5. New view

`New view` открывает поверх overflow отдельный picker.

Grid:

- Table
- Board
- Gallery
- List
- Chart
- Dashboard
- Timeline
- Feed
- Map
- Calendar
- Form

Также есть `Start from scratch` и AI-поле `Or describe a view…`.

Выбор обычного layout:

1. создаёт временный view `New view`;
2. сразу показывает выбранный layout;
3. открывает правую панель создания;
4. фокусирует поле `View name`;
5. позволяет переключить layout до закрытия панели.

Form:

1. открывает Form builder;
2. показывает modal выбора `Create N questions` или `Start from scratch`;
3. после выбора отображает отдельную форму с `Form title`, description, access notice, question card, Preview и Share form.

## 6. Table

### Geometry

- Header height: `36 px`.
- Data row step: `37 px` (`36 px` content + separator).
- Name column: `280 px`.
- Other observed columns: `200 px`.
- Cells and headers are flat: no card shadow, no rounded row container.
- Grid uses subtle one-pixel separators.
- Hover row controls appear in an empty gutter left of Name.
- In the Name header, the gutter is visually empty; checkbox appears only on hover/selection.

### Scroll

- Table uses the same main collection-scroller for X and Y.
- Horizontal scrollbar is at the bottom of the viewport.
- Name is not horizontally sticky.
- Header becomes vertically sticky at `top: 44 px`.

### Add column

1. User scrolls to the right edge.
2. Header exposes a `28 × 28 px` plus and adjacent ellipsis.
3. Click plus immediately extends scroll width by `350 px`.
4. Scroll position moves toward the new right edge.
5. A `404 px` property type dialog opens above/right of the placeholder.
6. An input `Type property name…` is focused.
7. Picker offers AI Autofill shortcuts and property types.
8. Selecting a type commits the property.
9. New regular property width becomes `200 px`.
10. Clicking its header opens actions: type, filter, sort, group, calculate, freeze, hide, wrap, insert, duplicate, delete.
11. Delete requires confirmation and affects all views.

Observed property types:

- Text, Number
- Select, Multi-select
- Status, Date
- Person, Files & media
- Checkbox, URL
- Phone, Email
- Relation, Rollup
- Formula, Button
- ID, Place
- Created time, Last edited time
- Created by, Last edited by
- external file/integration types

### Cell selection

- Drag from one cell to another creates a rectangular range.
- Selected cells use `rgba(35, 131, 226, 0.07)`.
- Anchor cell has a `2 px` blue inset outline.
- A plain left click on any cell clears the previous range and activates the clicked cell.
- ПКМ on a range promotes all intersecting rows into row selection.
- Selected rows use a stronger blue wash and visible checkboxes in the left gutter.
- The selection toolbar reports `N selected`.
- ПКМ opens bulk actions for those rows.
- First outside left click closes the context menu but preserves selected rows.
- The following left click clears the row selection and performs the normal action at the clicked location.

## 7. Board

- Horizontal lanes.
- Status/group columns have a softly tinted background.
- No card shadows beyond a subtle single border/background separation.
- Column header contains group label and count.
- Empty groups contain `+ New page`.
- Cards are compact, flat and follow the selected Card preview/Card size/Card layout settings.
- Horizontal board scroll remains in the main collection-scroller.

## 8. Timeline

- Time scale has month navigation and day grid.
- A red current-day line and dot are visible.
- Undated items are counted in `No date`.
- Items appear as flat horizontal bars.
- Timeline layout optionally exposes a table area.

## 9. Calendar

- Month grid with weekday header.
- Current day highlighted.
- Tasks may span date cells.
- Toolbar includes `No date`, `Manage in Calendar`, current mode, Today and navigation.
- Month/week choice belongs to layout settings.

## 10. List

- One vertical column.
- Items are text rows with a page icon.
- No card border or shadow.
- Content width remains constrained and aligned with project content.

## 11. Gallery

- Card content depends on Card preview and Card layout.
- Existing captured view used compact list layout with no visible preview.
- Gallery supports card size, media fit and wrap.

## 12. Chart

- Flat chart canvas, no surrounding card.
- Captured default was a vertical bar chart grouped by Status.
- Axis/grid lines are subtle.
- Values appear above bars.
- Chart configuration is entered through `Edit chart`.

## 13. Feed

- One wide centered column.
- Each entry is a rounded, lightly bordered feed card.
- Header includes author/avatar and date.
- Title is prominent.
- Comment affordance appears below.
- Feed has a configurable load limit.

## 14. Map

- Full available view canvas.
- Toolbar shows count of items without place and map controls.
- Items without valid place do not create pins.
- `Map by` chooses the location property.

## 15. Dashboard

- Separate dashboard mode rather than a normal layout conversion.
- Empty state text: add charts, tables, lists.
- Primary action: `Edit dashboard`.
- A small `Edit` action appears in the toolbar.

## 16. Form

- Separate Form builder.
- Initial setup asks whether to create questions from supported properties or start from scratch.
- Builder has editable title/description, access notice, question cards and an add control.
- Toolbar replaces New with Preview and Share form.
- Deleting a form explicitly warns that future submissions stop while existing data remains.

## 17. Responsive observations

At `1024 × 768`:

- sidebar remains `270 px`;
- main content width becomes about `754 px`;
- fewer view tabs fit and overflow count increases;
- overflow remains a `290 px` anchored popover;
- view settings occupies much of main content;
- table retains horizontal scroll.

At `390 × 844` with the desktop sidebar open:

- sidebar still consumes `270 px`;
- main content is only `120 px` wide;
- page remains usable through the main horizontal scroller;
- only the active view tab remains rendered in the visible strip;
- this is desktop-web compression, not a dedicated mobile navigation pattern.

## 18. Motion

- Active tab, hover and press use background-color transitions without shadows.
- Overlays appear without layout jump.
- Opening settings changes the available main width in one coordinated transition.
- Add-column reserves the temporary width before the type picker becomes interactive.
- No long spring/bounce motion was observed.

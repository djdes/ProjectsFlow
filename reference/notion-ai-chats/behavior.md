# Clean-room behavior specification — Notion AI chats

## Scope and method

Зона исследования: пункт AI в левой навигации, список сохранённых AI-чатов, создание/переименование/открытие, полноэкранный чат, Back/Forward, сворачивание sidebar и responsive-поведение.

- Авторизованная вкладка: `(3) ыав | Notion`.
- CDP: только `http://127.0.0.1:9222`.
- Стартовый URL: `https://app.notion.com/p/393d407d2e3d801da9ceeb7817fa1467`.
- AI home: `https://app.notion.com/ai`.
- Работа велась только через видимый UI Playwright. Исходники Notion, cookies/tokens и приватные API не исследовались.
- Не выполнялись delete, pin, share, save-to-pages, undo и другие потенциально разрушительные действия.
- Для сценария create/rename создан один отдельный тестовый чат `[Research] AI chat behavior` с нейтральным коротким сообщением.

## 1. Entry point и левый rail

Sidebar имеет фиксированную ширину `270px` и состоит из четырёх слоёв:

1. Workspace switcher и глобальная навигация (`Home`, `Chat`, `Meetings`, `Inbox`, search).
2. Промо-карточка.
3. Секция `Notion AI` с двумя крупными плитками:
   - круглая иконка `Notion AI` открывает AI home;
   - пунктирный круг `New agent` создаёт/настраивает другого агента.
4. Список чатов, сгруппированный по времени: `Today`, `Past week`, `Past 30 days`.

Каждая строка сохранённого чата:

- высотой около `30px`;
- слева имеет outline-иконку чата;
- заголовок занимает доступную ширину и обрезается ellipsis;
- справа показывает `Now`, минуты, `1d`, неделю или абсолютную дату;
- активная строка получает светло-серый фон;
- при hover timestamp заменяется кнопками `Pin` и `…` по `24px`.

Меню строки содержит: `Copy link`, `Pin`, `Mark as unread`, `Rename`, `Delete`, разделитель, `Open in new tab`. Это более богатое меню, чем top-level меню открытого чата.

Внизу sidebar закреплена широкая pill-кнопка `New chat` с shortcut hint `Ctrl+O`, рядом квадратная кнопка новой страницы.

## 2. AI home

Основная область — очень разреженная белая сцена без отдельной карточки-контейнера.

- Круглый AI-face `64×64` расположен над заголовком и является точкой персонализации.
- Заголовок: `How can I help you today?`.
- Большой composer центрирован. Редактор занимает около `696×60` на desktop, но вся оболочка выше за счёт нижней панели действий.
- При фокусе оболочка получает яркую синюю рамку.
- Нижняя строка composer:
  - `+` / Give context;
  - Settings;
  - справа model mode `Auto`;
  - microphone;
  - submit.
- Сразу под composer находится интеграционная полоска `Get better answers from your apps` с рядом иконок подключений и `×`.
- Ниже — компактные сценарии `Create Slides`, `Spreadsheets`, `Research`, `Visualize`.

Кнопка отправки визуально неактивна при пустом тексте и активируется после ввода.

## 3. New chat и создание сохранённого треда

Нажатие `Start new chat`/`New chat` переводит на URL вида `/ai?t=new&…`, но ещё не создаёт видимую строку треда. В наблюдаемом сценарии незавершённый текст composer перенёсся на new-chat surface — значит, draft нельзя считать локальным только для старого route.

После submit:

1. URL сразу становится `/chat?t=<threadId>&wfv=chat`.
2. В группе `Today` появляется новая строка с `Now`.
3. Заголовок автоматически генерируется из промпта и одновременно меняет browser title.
4. User message показывается в серой rounded bubble справа/по центру.
5. Ответ появляется отдельным текстовым блоком без карточочного фона.
6. После окончания появляется текстовый статус `Notion AI finished.`.

## 4. Full-page saved chat

### Header

Шапка высотой `44px` остаётся неподвижной:

- AI-face icon;
- кнопка `Notion AI`, возвращающая на AI home;
- slash separator;
- кнопка текущего заголовка с chevron;
- справа `Share chat`, `Start new chat`, `Pin chat`, toggle details, `…`.

Клик по заголовку открывает history popover шириной `320px` прямо под ним. Он повторяет сгруппированный список чатов без workspace chrome и позволяет быстро переключить thread.

Top `…` показывает: `Copy link`, `Rename`, `Delete`, а ниже read-only `Last updated …`. Sidebar-меню дополнительно умеет Pin, unread и open-new-tab.

### Messages

- User prompts — светло-серые rounded bubbles, обычно выровнены вправо внутри центральной колонки.
- Assistant responses — plain content с rich text: headings, bullets, code, inline code, quotes.
- Под ответом: copy, save/add, thumbs up/down.
- Под user message на hover/активном состоянии: edit и copy.
- Tool/agent work выводится как collapsible `Thought`, `N steps`, отдельные строки действий и artifact cards (`Open page`, `Show changes`, `Save`, `Undo`).
- При прокрутке вверх появляется чёрная круглая кнопка jump-to-latest над composer.

### Scrolling

Внешний document не скроллится. Лента находится во внутреннем `overflow-y:auto` контейнере:

- desktop box: `x=270, y=44, w=1170, h=732`;
- измеренная длинная лента: `scrollHeight=107152`, `clientHeight=732`;
- header остаётся на `y=8`;
- composer остаётся на `y=776` для top/middle/bottom.

Точные top/middle/bottom сэмплы: [scroll-map.json](./scroll-map.json).

### Composer

Composer закреплён у нижней кромки, но не растянут на весь экран: центральная ширина около `694px`. Он повторяет действия AI home. Пока пользователь читает историю, composer остаётся доступен; лента имеет нижний padding под него.

### Agent details

Для богатого треда справа появляется панель `318px`:

- `Knowledge` с источниками и типовыми счётчиками;
- `Skills`;
- `Artifacts`;
- collapsible section headers и `Show more`.

Кнопка в header скрывает/возвращает панель. При скрытии центральный контент визуально центрируется и получает больше воздуха. На `1024px` панель уже auto-collapsed, а header показывает `Expand agent details`.

## 5. Rename

Сценарий:

1. Открыть `Delete, rename, and more…`.
2. Выбрать `Rename`.
3. Появляется компактный popover `280×40` с prefilled textbox `Rename chat`.
4. `Enter` сохраняет без отдельной кнопки.
5. Header, sidebar row и browser title обновляются сразу.
6. `Escape` отменяет и закрывает popover.

## 6. Browser history

Нативная browser history поддерживается:

- Back из `/chat?t=…` вернул `/ai` и home heading;
- Forward вернул точный thread URL и title.

Приложение не заменяет browser navigation собственным faux-history и не теряет выбранный thread.

## 7. Sidebar collapse/shift

`Close sidebar` не размонтирует rail. Наблюдаемая workspace switcher geometry после анимации: `x=-251, width=254`, то есть почти вся панель переводится за левую границу, остаётся узкий edge.

Главная область действительно возвращает место: composer чата остаётся `694px`, но переезжает с `x=336` примерно на `x=249`. Это ощущается как shift/recenter, а не overlay на desktop.

Для ProjectsFlow лучше повторить результат, но не скрывать кнопку возврата так агрессивно: нужен стабильный burger/reopen control.

## 8. Responsive

### Tablet 1024×768

- Sidebar остаётся desktop-ширины `270px`.
- AI home composer уменьшается до `650px`.
- Long-chat details panel автоматически скрывается.
- Центральная chat column остаётся около `694px` и помещается в оставшиеся `754px`.

### Mobile 390×844, sidebar уже скрыт

- Чат становится рабочим single-column layout.
- Composer: `x=35, width=316`.
- Заголовок сокращается до `94px` с ellipsis.
- Share/new/pin/more умещаются в одну строку.
- Message bubbles и assistant copy переносятся по словам.

### Mobile 390×844, sidebar раскрыт

Это наблюдаемый дефект, его не следует копировать:

- Sidebar остаётся `270px`.
- Home composer начинается с `x=322` и заканчивается на `614`, то есть выходит за viewport на `224px`.
- В saved chat header `…` находится на `x=594`, а composer заканчивается на `610`.
- Возникает горизонтальный scrollbar и большая часть main canvas недоступна без боковой прокрутки.

В ProjectsFlow sidebar на узких экранах должен быть modal drawer/overlay, а не постоянная колонка.

## 9. Recommended transfer to ProjectsFlow

Копировать как паттерны:

- отдельный полноэкранный AI workspace, а не небольшой help popup;
- time-grouped durable threads с active/hover/actions;
- один composer, общий для home и thread;
- generated title + inline rename;
- native Back/Forward;
- internal transcript scroll + fixed composer + jump-to-latest;
- rich messages/actions/tool steps/artifacts;
- optional details panel и auto-collapse на tablet;
- draft persistence и optimistic creation;
- полноценные accessible names и keyboard flows.

Не копировать:

- mobile overflow с фиксированным 270px sidebar;
- generic aria name `history`;
- безымянный AI-face/jump button;
- скрытый reopen affordance после sidebar collapse;
- чрезмерно плотный top bar на very narrow screens — ProjectsFlow может переносить вторичные actions в overflow раньше.

## Evidence index

- Home: `desktop-home`, `tablet-home`, `mobile-home` (`.png` + `.json`).
- Saved/full chat: `desktop-existing`, `tablet-existing`, `mobile-existing`.
- Usable collapsed-sidebar mobile chat: `mobile-chat`.
- Create/rename: `desktop-created`, `desktop-renamed`.
- Sidebar/details: `desktop-collapsed-actual`, `desktop-details-hidden`.
- Back/forward: `navigation.json`, `desktop-browser-back.png`, `desktop-browser-forward.png`.
- Scroll: `scroll-map.json`, `desktop-scroll-{top,middle,bottom}.png`.

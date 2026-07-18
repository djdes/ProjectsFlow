# Поведение Preview

## Верхняя панель

- `Preview` и `Dashboard` переключают рабочую область, не закрывая левый AI-чат.
- `Edit mode` переводит результат в режим выбора DOM-элементов. Повторное наблюдение подтвердило рабочее состояние: hover подсвечивает кандидата, click фиксирует selection синей рамкой и показывает label с HTML-tag.
- `Canvas` открывает отдельную бесконечную точечную сцену с фреймами страниц.
- Refresh перезагружает iframe результата.
- Поле маршрута открывает список страниц и предложенных путей.
- Кнопка устройства циклически меняет desktop → tablet → mobile → desktop.
- `Publish` открывает модальное окно публикации.

## Выбор маршрута

- Статические страницы можно открыть сразу.
- Динамический маршрут отображается, но недоступен без конкретного параметра.
- Текущий путь сохраняется в панели, а приложение остаётся в изолированном iframe.

## Canvas

- Отдельный URL `/editor/canvas`.
- Фреймы Home, Catalog, Checkout и ProductDetail разложены на полотне.
- Доступны select, hand, draw, sticky note, image и масштабирование.
- Canvas полезен для карты страниц, но не нужен ProjectsFlow в первом этапе.

## Edit mode

- Элемент можно выбрать на любом уровне: текст/кнопка/иконка/контейнер/крупный section; label показывает tag выбранного узла.
- Выделение остаётся привязанным к элементу при прокрутке результата.
- Floating toolbar размещается рядом с доступной границей selection и не перекрывает верхнюю панель.
- Regenerate design запускается для выбранного элемента/области, а не для всей страницы.
- `Edit Element` открывает точечный prompt-flow с контекстом выбранного блока.
- Theme/Custom palette управляет семантическими цветами: background, foreground, card, card foreground, popover, primary и др.; есть clear color.
- Наблюдались element actions для структуры/копирования, ссылки, layout/spacing, code preview, source/code, delete и закрытия selection.
- Верхние undo/redo относятся к изменениям editor session.
- Сохранение реального изменения, destructive delete и финальная публикация не выполнялись; exact persistence semantics отмечены как not observed.

## Дополнительные действия

- Act as a user;
- Testing agent;
- GitHub connection;
- This page's files;
- Activity monitor;
- Export project as ZIP;
- Help center.

## Publish

- вкладки Web/Mobile;
- настройка URL и видимости;
- security scan;
- финальная кнопка публикации.

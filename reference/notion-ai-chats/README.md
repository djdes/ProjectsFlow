# Notion AI chats — clean-room reference package

Исследование выполнено в пользовательской авторизованной вкладке через Playwright/CDP `9222`. Приватные API, исходники Notion, cookies и токены не исследовались.

## Main documents

- [repository-audit.md](./repository-audit.md) — текущая архитектура ProjectsFlow, gap matrix и production design.
- [behavior.md](./behavior.md) — подробное наблюдаемое поведение UI.
- [accessibility.md](./accessibility.md) — роли, keyboard/focus и проблемы.
- [geometry.json](./geometry.json) — точные CSS-pixel coordinates по desktop/tablet/mobile.
- [scroll-map.json](./scroll-map.json) — top/middle/bottom длинного чата.
- [state-machine.json](./state-machine.json) — состояния и переходы.
- [scenarios.json](./scenarios.json) — воспроизводимые сценарии с evidence.
- [navigation.json](./navigation.json) — фактический Back/Forward trace.
- [accessibility.json](./accessibility.json) — машинно-читаемый audit.

## Canonical screenshots

- Desktop AI home: `desktop-home.png` + `desktop-home.json`.
- Desktop saved/full chat: `desktop-existing.png` + `desktop-existing.json`.
- Desktop created/renamed: `desktop-created.*`, `desktop-renamed.*`.
- Desktop collapsed sidebar: `desktop-collapsed-actual.*`.
- Desktop hidden details: `desktop-details-hidden.*`.
- Desktop scroll: `desktop-scroll-top.png`, `desktop-scroll-middle.png`, `desktop-scroll-bottom.png`.
- Tablet: `tablet-home.*`, `tablet-chat.*`, `tablet-existing.*`.
- Mobile usable chat: `mobile-chat.*`.
- Mobile expanded-sidebar failure: `mobile-home.*`, `mobile-existing.*`.

## External state changed by the authorized scenario

Создан один нейтральный чат `[Research] AI chat behavior`, затем переименован через UI. Никакие существующие чаты не переименовывались и не удалялись; destructive menu actions не нажимались.

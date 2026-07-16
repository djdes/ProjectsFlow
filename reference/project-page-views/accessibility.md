# Accessibility observations

## Roles

- View list: `role="tablist"`.
- Each visible view: `role="tab"` with `aria-selected`.
- Overflow trigger: `role="button"`.
- Overflow popup: `role="dialog"`.
- Overflow rows: `role="option"`.
- Context actions: `role="menu"` and `role="menuitem"`.
- Table headers and cells are exposed primarily as focusable `role="button"` elements.
- Add-column trigger has `aria-haspopup="dialog"` and `aria-expanded`.

## Keyboard

- Visible view tabs are individually tabbable.
- Enter on `N more…` opens the overflow.
- Escape closes popup/menu/panel without switching view.
- Right-click alternatives should include `Shift+F10` / ContextMenu key in ProjectsFlow.
- Rename focuses the view-name input.
- Add-column focuses `Type property name…`.
- New view creation focuses `View name`.
- Modal confirmations require a focus trap and Escape/Cancel path.

## Focus observations

- Opening overflow from keyboard correctly records the trigger as the active element.
- In the observed Notion build, closing overflow with Escape moved focus to the document body rather than reliably restoring it to the trigger. ProjectsFlow should improve this and restore focus to the opener.
- View settings should return focus to the originating tab or settings trigger when closed.
- Context menu should return focus to the view tab.

## Visual focus

- Active cell: blue inset outline.
- Range anchor: `2 px` blue inset outline.
- Text fields: blue border.
- Active tab is distinguishable by both pill background and `aria-selected`.
- Selection is not represented by color alone: checkboxes and `N selected` toolbar are also shown.

## Required ProjectsFlow behavior

- All icon-only controls need `aria-label`.
- Tooltips must appear on hover and keyboard focus.
- `aria-live="polite"` should announce view creation/deletion, property creation/deletion and bulk selection count.
- Destructive dialogs need explicit resource names.
- Disabled actions need a readable explanation.
- Focus must never move behind an open modal.
- Reduced-motion mode must remove layout animation without removing state feedback.

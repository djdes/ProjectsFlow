# Visual verification

## Scope

The comparison covers the project page collection area: view tabs, view menus,
layout settings, creation of a view/property, all eleven view layouts, and the
table at desktop, tablet, and compact widths.

## Method

- Reference screenshots were captured from the already-open Notion tab at
  `1440x900`, `1024x768`, and `390x844`.
- Actual screenshots were captured from ProjectsFlow with the same Chrome CDP
  session and deterministic mocked project data.
- Product branding, theme colors, sidebar content, task text, and account data
  are intentionally excluded from pixel-level comparison.
- The comparison is structural: geometry, density, scroll ownership, sticky
  behavior, state transitions, menus, and responsive behavior.

## Result

| Area | Reference | ProjectsFlow | Result |
| --- | --- | --- | --- |
| View tabs | Flat 32 px active pill; text/icon display modes | Same interaction and density | Pass |
| View context menu | Rename, display, edit, source, copy, duplicate, delete | Same order and nested display menu | Pass |
| View overflow | Search, reorder, per-view menu, create | Same structure and keyboard dismissal | Pass |
| Edit view | Non-modal right popover with nested layout page | Same flat popover and nested layout controls | Pass |
| Table density | 36 px header and 36/37 px rows | 36 px header and rows | Pass |
| Table selection | Cell range, row promotion on context menu, two-stage dismiss | Same state transitions | Pass |
| Add property | Reserve 350 px, scroll to new edge, open picker, commit 200 px | Same geometry and transition | Pass |
| Scroll ownership | View toolbar scrolls with page; table header is sticky | Same behavior | Pass |
| Board, list, calendar, gallery | Minimal, border-led layouts without card shadows | Same visual hierarchy | Pass |
| Timeline, chart, feed | Dedicated layouts and layout settings | Same primary behavior | Pass |
| Map | Empty map when no valid place data exists | Neutral empty map canvas | Pass with limitation |
| Dashboard | Module-based canvas | Chart/table/list modules | Pass with limitation |
| Form | Initial setup, builder, preview/share/submit | Same state flow; text questions | Pass with limitation |
| Tablet/compact | Horizontal data scroll, compact controls | Same behavior | Pass |

## Known visual differences

1. ProjectsFlow keeps its own light theme, branding, icons, and navigation shell.
2. Map intentionally does not embed Notion's third-party tile provider.
3. Dashboard does not reproduce arbitrary drag-resize geometry; it provides
   persisted chart, table, and list modules.
4. Form questions currently use text inputs rather than every Notion property
   subtype.
5. Calendar integration and external data-source management are represented by
   ProjectsFlow-native actions; they do not call Notion services.

The captured implementation states are in `../actual/`; the corresponding
reference states are in `../screenshots/`.

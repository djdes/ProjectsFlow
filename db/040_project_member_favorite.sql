-- db/040_project_member_favorite.sql
-- Персональные favorites: каждый участник может пометить проект как «избранный» и
-- получить отдельную секцию сверху сайдбара с собственным порядком. Поведение —
-- как в Todoist (проект виден И в «Избранное», И в «Мои проекты»), поэтому нужен
-- отдельный favorite_sort_order, не пересекающийся с обычным sort_order.
-- favorite_sort_order имеет смысл только при is_favorite=TRUE; для не-favorites
-- игнорируется. Бэкфилл не требуется (DEFAULT FALSE/0).

ALTER TABLE project_members
  ADD COLUMN is_favorite          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN favorite_sort_order  INT     NOT NULL DEFAULT 0;

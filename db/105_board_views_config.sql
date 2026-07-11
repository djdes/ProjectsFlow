-- Пер-вью настройки (Notion view settings): фильтры, сортировка, скрытые свойства,
-- ширины колонок, группировка, условные цвета и т.д. Хранится как JSON —
-- структуру знает клиент, сервер только валидирует размер.
ALTER TABLE board_views
  ADD COLUMN config JSON NULL AFTER sort_order;

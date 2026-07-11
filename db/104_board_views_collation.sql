-- Выравнивание коллации board_views (db/103) с остальными таблицами (utf8mb4_unicode_ci):
-- 103 создал таблицу без явного COLLATE → серверный дефолт utf8mb4_general_ci, из-за чего
-- JOIN'ы board_views ↔ projects падают с «Illegal mix of collations». Приложение сейчас
-- не джойнит эти таблицы, но выравниваем впрок.
ALTER TABLE board_views CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

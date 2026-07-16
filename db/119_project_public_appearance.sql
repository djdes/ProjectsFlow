-- Настройки оформления публичной доски проекта (Publish to web).
-- NULL означает встроенные дефолты; JSON позволяет добавлять новые визуальные опции
-- без серии nullable-колонок и сохраняет настройки при снятии публикации.
ALTER TABLE projects
  ADD COLUMN public_appearance JSON NULL AFTER public_indexing;

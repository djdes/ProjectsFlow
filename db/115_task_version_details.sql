-- Полная история задачи: точный набор изменённых полей + миллисекунды для строгого
-- порядка быстрых последовательных правок. Старые версии получают changed_fields
-- динамически сравнением снимков при чтении.
ALTER TABLE task_versions
  ADD COLUMN IF NOT EXISTS changed_fields JSON NULL AFTER snapshot,
  MODIFY COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- 013: добавляем «безымянную» backlog-колонку на канбан-доску (слева от TODO).
-- Семантика: куда юзер скидывает сырые идеи / triage-кандидаты; в TODO их потом
-- поднимает стрелочкой → или drag'ом. Default по-прежнему 'todo' — quick-add и
-- кнопки `+` на других колонках работают как раньше.

ALTER TABLE tasks
  MODIFY COLUMN status ENUM('backlog','todo','in_progress','done') NOT NULL DEFAULT 'todo';

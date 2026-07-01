-- Пер-юзерные лимиты диспетчера (стадия 1 — воркер).
-- billed_user_id — «инициатор» прогона воркера: делегатор задачи
-- (task_delegations.delegator_user_id), зафиксированный на старте live-сессии.
-- На его профиль списывается стоимость (total_cost_usd) и по нему гейтится бюджет.
-- NULL — инициатор не резолвится (legacy/нет делегатора) → fallback на dispatcher.
ALTER TABLE live_sessions
  ADD COLUMN billed_user_id CHAR(36) NULL AFTER model;

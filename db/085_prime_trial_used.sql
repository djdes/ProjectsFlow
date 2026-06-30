-- 085_prime_trial_used.sql — разовый пробный Прайм.
-- Прайм можно активировать самому только ОДИН раз на 1 час (см. BuyPlan). Метка фиксирует
-- момент активации триала; повторная self-serve активация Прайма после этого запрещена (409).
-- Аддитивно, nullable (null = триал ещё не использован). См. план gleaming-munching-locket (M1).
ALTER TABLE users
  ADD COLUMN prime_trial_used_at TIMESTAMP NULL;

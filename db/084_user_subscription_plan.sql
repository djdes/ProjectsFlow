-- 084_user_subscription_plan.sql — подписочный план юзера.
-- plan применяется к prime/vip (лимиты по двум скользящим окнам 5ч/7д); free — метеринг для
-- витрины без блокировок. На регистрации plan='free' (DEFAULT — бэкфилл существующих строк не нужен).
-- subscription_started_at ставится при «покупке» плана; subscription_expires_at — опционально
-- (NULL = бессрочно / до отмены). Истёкший prime/vip лениво трактуется как free на чтении.
-- См. план gleaming-munching-locket (M2).
ALTER TABLE users
  ADD COLUMN plan ENUM('free','prime','vip') NOT NULL DEFAULT 'free',
  ADD COLUMN subscription_started_at TIMESTAMP NULL,
  ADD COLUMN subscription_expires_at TIMESTAMP NULL;

-- 083_ai_prompt_jobs_cost.sql — ai_prompt_jobs (db/042) не хранил стоимость прогона.
-- Добавляем cost_usd/tokens_in/tokens_out (как в live_sessions / monitoring_analysis_jobs),
-- чтобы раннер «перефразировок» (improve/compose/compose-advanced) репортил расход при complete,
-- а метеринг (ai_usage_ledger) его учитывал. Аддитивно, nullable. См. план gleaming-munching-locket (M1).
ALTER TABLE ai_prompt_jobs
  ADD COLUMN cost_usd   DECIMAL(10,4) NULL,
  ADD COLUMN tokens_in  BIGINT        NULL,
  ADD COLUMN tokens_out BIGINT        NULL;

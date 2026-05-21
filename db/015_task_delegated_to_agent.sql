-- db/015_task_delegated_to_agent.sql
-- Sticky-флаг «отдано агенту». UI ориентируется на agent_jobs.status (активная job
-- = queued/running), но флаг полезен для будущей логики re-queue при failed.

ALTER TABLE tasks
  ADD COLUMN delegated_to_agent BOOLEAN NOT NULL DEFAULT FALSE;

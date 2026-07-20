-- 137: privacy-preserving traffic analytics for the PUBLISHED application.
--
-- This is deliberately NOT a surveillance journal. We split two different metrics that the
-- dashboard used to conflate:
--   * "просмотры карточки проекта" — internal ProjectsFlow page views (see project_views);
--   * "трафик опубликованного приложения" — hits on the deployed <slug>.projectsflow.ru site,
--     recorded HERE.
--
-- What we store, and why it cannot be turned into tracking:
--   * NO IP address and NO raw User-Agent are ever persisted. The IP + UA are used only
--     transiently, in-request, to derive session_hash, then discarded.
--   * session_hash is a salted SHA-256 that MIXES IN visit_day, so it rotates every calendar
--     day: it lets us count distinct sessions within a day but is useless for following a
--     visitor across days (no durable identifier exists to join on).
--   * user_agent_class is a coarse fixed bucket ('desktop'/'mobile'/'bot'/'other') computed by
--     our server — not the raw string, so no fingerprinting surface.
--   * path stores only the URL pathname (query string and fragment are stripped before insert),
--     so secrets accidentally passed in query params never land in the table.
--
-- The reception endpoint is public and unauthenticated (called by the deployed site), so the
-- application layer enforces a per-project rate limit AND a per-day row cap: without them a
-- public endpoint is a vector for inflating a project's storage quota. visit_day is a plain
-- CHAR(10) 'YYYY-MM-DD' so the cap check and the daily aggregation are a single indexed scan.
--
-- created_at is an ISO-8601 millisecond string, consistent with app_admin_audit_log (db/136).
CREATE TABLE IF NOT EXISTS app_page_visits (
  seq             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id      CHAR(36)     NOT NULL,
  -- URL pathname only (no query/fragment). Capped so a hostile client cannot bloat rows.
  path            VARCHAR(512) NOT NULL,
  -- Salted, day-rotating SHA-256 hex. Anonymous by construction — no reverse to IP/UA.
  session_hash    CHAR(64)     NOT NULL,
  -- Coarse platform bucket, NOT the raw UA: 'desktop' | 'mobile' | 'bot' | 'other'.
  user_agent_class VARCHAR(16) NOT NULL,
  -- 'YYYY-MM-DD' (UTC). Drives the per-day aggregate and the per-day insert cap.
  visit_day       CHAR(10)     NOT NULL,
  created_at      VARCHAR(32)  NOT NULL,
  -- Covers both the daily cap count and the windowed GROUP BY visit_day aggregation.
  KEY idx_app_page_visits_project_day (project_id, visit_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

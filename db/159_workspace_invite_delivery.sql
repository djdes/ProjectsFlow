-- Existing invitations are retained; historical recipients are not re-notified.
ALTER TABLE workspace_invites
  ADD COLUMN delivery JSON NULL,
  ADD COLUMN delivery_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN delivery_next_attempt_at TIMESTAMP NULL,
  ADD COLUMN delivery_locked_at TIMESTAMP NULL,
  ADD COLUMN last_sent_at TIMESTAMP NULL,
  ADD INDEX idx_ws_invites_delivery (delivery_next_attempt_at, delivery_locked_at);

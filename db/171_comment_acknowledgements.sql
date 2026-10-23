-- Explicit acceptance of a comment, separate from reading it or approving the task.
-- Like comment_notifications, references are checked in the application.
CREATE TABLE task_comment_acknowledgements (
  comment_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  comment_body_hash BINARY(32) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (comment_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

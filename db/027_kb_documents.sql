-- db/027_kb_documents.sql
-- Локальная База знаний: markdown-документы проекта в БД (когда kb_kind='local').
-- content — полный исходник md (frontmatter+body); sha = sha256(content) для optimistic-lock.

CREATE TABLE IF NOT EXISTS kb_documents (
  id          CHAR(36)     NOT NULL,
  project_id  CHAR(36)     NOT NULL,
  path        VARCHAR(500) NOT NULL,
  content     LONGTEXT     NOT NULL,
  sha         CHAR(64)     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kb_doc_project_path (project_id, path),
  KEY idx_kb_doc_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

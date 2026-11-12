-- 181: рабочие Telegram-группы пространства и подключение людей из них через бота.
-- См. docs/superpowers/specs/2026-11-12-telegram-work-groups-design.md.

-- Рабочие группы: в них бот принимает задачи пространства, а людей без аккаунта или вне
-- пространства подключает кнопкой. Одна группа — рабочая максимум у одного пространства (PK).
CREATE TABLE IF NOT EXISTS workspace_telegram_groups (
  tg_chat_id       BIGINT       NOT NULL,
  workspace_id     CHAR(36)     NOT NULL,
  title            VARCHAR(255) NULL,
  added_by_user_id CHAR(36)     NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id),
  KEY idx_wtg_workspace (workspace_id),
  CONSTRAINT fk_wtg_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Одноразовые коды кнопки «Подключить группу»: t.me/<bot>?startgroup=wg_<code>. Telegram
-- присылает в выбранную группу «/start@bot wg_<code>», и бот узнаёт id группы сам.
-- Храним только SHA-256 кода. purpose: work — рабочая группа, main — основная группа сводок.
CREATE TABLE IF NOT EXISTS telegram_group_link_tokens (
  token_hash         CHAR(64)            NOT NULL,
  workspace_id       CHAR(36)            NOT NULL,
  purpose            ENUM('work','main') NOT NULL DEFAULT 'work',
  created_by_user_id CHAR(36)            NOT NULL,
  expires_at         TIMESTAMP           NOT NULL,
  created_at         TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_tglt_workspace (workspace_id),
  CONSTRAINT fk_tglt_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Человек написал задачу в рабочей группе, но ещё не подключён (нет аккаунта/Telegram или не
-- участник пространства). Текст ждёт здесь; id — в deep link t.me/<bot>?start=wj_<id>.
-- invite_id — персональное приглашение, выданное в личке бота; после его принятия бот создаёт
-- задачу из pending_text. last_source_key — защита от повторной доставки того же сообщения.
CREATE TABLE IF NOT EXISTS telegram_group_onboardings (
  id              CHAR(12)     NOT NULL,
  tg_chat_id      BIGINT       NOT NULL,
  workspace_id    CHAR(36)     NOT NULL,
  tg_user_id      BIGINT       NOT NULL,
  -- Профиль Telegram из личного /start: сохраняем в аккаунт при привязке.
  tg_username     VARCHAR(64)  NULL,
  tg_first_name   VARCHAR(128) NULL,
  sender_name     VARCHAR(255) NOT NULL,
  group_title     VARCHAR(255) NULL,
  pending_text    TEXT         NULL,
  last_source_key VARCHAR(128) NULL,
  status          ENUM('pending','invited','completed') NOT NULL DEFAULT 'pending',
  invite_id       CHAR(36)     NULL,
  prompted_at     TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP    NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tgo_member (tg_chat_id, tg_user_id),
  KEY idx_tgo_invite (invite_id),
  CONSTRAINT fk_tgonb_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mailing letter designs: 'standard' (the classic card) or a promo layout with a hero image
-- and an offer strip. offer = {"badge": "7 дней", "deadline": "до 30 ноября"} or NULL; it is
-- display text only (plans are still granted by an admin). Campaigns keep their own snapshot.
-- Existing rows get 'standard' and render exactly as before.

ALTER TABLE mailing_templates
  ADD COLUMN layout VARCHAR(32) NOT NULL DEFAULT 'standard' AFTER cta_url,
  ADD COLUMN offer JSON NULL DEFAULT NULL AFTER layout;

ALTER TABLE mailing_campaigns
  ADD COLUMN layout VARCHAR(32) NOT NULL DEFAULT 'standard' AFTER cta_url,
  ADD COLUMN offer JSON NULL DEFAULT NULL AFTER layout;

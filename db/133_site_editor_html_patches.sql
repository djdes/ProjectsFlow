-- 133: source-tab edits are persisted as sanitized single-element HTML patches.
ALTER TABLE site_patches
  MODIFY COLUMN kind ENUM('text', 'html', 'style', 'attribute', 'visibility', 'command') NOT NULL;

PRAGMA foreign_keys = ON;

ALTER TABLE routers ADD COLUMN notes TEXT NOT NULL DEFAULT '';

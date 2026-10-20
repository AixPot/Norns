-- Archive is deliberately not migrated into completion.
ALTER TABLE cards ADD COLUMN completed BOOLEAN NOT NULL DEFAULT 0 CHECK(completed IN (0,1));

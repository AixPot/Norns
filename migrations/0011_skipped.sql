ALTER TABLE cards ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0 CHECK(skipped IN (0,1) AND NOT (skipped=1 AND completed=1));
CREATE TRIGGER skipped_completed_guard BEFORE UPDATE OF completed ON cards WHEN NEW.skipped=1 AND NEW.completed=1 BEGIN SELECT RAISE(ABORT,'completed and skipped are mutually exclusive'); END;
CREATE TRIGGER skipped_touch AFTER UPDATE OF skipped ON cards WHEN NEW.skipped<>OLD.skipped BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.id; END;

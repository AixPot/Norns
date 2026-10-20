ALTER TABLE cards ADD COLUMN series_id TEXT;
ALTER TABLE cards ADD COLUMN predecessor_id INTEGER REFERENCES cards(id);
ALTER TABLE cards ADD COLUMN occurrence_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cards ADD COLUMN anchor_schedule TEXT;
ALTER TABLE cards ADD COLUMN touch_version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX cards_successor ON cards(predecessor_id) WHERE predecessor_id IS NOT NULL;
-- Monotonic, including reverted edits, no-op updates and asynchronous attachment processing.
CREATE TRIGGER card_touch AFTER UPDATE OF title,description,list_id,position,archived,completed,assignee_id,due_date,schedule ON cards BEGIN
 UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.id;
END;
CREATE TRIGGER checklist_items_touch_insert AFTER INSERT ON checklist_items BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER checklist_items_touch_update AFTER UPDATE ON checklist_items BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER checklist_items_touch_delete AFTER DELETE ON checklist_items BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=OLD.card_id; END;
CREATE TRIGGER comments_touch_insert AFTER INSERT ON comments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER comments_touch_update AFTER UPDATE ON comments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER comments_touch_delete AFTER DELETE ON comments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=OLD.card_id; END;
CREATE TRIGGER attachments_touch_insert AFTER INSERT ON attachments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER attachments_touch_update AFTER UPDATE ON attachments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=NEW.card_id; END;
CREATE TRIGGER attachments_touch_delete AFTER DELETE ON attachments BEGIN UPDATE cards SET touch_version=touch_version+1 WHERE id=OLD.card_id; END;

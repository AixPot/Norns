-- INTEGER PRIMARY KEY reuses the highest deleted rowid. Withdrawn successors must
-- never alias unrelated future cards through stale URLs/attachment child requests.
CREATE TABLE card_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),last_id INTEGER NOT NULL);
INSERT INTO card_identity SELECT 1,COALESCE(MAX(id),0) FROM cards;
CREATE TRIGGER cards_identity_insert AFTER INSERT ON cards BEGIN
 UPDATE card_identity SET last_id=MAX(last_id,NEW.id) WHERE singleton=1;
END;

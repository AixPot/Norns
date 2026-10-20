CREATE TABLE checklist_items(id INTEGER PRIMARY KEY,card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,title TEXT NOT NULL,checked BOOLEAN NOT NULL DEFAULT 0,position INTEGER NOT NULL);
CREATE INDEX checklist_card ON checklist_items(card_id,position,id);
ALTER TABLE cards ADD COLUMN assignee_id INTEGER REFERENCES users(id);
ALTER TABLE cards ADD COLUMN due_date TEXT;
CREATE TABLE comments(id INTEGER PRIMARY KEY,card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,author_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX comments_card ON comments(card_id,created_at,id);

CREATE TABLE attachments(id TEXT PRIMARY KEY,card_id INTEGER NOT NULL REFERENCES cards(id),filename TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0),mime TEXT NOT NULL DEFAULT 'application/octet-stream',state TEXT NOT NULL CHECK(state IN ('pending','verifying','ready','deleted')),staging TEXT NOT NULL UNIQUE,final_key TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX attachments_card ON attachments(card_id,state);
CREATE TABLE attachment_outbox(key TEXT PRIMARY KEY,not_before INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);

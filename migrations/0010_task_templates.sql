-- Detached owner-only content. No board/card references or executable schedule fields.
CREATE TABLE task_templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(CAST(name AS BLOB)) BETWEEN 1 AND 160),
 title TEXT NOT NULL CHECK(length(CAST(title AS BLOB)) BETWEEN 1 AND 160),
 description TEXT NOT NULL CHECK(length(CAST(description AS BLOB))<=20000),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1)
);
CREATE INDEX task_templates_owner ON task_templates(owner_id,id);
CREATE TABLE task_template_items (
 template_id INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(CAST(title AS BLOB)) BETWEEN 1 AND 500),
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 99),
 PRIMARY KEY(template_id,position)
);

-- Preserve the high water mark even when all source checklist rows are deleted.
-- Existing checklist rows and their foreign keys stay untouched.
CREATE TABLE checklist_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 last_id INTEGER NOT NULL
);
INSERT INTO checklist_identity SELECT 1,COALESCE(MAX(id),0) FROM checklist_items;
CREATE TRIGGER checklist_identity_insert AFTER INSERT ON checklist_items BEGIN
 UPDATE checklist_identity SET last_id=MAX(last_id,NEW.id) WHERE singleton=1;
END;

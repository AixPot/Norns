CREATE TABLE boards(id INTEGER PRIMARY KEY,title TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE board_members(board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('admin','member')),PRIMARY KEY(board_id,user_id));
CREATE TABLE lists(id INTEGER PRIMARY KEY,board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,title TEXT NOT NULL,position INTEGER NOT NULL);
CREATE INDEX lists_board ON lists(board_id,position,id);
CREATE TABLE cards(id INTEGER PRIMARY KEY,list_id INTEGER NOT NULL REFERENCES lists(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL,archived BOOLEAN NOT NULL DEFAULT 0);
CREATE INDEX cards_list ON cards(list_id,archived,position,id);

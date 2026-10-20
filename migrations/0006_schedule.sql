ALTER TABLE cards ADD COLUMN schedule TEXT;
UPDATE cards SET schedule=json_object('start_date',due_date,'timezone','Asia/Shanghai') WHERE due_date IS NOT NULL;

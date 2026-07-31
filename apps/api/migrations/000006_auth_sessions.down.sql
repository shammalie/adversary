ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_user_id_fkey;
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_owner_user_id_fkey;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

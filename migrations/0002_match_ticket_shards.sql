ALTER TABLE match_tickets ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
ALTER TABLE match_tickets ADD COLUMN skill TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_match_tickets_shard
  ON match_tickets (game_id, mode, region, skill, status);

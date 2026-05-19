PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_room_index_game_mode_status;
DROP INDEX IF EXISTS idx_match_tickets_lookup;
DROP INDEX IF EXISTS idx_match_tickets_shard;

ALTER TABLE room_index RENAME TO room_index_old;

CREATE TABLE room_index (
  room_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  min_players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  do_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);

INSERT INTO room_index (
  room_id,
  game_id,
  mode,
  status,
  player_count,
  min_players,
  max_players,
  do_name,
  created_at,
  updated_at,
  closed_at
)
SELECT
  room_id,
  game_id,
  mode,
  status,
  player_count,
  min_players,
  max_players,
  do_name,
  created_at,
  updated_at,
  closed_at
FROM room_index_old;

DROP TABLE room_index_old;

CREATE INDEX idx_room_index_game_mode_status
  ON room_index (game_id, mode, status);

ALTER TABLE match_tickets RENAME TO match_tickets_old;

CREATE TABLE match_tickets (
  ticket_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL,
  matched_room_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  region TEXT NOT NULL DEFAULT 'global',
  skill TEXT NOT NULL DEFAULT 'default'
);

INSERT INTO match_tickets (
  ticket_id,
  game_id,
  mode,
  player_id,
  display_name,
  status,
  matched_room_id,
  created_at,
  updated_at,
  region,
  skill
)
SELECT
  ticket_id,
  game_id,
  mode,
  player_id,
  display_name,
  status,
  matched_room_id,
  created_at,
  updated_at,
  region,
  skill
FROM match_tickets_old;

DROP TABLE match_tickets_old;

CREATE INDEX idx_match_tickets_lookup
  ON match_tickets (game_id, mode, status);

CREATE INDEX idx_match_tickets_shard
  ON match_tickets (game_id, mode, region, skill, status);

ALTER TABLE match_results RENAME TO match_results_old;

CREATE TABLE match_results (
  room_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  winner_player_id TEXT,
  result_json TEXT NOT NULL,
  replay_pointer TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO match_results (
  room_id,
  game_id,
  mode,
  status,
  winner_player_id,
  result_json,
  replay_pointer,
  created_at
)
SELECT
  room_id,
  game_id,
  mode,
  status,
  winner_player_id,
  result_json,
  replay_pointer,
  created_at
FROM match_results_old;

DROP TABLE match_results_old;

PRAGMA foreign_keys = ON;

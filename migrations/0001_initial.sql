CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  adapter_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_index (
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
  closed_at TEXT,
  FOREIGN KEY (game_id) REFERENCES games(game_id)
);

CREATE INDEX IF NOT EXISTS idx_room_index_game_mode_status
  ON room_index (game_id, mode, status);

CREATE TABLE IF NOT EXISTS match_tickets (
  ticket_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL,
  matched_room_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(game_id)
);

CREATE INDEX IF NOT EXISTS idx_match_tickets_lookup
  ON match_tickets (game_id, mode, status);

CREATE TABLE IF NOT EXISTS match_results (
  room_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  winner_player_id TEXT,
  result_json TEXT NOT NULL,
  replay_pointer TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(game_id)
);

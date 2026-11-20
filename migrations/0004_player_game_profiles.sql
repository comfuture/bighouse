CREATE TABLE IF NOT EXISTS player_game_profiles (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_game_profiles_game_updated
  ON player_game_profiles (game_id, updated_at);

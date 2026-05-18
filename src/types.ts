import type { LobbyDO } from "./do/lobby";
import type { MatchmakerDO } from "./do/matchmaker";
import type { RoomDO } from "./do/room";

export interface Env {
  DB: D1Database;
  ROOM_DO: DurableObjectNamespace<RoomDO>;
  LOBBY_DO: DurableObjectNamespace<LobbyDO>;
  MATCHMAKER_DO: DurableObjectNamespace<MatchmakerDO>;
  ENVIRONMENT: string;
}

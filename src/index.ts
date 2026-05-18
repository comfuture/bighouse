export { LobbyDO } from "./do/lobby";
export { MatchmakerDO } from "./do/matchmaker";
export { RoomDO } from "./do/room";
export type { Env } from "./types";

import type { Env } from "./types";
import { handleRequest } from "./http/routes";

export default {
  async fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  }
} satisfies ExportedHandler<Env>;

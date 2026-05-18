export { LobbyDO } from "./do/lobby";
export { MatchmakerDO } from "./do/matchmaker";
export { RoomDO } from "./do/room";
export type { Env } from "./types";

import "./games";
import type { Env } from "./types";
import { handleRequest } from "./http/routes";
import { cleanupStaleRooms } from "./maintenance/stale-rooms";

export default {
  async fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanupStaleRooms(env));
  }
} satisfies ExportedHandler<Env>;

export { LobbyDO } from "./do/lobby";
export { MatchmakerDO } from "./do/matchmaker";
export { RoomDO } from "./do/room";
export type { Env } from "./types";

import type { Env } from "./types";

export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: "bighouse" });
  }
} satisfies ExportedHandler<Env>;

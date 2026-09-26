import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "yutnori",
  adapterKey: "yutnori",
  displayName: "윷놀이",
  description: "함께 보는 3D 윷 던지기와 말판. 개인전 또는 2:2 팀전으로 네 말을 먼저 완주하세요.",
  minPlayers: 2,
  maxPlayers: 4,
  supportsBots: false,
  modes: [
    { id: "solo", displayName: "2인 개인전", minPlayers: 2, maxPlayers: 2 },
    { id: "team-2v2", displayName: "2:2 팀전", minPlayers: 4, maxPlayers: 4 }
  ],
  config: { backDo: true }
} satisfies GameMetadata;

import { normalizeLegacyChessStage } from "@bighouse/chess/server";
import { normalizeLegacyGomokuStage } from "@bighouse/gomoku/server";
import { normalizeLegacyTankBattleStage } from "@bighouse/tank-battle/server";
import type { JsonObject, RoomState } from "../core/game";

/** Upgrade only the stages whose persisted shapes changed in PR #31. */
export function normalizeLegacyStage(state: RoomState): JsonObject {
  const { stageState } = state;
  switch (state.room.gameId) {
    case "chess":
      return normalizeLegacyChessStage(stageState);
    case "gomoku":
      return normalizeLegacyGomokuStage(stageState, state);
    case "tank-battle":
      return normalizeLegacyTankBattleStage(stageState, state);
    default:
      return stageState;
  }
}

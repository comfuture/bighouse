import { otherStone, type GomokuStatus, type Stone } from "./rules";

export type TurnPlayerSeat = {
  playerId: string;
  seat: number;
};

/**
 * Resolves the active player's stone color from player identity and seat order,
 * avoiding move-count parity (which drifts whenever a turn times out without placing a stone).
 */
export function resolveTurnStone(params: {
  active: boolean;
  status: GomokuStatus;
  playerId: string;
  myStone?: Stone | undefined;
  players: ReadonlyArray<TurnPlayerSeat>;
}): Stone | null {
  if (!params.active || params.status.kind !== "playing") {
    return null;
  }
  const activePlayerId = params.status.playerId;
  if (params.myStone) {
    return activePlayerId === params.playerId ? params.myStone : otherStone(params.myStone);
  }
  const activeSeat = params.players.find((player) => player.playerId === activePlayerId);
  if (activeSeat) {
    return activeSeat.seat === 0 ? "black" : "white";
  }
  return null;
}

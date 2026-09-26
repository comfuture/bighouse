import type { GameMetadata } from "./game";
import { GameServerError } from "./errors";

/** Modes with fixed seats are validated at every room entry point, including RPC. */
export function resolvePlayerLimits(
  definition: GameMetadata,
  input: { mode: string; minPlayers?: number; maxPlayers?: number }
): { minPlayers: number; maxPlayers: number } {
  const mode = definition.modes?.find((candidate) => candidate.id === input.mode);
  if (definition.modes && !mode) {
    throw new GameServerError("bad_request", "Unsupported game mode", 400);
  }
  const minPlayers = input.minPlayers ?? mode?.minPlayers ?? definition.minPlayers;
  const maxPlayers = input.maxPlayers ?? mode?.maxPlayers ?? definition.maxPlayers;
  if (!Number.isInteger(minPlayers) || !Number.isInteger(maxPlayers) || minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > definition.maxPlayers ||
      (mode && (minPlayers !== mode.minPlayers || maxPlayers !== mode.maxPlayers))) {
    throw new GameServerError("bad_request", "Invalid room player limits for this mode", 400);
  }
  return { minPlayers, maxPlayers };
}

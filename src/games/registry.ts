import { GameServerError } from "../core/errors";
import type { GameDefinition } from "../core/game";

const definitions = new Map<string, GameDefinition>();

export function registerGame(definition: GameDefinition): void {
  definitions.set(definition.gameId, definition);
}

export function getGameDefinition(gameId: string): GameDefinition {
  const definition = definitions.get(gameId);
  if (!definition) {
    throw new GameServerError("game_not_found", `Game '${gameId}' is not registered`, 404);
  }
  return definition;
}

export function listGameDefinitions(): GameDefinition[] {
  return Array.from(definitions.values()).sort((a, b) => a.gameId.localeCompare(b.gameId));
}

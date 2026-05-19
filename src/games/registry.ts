import { GameServerError } from "../core/errors";
import type { GameDefinition, GameMetadata, ServerGamePlugin } from "../core/game";

const definitions = new Map<string, GameDefinition>();

export function registerGamePlugin(plugin: ServerGamePlugin): void {
  definitions.set(plugin.gameDefinition.gameId, plugin.gameDefinition);
}

export function registerGamePlugins(plugins: ServerGamePlugin[]): void {
  for (const plugin of plugins) {
    registerGamePlugin(plugin);
  }
}

export function registerGame(definition: GameDefinition): void {
  registerGamePlugin({ gameMetadata: definition.metadata, gameDefinition: definition });
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

export function listGameMetadata(): GameMetadata[] {
  return listGameDefinitions().map((definition) => definition.metadata);
}

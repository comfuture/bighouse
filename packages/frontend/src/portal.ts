import { getClientGameMetadata } from "./game-plugins";
import { identity } from "./identity";
import type { Game } from "./types";

/**
 * Games shown in the home hero, in order. The first one that is registered
 * leads; the rest are offered in the hero's picker. Leave empty to show the
 * plain Bighouse banner instead.
 */
export const featuredGameIds: string[] = ["sunny-meadow", "yutnori", "tank-battle"];

export type CategoryId = "board" | "card" | "action" | "other";

/** Directory shelves, in display order. */
export const categories: Array<{ id: CategoryId; label: string; icon: string }> = [
  { id: "board", label: "Board", icon: "i-lucide-grid-3x3" },
  { id: "card", label: "Cards", icon: "i-lucide-spade" },
  { id: "action", label: "Action", icon: "i-lucide-swords" },
  { id: "other", label: "Other", icon: "i-lucide-shapes" }
];

export function categoryOf(game: Pick<Game, "category">): CategoryId {
  return categories.some((entry) => entry.id === game.category) ? (game.category as CategoryId) : "other";
}

export function categoryLabel(game: Pick<Game, "category">): string {
  const id = categoryOf(game);
  return categories.find((entry) => entry.id === id)?.label ?? "Other";
}

/** Server game list merged with the client bundle's artwork and copy. */
export function withClientMetadata(game: Game): Game {
  const client = getClientGameMetadata(game.gameId);
  const thumbnail = client?.thumbnail ?? game.thumbnail;
  const category = client?.category ?? game.category;
  return {
    ...game,
    description: client?.description ?? game.description,
    ...(category ? { category } : {}),
    ...(thumbnail ? { thumbnail } : {})
  };
}

export function lobbyPath(gameId: string, modeId?: string): string {
  const mode = modeId ?? getClientGameMetadata(gameId)?.modes?.[0]?.id ?? identity.mode;
  return `/game/${encodeURIComponent(gameId)}/${encodeURIComponent(mode)}`;
}

export function playerRangeLabel(game: Pick<Game, "minPlayers" | "maxPlayers">): string {
  if (game.minPlayers === game.maxPlayers) return game.maxPlayers === 1 ? "1 player" : `${game.maxPlayers} players`;
  return `${game.minPlayers}–${game.maxPlayers} players`;
}

const RECENT_KEY = "bighouse.recentGames";
const RECENT_LIMIT = 6;

export function recentGameIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecentGame(gameId: string): void {
  try {
    const next = [gameId, ...recentGameIds().filter((entry) => entry !== gameId)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private windows; the shelf is optional.
  }
}

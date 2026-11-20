import { identity, requirePlayerId } from "./identity";
import type { Game, RoomIndex, RoomJoinResponse } from "./types";

/** Turn an error body like `{ error: { code, message } }` into a readable Error. */
function apiError(data: unknown, status: number): Error {
  const error = (data as { error?: { message?: unknown } | string } | null)?.error;
  const message = typeof error === "string" ? error : error?.message;
  return new Error(typeof message === "string" && message ? message : `Request failed (${status})`);
}

export async function listGames(): Promise<Game[]> {
  const res = await fetch("/games");
  const data = (await res.json()) as { games: Game[] };
  if (!res.ok) throw apiError(data, res.status);
  return data.games;
}

export async function listLobbyRooms(gameId: string, mode: string): Promise<RoomIndex[]> {
  const res = await fetch(`/games/${encodeURIComponent(gameId)}/lobbies/${encodeURIComponent(mode)}/rooms`);
  const data = (await res.json()) as { rooms: RoomIndex[] };
  if (!res.ok) throw apiError(data, res.status);
  return data.rooms;
}

export async function createLobbyRoom(gameId: string, mode: string, options: { minPlayers?: number; maxPlayers?: number; config?: Record<string, unknown> } = {}): Promise<RoomJoinResponse> {
  requirePlayerId();
  const res = await fetch(`/games/${encodeURIComponent(gameId)}/lobbies/${encodeURIComponent(mode)}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: identity.playerId, displayName: identity.displayName || undefined, ...options })
  });
  const data = (await res.json()) as RoomJoinResponse;
  if (!res.ok) throw apiError(data, res.status);
  return data;
}

/** Quick play: joins a room with a free seat, or opens a new one when none is waiting. */
export async function quickJoinLobby(gameId: string, mode: string, options: { minPlayers?: number; maxPlayers?: number; config?: Record<string, unknown> } = {}): Promise<RoomJoinResponse> {
  requirePlayerId();
  const res = await fetch(`/games/${encodeURIComponent(gameId)}/lobbies/${encodeURIComponent(mode)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: identity.playerId, displayName: identity.displayName || undefined, ...options })
  });
  const data = (await res.json()) as RoomJoinResponse;
  if (!res.ok) throw apiError(data, res.status);
  return data;
}

export async function joinRoom(roomId: string): Promise<RoomJoinResponse> {
  requirePlayerId();
  const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: identity.playerId, displayName: identity.displayName || undefined })
  });
  const data = (await res.json()) as RoomJoinResponse;
  if (!res.ok) throw apiError(data, res.status);
  return data;
}

export function lobbyWebsocketUrl(gameId: string, mode: string): string {
  requirePlayerId();
  const url = new URL(`/games/${gameId}/lobbies/${mode}/ws`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", identity.playerId);
  if (identity.displayName) url.searchParams.set("displayName", identity.displayName);
  return url.toString();
}

export function roomWebsocketUrl(roomId: string): string {
  requirePlayerId();
  const url = new URL(`/rooms/${roomId}/ws`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", identity.playerId);
  if (identity.displayName) url.searchParams.set("displayName", identity.displayName);
  return url.toString();
}

import { identity, persistIdentity, requirePlayerId } from "./identity";
import type { Game, RoomIndex, RoomJoinResponse } from "./types";

export async function listGames(): Promise<Game[]> {
  const res = await fetch("/games");
  const data = (await res.json()) as { games: Game[] };
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.games;
}

export async function listLobbyRooms(gameId: string, mode: string): Promise<RoomIndex[]> {
  const res = await fetch(`/games/${encodeURIComponent(gameId)}/lobbies/${encodeURIComponent(mode)}/rooms`);
  const data = (await res.json()) as { rooms: RoomIndex[] };
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.rooms;
}

export async function createLobbyRoom(gameId: string, mode: string): Promise<RoomJoinResponse> {
  requirePlayerId();
  const res = await fetch(`/games/${encodeURIComponent(gameId)}/lobbies/${encodeURIComponent(mode)}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: identity.playerId, displayName: identity.displayName || undefined })
  });
  const data = (await res.json()) as RoomJoinResponse;
  if (!res.ok) throw new Error(JSON.stringify(data));
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
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export function lobbyWebsocketUrl(gameId: string, mode: string): string {
  persistIdentity();
  const url = new URL(`/games/${gameId}/lobbies/${mode}/ws`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", identity.playerId);
  if (identity.displayName) url.searchParams.set("displayName", identity.displayName);
  return url.toString();
}

export function roomWebsocketUrl(roomId: string): string {
  persistIdentity();
  const url = new URL(`/rooms/${roomId}/ws`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", identity.playerId);
  if (identity.displayName) url.searchParams.set("displayName", identity.displayName);
  return url.toString();
}

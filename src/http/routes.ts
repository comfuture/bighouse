import { z } from "zod";
import { GameServerError, toErrorResponse } from "../core/errors";
import { lobbyDoName, matchmakerDoName, roomDoName } from "../core/ids";
import type { RoomCommandResultEnvelope } from "../do/room";
import { getGameDefinition, listGameDefinitions } from "../games/registry";
import { D1Repository } from "../storage/d1";
import type { Env } from "../types";

const joinSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  minPlayers: z.number().int().positive().optional(),
  maxPlayers: z.number().int().positive().optional(),
  config: z.record(z.unknown()).optional()
});

const ticketSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  mode: z.string().min(1).default("default"),
  region: z.string().min(1).default("global"),
  skill: z.string().min(1).default("default")
});

type RouteMatch = {
  params: Record<string, string>;
};

type GameListItem = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  thumbnail?: {
    src: string;
    alt: string;
  };
};

type RegisteredGame = GameListItem & {
  config: Record<string, unknown>;
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    return await route(request, env);
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const repo = new D1Repository(env.DB);

  if (request.method === "GET" && url.pathname === "/games") {
    const games = listRegisteredGames();
    return Response.json({ games });
  }

  const lobbyJoin = matchPath(url.pathname, /^\/games\/([^/]+)\/lobbies\/([^/]+)\/join$/u, [
    "gameId",
    "mode"
  ]);
  if (request.method === "POST" && lobbyJoin) {
    const body = joinSchema.parse(await request.json());
    const gameId = routeParam(lobbyJoin, "gameId");
    const mode = routeParam(lobbyJoin, "mode");
    const game = requireGame(gameId);
    const lobby = env.LOBBY_DO.getByName(lobbyDoName(game.gameId, mode));
    const result = await lobby.join({
      gameId: game.gameId,
      mode,
      playerId: body.playerId,
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.minPlayers ? { minPlayers: body.minPlayers } : {}),
      ...(body.maxPlayers ? { maxPlayers: body.maxPlayers } : {}),
      config: body.config ?? game.config
    });
    return Response.json({
      ...result,
      lobbyWsUrl: lobbyWebsocketUrl(url, game.gameId, mode, body.playerId, body.displayName),
      wsUrl: websocketUrl(url, result.roomId, body.playerId)
    });
  }

  const lobbyRooms = matchPath(url.pathname, /^\/games\/([^/]+)\/lobbies\/([^/]+)\/rooms$/u, [
    "gameId",
    "mode"
  ]);
  if (request.method === "GET" && lobbyRooms) {
    const game = requireGame(routeParam(lobbyRooms, "gameId"));
    const mode = routeParam(lobbyRooms, "mode");
    const rooms = await repo.listLobbyRooms(game.gameId, mode);
    return Response.json({ rooms });
  }

  if (request.method === "POST" && lobbyRooms) {
    const body = joinSchema.parse(await request.json());
    const game = requireGame(routeParam(lobbyRooms, "gameId"));
    const mode = routeParam(lobbyRooms, "mode");
    const lobby = env.LOBBY_DO.getByName(lobbyDoName(game.gameId, mode));
    const result = await lobby.createRoom({
      gameId: game.gameId,
      mode,
      playerId: body.playerId,
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.minPlayers ? { minPlayers: body.minPlayers } : {}),
      ...(body.maxPlayers ? { maxPlayers: body.maxPlayers } : {}),
      config: body.config ?? game.config
    });
    return Response.json({
      ...result,
      lobbyWsUrl: lobbyWebsocketUrl(url, game.gameId, mode, body.playerId, body.displayName),
      wsUrl: websocketUrl(url, result.roomId, body.playerId)
    });
  }

  const lobbyWsPath = matchPath(url.pathname, /^\/games\/([^/]+)\/lobbies\/([^/]+)\/ws$/u, [
    "gameId",
    "mode"
  ]);
  if (request.method === "GET" && lobbyWsPath) {
    const game = requireGame(routeParam(lobbyWsPath, "gameId"));
    const mode = routeParam(lobbyWsPath, "mode");
    return env.LOBBY_DO.getByName(lobbyDoName(game.gameId, mode)).fetch(request);
  }

  const ticketCreate = matchPath(url.pathname, /^\/games\/([^/]+)\/matchmaking\/tickets$/u, ["gameId"]);
  if (request.method === "POST" && ticketCreate) {
    const body = ticketSchema.parse(await request.json());
    const game = requireGame(routeParam(ticketCreate, "gameId"));
    const matchmaker = env.MATCHMAKER_DO.getByName(
      matchmakerDoName(game.gameId, body.mode, body.region, body.skill)
    );
    const result = await matchmaker.enqueue({
      gameId: game.gameId,
      mode: body.mode,
      playerId: body.playerId,
      ...(body.displayName ? { displayName: body.displayName } : {}),
      region: body.region,
      skill: body.skill
    });
    return Response.json(
      {
        ...result,
        ...(result.matchedRoomId ? { wsUrl: websocketUrl(url, result.matchedRoomId, body.playerId) } : {})
      },
      { status: result.matchedRoomId ? 201 : 202 }
    );
  }

  const ticketCancel = matchPath(url.pathname, /^\/matchmaking\/tickets\/([^/]+)$/u, ["ticketId"]);
  if (request.method === "GET" && ticketCancel) {
    const ticket = await repo.getTicket(routeParam(ticketCancel, "ticketId"));
    if (!ticket) {
      throw new GameServerError("bad_request", "Ticket not found", 404);
    }
    return Response.json({
      ticket,
      ...(ticket.matchedRoomId ? { wsUrl: websocketUrl(url, ticket.matchedRoomId, ticket.playerId) } : {})
    });
  }

  if (request.method === "DELETE" && ticketCancel) {
    const ticket = await repo.getTicket(routeParam(ticketCancel, "ticketId"));
    if (!ticket) {
      throw new GameServerError("bad_request", "Ticket not found", 404);
    }
    const matchmaker = env.MATCHMAKER_DO.getByName(
      matchmakerDoName(ticket.gameId, ticket.mode, ticket.region ?? "global", ticket.skill ?? "default")
    );
    const cancelled = await matchmaker.cancel(ticket.ticketId);
    return Response.json({ cancelled });
  }

  const roomPath = matchPath(url.pathname, /^\/rooms\/([^/]+)$/u, ["roomId"]);
  if (request.method === "GET" && roomPath) {
    const roomId = routeParam(roomPath, "roomId");
    const indexed = await repo.getRoom(roomId);
    const doName = indexed?.doName ?? roomDoName(roomId);
    const room = env.ROOM_DO.getByName(doName);
    const summary = await room.getSummary();
    return Response.json({ room: indexed, summary });
  }

  const roomJoinPath = matchPath(url.pathname, /^\/rooms\/([^/]+)\/join$/u, ["roomId"]);
  if (request.method === "POST" && roomJoinPath) {
    const body = joinSchema.pick({ playerId: true, displayName: true }).parse(await request.json());
    const roomId = routeParam(roomJoinPath, "roomId");
    const indexed = await repo.getRoom(roomId);
    if (!indexed) {
      throw new GameServerError("room_not_found", "Room not found", 404);
    }
    if (indexed.status === "closed") {
      throw new GameServerError("room_closed", "Room is closed", 410);
    }
    const room = env.ROOM_DO.getByName(indexed.doName);
    const result = (await room.tryJoin({
      playerId: body.playerId,
      ...(body.displayName ? { displayName: body.displayName } : {})
    })) as RoomCommandResultEnvelope;
    if (result.ok === false) {
      return Response.json({ error: result.error }, { status: result.error.status });
    }
    return Response.json({
      roomId,
      doName: indexed.doName,
      summary: result.summary,
      wsUrl: websocketUrl(url, roomId, body.playerId)
    });
  }

  const roomWsPath = matchPath(url.pathname, /^\/rooms\/([^/]+)\/ws$/u, ["roomId"]);
  if (request.method === "GET" && roomWsPath) {
    const roomId = routeParam(roomWsPath, "roomId");
    const indexed = await repo.getRoom(roomId);
    if (indexed?.status === "closed") {
      throw new GameServerError("room_closed", "Room is closed", 410);
    }
    const doName = indexed?.doName ?? roomDoName(roomId);
    return env.ROOM_DO.getByName(doName).fetch(request);
  }

  return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
}

function routeParam(match: RouteMatch, name: string): string {
  const value = match.params[name];
  if (!value) {
    throw new GameServerError("bad_request", `Missing route parameter '${name}'`, 400);
  }
  return value;
}

function requireGame(gameId: string): RegisteredGame {
  const definition = getGameDefinition(gameId);
  const metadata = definition.metadata;
  return {
    gameId: metadata.gameId,
    adapterKey: metadata.adapterKey,
    displayName: metadata.displayName,
    description: metadata.description,
    minPlayers: metadata.minPlayers,
    maxPlayers: metadata.maxPlayers,
    ...(metadata.thumbnail ? { thumbnail: metadata.thumbnail } : {}),
    config: structuredClone(metadata.config ?? {})
  };
}

function listRegisteredGames(): GameListItem[] {
  return listGameDefinitions()
    .map((definition) => {
      const metadata = definition.metadata;
      return {
        gameId: metadata.gameId,
        adapterKey: metadata.adapterKey,
        displayName: metadata.displayName,
        description: metadata.description,
        minPlayers: metadata.minPlayers,
        maxPlayers: metadata.maxPlayers,
        ...(metadata.thumbnail ? { thumbnail: metadata.thumbnail } : {})
      };
    });
}

function websocketUrl(url: URL, roomId: string, playerId: string): string {
  const wsUrl = new URL(`/rooms/${roomId}/ws`, url);
  wsUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("playerId", playerId);
  return wsUrl.toString();
}

function lobbyWebsocketUrl(url: URL, gameId: string, mode: string, playerId: string, displayName?: string): string {
  const wsUrl = new URL(`/games/${gameId}/lobbies/${mode}/ws`, url);
  wsUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("playerId", playerId);
  if (displayName) {
    wsUrl.searchParams.set("displayName", displayName);
  }
  return wsUrl.toString();
}

function matchPath(pathname: string, pattern: RegExp, names: string[]): RouteMatch | null {
  const match = pathname.match(pattern);
  if (!match) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const value = match[index + 1];
    if (!value) {
      return null;
    }
    params[name] = decodeURIComponent(value);
  }
  return { params };
}

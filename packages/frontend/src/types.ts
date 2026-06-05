export type Game = {
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

export type Player = {
  playerId: string;
  displayName?: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
};

export type RoomIndex = {
  roomId: string;
  gameId: string;
  mode: string;
  status: "open" | "matching" | "active" | "closed";
  playerCount: number;
  minPlayers: number;
  maxPlayers: number;
};

export type RoomSnapshot = {
  roomId: string;
  gameId: string;
  mode: string;
  phase: "waiting" | "active" | "finished" | "closed";
  version: number;
  minPlayers: number;
  maxPlayers: number;
  hostPlayerId?: string;
  rematchRequests: string[];
  activeInterruption?: {
    reason: "player_left";
    playerId: string;
    displayName?: string;
    hostPlayerId: string;
    createdAt: number;
  };
  players: Player[];
  publicView: Record<string, unknown>;
  privateView: Record<string, unknown>;
};

export type ChatMessage = {
  scope: "lobby" | "room";
  visibility: "public" | "private";
  playerId: string;
  displayName?: string;
  targetPlayerId?: string;
  body: string;
  createdAt: number;
};

export type ServerMessage = {
  type: string;
  roomId: string;
  version: number;
  serverTime: number;
  payload: Record<string, unknown>;
};

export type RoomJoinResponse = {
  roomId: string;
  doName?: string;
  lobbyWsUrl?: string;
  wsUrl: string;
  summary: {
    phase: RoomSnapshot["phase"];
    version: number;
    playerCount: number;
    readyCount: number;
    hostPlayerId?: string;
  };
};

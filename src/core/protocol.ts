import type { ChatMessage } from "./chat";
import type { GameEvent, JsonObject, PlayerSeat, RoomInterruption, RoomPhase } from "./game";

export type ClientMessage =
  | {
      type: "hello";
      playerId: string;
      displayName?: string;
      sessionToken?: string;
    }
  | {
      type: "joinRoom";
      playerId: string;
      displayName?: string;
    }
  | {
      type: "leaveRoom";
      playerId: string;
    }
  | {
      type: "ready";
      playerId: string;
      ready: boolean;
    }
  | {
      type: "startGame";
      playerId: string;
    }
  | {
      type: "restartGame";
      playerId: string;
    }
  | {
      type: "playAgain";
      playerId: string;
    }
  | {
      type: "leaveFinishedGame";
      playerId: string;
    }
  | {
      type: "transferHost";
      playerId: string;
      targetPlayerId: string;
    }
  | {
      type: "action";
      playerId: string;
      clientActionId: string;
      expectedVersion: number;
      action: {
        type: string;
        payload: JsonObject;
      };
    }
  | {
      type: "chat";
      playerId: string;
      body: string;
      targetPlayerId?: string;
    }
  | {
      type: "ping";
      nonce?: string;
    };

export type SnapshotPayload = {
  roomId: string;
  gameId: string;
  mode: string;
  phase: RoomPhase;
  version: number;
  minPlayers: number;
  maxPlayers: number;
  hostPlayerId?: string;
  rematchRequests: string[];
  activeInterruption?: RoomInterruption;
  players: PlayerSeat[];
  publicView: JsonObject;
  privateView: JsonObject;
};

export type ServerMessage =
  | BaseServerMessage<"snapshot", SnapshotPayload>
  | BaseServerMessage<"event", { event: GameEvent }>
  | BaseServerMessage<"privateEvent", { event: GameEvent }>
  | BaseServerMessage<"ack", { command: string; clientActionId?: string; result?: JsonObject }>
  | BaseServerMessage<"chat", { message: ChatMessage }>
  | BaseServerMessage<"error", { code: string; message: string; details?: unknown }>
  | BaseServerMessage<"presence", { playerId: string; connected: boolean }>
  | BaseServerMessage<"roomClosed", { reason: string }>
  | BaseServerMessage<"pong", { nonce?: string }>;

export type BaseServerMessage<TType extends string, TPayload> = {
  type: TType;
  roomId: string;
  version: number;
  serverTime: number;
  payload: TPayload;
};

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: string | ArrayBuffer): ClientMessage {
  if (typeof raw !== "string") {
    throw new Error("Only JSON string WebSocket messages are supported");
  }
  return JSON.parse(raw) as ClientMessage;
}

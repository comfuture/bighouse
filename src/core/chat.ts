import { GameServerError } from "./errors";

export type ChatScope = "lobby" | "room";
export type ChatVisibility = "public" | "private";

export type ChatMessage = {
  id: string;
  scope: ChatScope;
  scopeId: string;
  visibility: ChatVisibility;
  playerId: string;
  displayName?: string;
  targetPlayerId?: string;
  body: string;
  createdAt: number;
};

export type ChatInput = {
  playerId: string;
  body: string;
  targetPlayerId?: string;
};

const maxChatLength = 1000;

export function normalizeChatBody(body: string): string {
  const normalized = body.trim();
  if (normalized.length === 0) {
    throw new GameServerError("bad_request", "Chat body is required", 400);
  }
  if (normalized.length > maxChatLength) {
    throw new GameServerError("bad_request", `Chat body must be ${maxChatLength} characters or fewer`, 400);
  }
  return normalized;
}

import type { ServerMessage } from "./types";

export function parseServerMessage(data: unknown): ServerMessage | null {
  try {
    return JSON.parse(String(data)) as ServerMessage;
  } catch {
    return null;
  }
}

import { D1Repository } from "../storage/d1";
import type { Env } from "../types";

export const STALE_WAITING_ROOM_MS = 5 * 60 * 1000;
export const STALE_ACTIVE_ROOM_MS = 30 * 60 * 1000;
export const STALE_ROOM_SCAN_LIMIT = 100;

export type CleanupStaleRoomsOptions = {
  now?: number;
  waitingIdleMs?: number;
  activeIdleMs?: number;
  limit?: number;
};

export type CleanupStaleRoomsResult = {
  scanned: number;
  cleaned: number;
  skipped: number;
};

export async function cleanupStaleRooms(
  env: Env,
  options: CleanupStaleRoomsOptions = {}
): Promise<CleanupStaleRoomsResult> {
  const now = options.now ?? Date.now();
  const waitingIdleMs = options.waitingIdleMs ?? STALE_WAITING_ROOM_MS;
  const activeIdleMs = options.activeIdleMs ?? STALE_ACTIVE_ROOM_MS;
  const limit = options.limit ?? STALE_ROOM_SCAN_LIMIT;
  const repo = new D1Repository(env.DB);
  const cutoff = toSqlTimestamp(now - Math.min(waitingIdleMs, activeIdleMs));
  const candidates = await repo.listStaleRoomCandidates(cutoff, limit);
  let cleaned = 0;

  for (const candidate of candidates) {
    const room = env.ROOM_DO.getByName(candidate.doName);
    const result = await room.cleanupIfStale({ now, waitingIdleMs, activeIdleMs });
    if (result.cleaned) {
      cleaned += 1;
      if (result.reason === "missing_state") {
        await repo.closeRoomIndex(candidate.roomId, new Date(now).toISOString());
      }
    }
  }

  return {
    scanned: candidates.length,
    cleaned,
    skipped: candidates.length - cleaned
  };
}

function toSqlTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 19);
}

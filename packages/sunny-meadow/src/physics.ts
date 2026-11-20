import type {
  RuntimeLadder,
  RuntimeMovingPlatform,
  RuntimePlatform,
  RuntimePortal
} from "./map-schema";

export type Rect = { x: number; y: number; w: number; h: number };

export type PlatformActor = Rect & {
  vx: number;
  vy: number;
  grounded: boolean;
  standingPlatform: RuntimePlatform | RuntimeMovingPlatform | null;
};

export function aabbOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function updateMovingPlatforms(
  movingPlatforms: RuntimeMovingPlatform[],
  dt: number,
  syncedNowMs?: number
): void {
  for (const mp of movingPlatforms) {
    mp.prevX = mp.x;
    mp.prevY = mp.y;

    if (mp.waypoints.length < 2) {
      mp.dx = 0;
      mp.dy = 0;
      continue;
    }

    // Deterministic server-clock evaluation so every player on the same stage
    // sees every moving platform at the exact same pixel simultaneously.
    if (typeof syncedNowMs === "number" && Number.isFinite(syncedNowMs) && mp.speed > 0) {
      const n = mp.waypoints.length;
      const segments: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; travel: number }> = [];
      for (let i = 0; i < n - 1; i++) {
        const a = mp.waypoints[i]!;
        const b = mp.waypoints[i + 1]!;
        segments.push({ from: a, to: b, travel: Math.hypot(b.x - a.x, b.y - a.y) / mp.speed });
      }
      for (let i = n - 1; i > 0; i--) {
        const a = mp.waypoints[i]!;
        const b = mp.waypoints[i - 1]!;
        segments.push({ from: a, to: b, travel: Math.hypot(b.x - a.x, b.y - a.y) / mp.speed });
      }

      const pause = Math.max(0, mp.pauseTime);
      let cycleSec = 0;
      for (const seg of segments) cycleSec += seg.travel + pause;
      if (cycleSec > 0.001) {
        let t = (((syncedNowMs / 1000) % cycleSec) + cycleSec) % cycleSec;
        for (const seg of segments) {
          if (t <= seg.travel) {
            const frac = seg.travel > 0.0001 ? t / seg.travel : 1;
            mp.x = seg.from.x + (seg.to.x - seg.from.x) * frac;
            mp.y = seg.from.y + (seg.to.y - seg.from.y) * frac;
            break;
          }
          t -= seg.travel;
          if (t <= pause) {
            mp.x = seg.to.x;
            mp.y = seg.to.y;
            break;
          }
          t -= pause;
        }
        mp.dx = mp.x - mp.prevX;
        mp.dy = mp.y - mp.prevY;
        continue;
      }
    }

    if (mp.pauseTimer > 0) {
      mp.pauseTimer = Math.max(0, mp.pauseTimer - dt);
      mp.dx = 0;
      mp.dy = 0;
      continue;
    }

    const target = mp.waypoints[mp.nextIndex]!;
    const vx = target.x - mp.x;
    const vy = target.y - mp.y;
    const dist = Math.hypot(vx, vy);
    const step = mp.speed * dt;

    if (dist <= step || dist < 0.001) {
      mp.x = target.x;
      mp.y = target.y;
      mp.wpIndex = mp.nextIndex;
      let next = mp.wpIndex + mp.direction;
      if (next >= mp.waypoints.length || next < 0) {
        mp.direction *= -1;
        next = mp.wpIndex + mp.direction;
      }
      mp.nextIndex = Math.max(0, Math.min(mp.waypoints.length - 1, next));
      mp.pauseTimer = mp.pauseTime;
    } else {
      mp.x += (vx / dist) * step;
      mp.y += (vy / dist) * step;
    }

    mp.dx = mp.x - mp.prevX;
    mp.dy = mp.y - mp.prevY;
  }
}

export function applyMovingPlatformCarry(entity: PlatformActor): void {
  const plat = entity.standingPlatform as RuntimeMovingPlatform | null;
  if (plat && (plat.dx || plat.dy)) {
    entity.x += plat.dx;
    entity.y += plat.dy;
  }
}

/**
 * Classic platformer one-way collision:
 * - Zero hit-test with platforms while jumping upward (vy < 0).
 * - Only lands when descending (vy >= 0) and feet cross a platform's top surface.
 */
export function resolvePlatformLanding(
  entity: PlatformActor,
  prevBottom: number,
  platforms: RuntimePlatform[],
  movingPlatforms: RuntimeMovingPlatform[],
  dropThrough = false
): RuntimePlatform | RuntimeMovingPlatform | null {
  if (entity.vy < 0) {
    entity.grounded = false;
    entity.standingPlatform = null;
    return null;
  }

  const newBottom = entity.y + entity.h;
  const footLeft = entity.x + 4;
  const footRight = entity.x + entity.w - 4;
  const landingEpsilon = 8;

  let bestPlatform: RuntimePlatform | RuntimeMovingPlatform | null = null;
  let bestSurfaceY = Infinity;

  const check = (plat: RuntimePlatform | RuntimeMovingPlatform, prevTop: number) => {
    if (dropThrough && plat.oneWay) return;
    if (footRight <= plat.x || footLeft >= plat.x + plat.w) return;
    if (prevBottom <= prevTop + landingEpsilon && newBottom >= plat.y) {
      if (plat.y < bestSurfaceY) {
        bestSurfaceY = plat.y;
        bestPlatform = plat;
      }
    }
  };

  for (const p of platforms) check(p, p.y);
  for (const mp of movingPlatforms) check(mp, mp.prevY);

  if (bestPlatform) {
    entity.y = bestSurfaceY - entity.h;
    entity.vy = 0;
    entity.grounded = true;
    entity.standingPlatform = bestPlatform;
    return bestPlatform;
  }

  entity.grounded = false;
  entity.standingPlatform = null;
  return null;
}

export function findOverlappingLadder(
  entity: Rect,
  ladders: RuntimeLadder[],
  expandBottom = 8
): RuntimeLadder | null {
  const cx = entity.x + entity.w * 0.5;
  const top = entity.y + 4;
  const bottom = entity.y + entity.h + expandBottom;

  for (const l of ladders) {
    if (cx >= l.x - 6 && cx <= l.x + l.w + 6 && bottom >= l.y && top <= l.y + l.h) {
      return l;
    }
  }
  return null;
}

export function findOverlappingPortal(entity: Rect, portals: RuntimePortal[]): RuntimePortal | null {
  const cx = entity.x + entity.w * 0.5;
  const cy = entity.y + entity.h * 0.55;
  for (const pt of portals) {
    if (cx >= pt.x - 8 && cx <= pt.x + pt.w + 8 && cy >= pt.y - 6 && cy <= pt.y + pt.h + 10) {
      return pt;
    }
  }
  return null;
}

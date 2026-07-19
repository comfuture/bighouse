import {
  TERRAIN_STEP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type BattlePoint,
  type TankItemSelection,
  type TankState
} from "./types";

export type ItemStats = {
  explosionRadius: number;
  maxDamage: number;
  particleSplashRadius: number;
  maxParticleDamage: number;
};

export type ParticleSplashResult = {
  damage: number;
  fragmentHits: number;
  distance: number;
  splashRadius: number;
};

export type TrajectoryInput = {
  start: BattlePoint;
  facing: -1 | 1;
  angle: number;
  power: number;
  gravity: number;
  wind: number;
  terrain: number[];
  tanks: TankState[];
  shooterPlayerId: string;
  worldWidth?: number;
  worldHeight?: number;
  terrainStep?: number;
};

export type TrajectoryResult = {
  trajectory: BattlePoint[];
  result: "impact" | "miss";
  impact?: BattlePoint;
  directHitPlayerId?: string;
};

export function itemStats(item: TankItemSelection): ItemStats {
  if (item === "megaBlast") {
    return { explosionRadius: 68, maxDamage: 52, particleSplashRadius: 132, maxParticleDamage: 18 };
  }
  if (item === "warhead") {
    return { explosionRadius: 44, maxDamage: 82, particleSplashRadius: 106, maxParticleDamage: 24 };
  }
  return { explosionRadius: 44, maxDamage: 52, particleSplashRadius: 102, maxParticleDamage: 16 };
}

/**
 * Models deterministic terrain fragments outside the normal blast circle.
 * Callers must only use this for terrain impacts; direct hits use their own
 * mutually-exclusive damage component.
 */
export function particleSplashDamage(input: {
  impact: BattlePoint;
  target: Pick<TankState, "playerId" | "x" | "y">;
  explosionRadius: number;
  splashRadius: number;
  maxParticleDamage: number;
  seed: number;
}): ParticleSplashResult {
  const distance = Math.hypot(input.impact.x - input.target.x, input.impact.y - (input.target.y - 8));
  if (distance <= input.explosionRadius || distance >= input.splashRadius || input.maxParticleDamage <= 0) {
    return {
      damage: 0,
      fragmentHits: 0,
      distance: round(distance * 100) / 100,
      splashRadius: input.splashRadius
    };
  }

  const span = Math.max(1, input.splashRadius - input.explosionRadius);
  const proximity = clamp((input.splashRadius - distance) / span, 0, 1);
  const random = nextRandom(hashSeed(`${input.seed}:${input.target.playerId}:${round(input.impact.x * 10)}:${round(input.impact.y * 10)}`));
  const density = 0.68 + random.value * 0.32;
  const fragmentHits = Math.max(1, round(1 + proximity * 5 + random.value * 2));
  const damage = Math.max(1, round(input.maxParticleDamage * proximity * density));
  return {
    damage,
    fragmentHits,
    distance: round(distance * 100) / 100,
    splashRadius: input.splashRadius
  };
}

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextRandom(state: number): { state: number; value: number } {
  const nextState = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: nextState, value: nextState / 0x1_0000_0000 };
}

export function windFromState(state: number): { state: number; wind: number } {
  const random = nextRandom(state);
  return {
    state: random.state,
    wind: round((random.value * 24 - 12) * 10) / 10
  };
}

export function generateTerrain(seed: number, width = WORLD_WIDTH, height = WORLD_HEIGHT, step = TERRAIN_STEP): number[] {
  const count = Math.floor(width / step) + 1;
  let randomState = seed || 1;
  const phases: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const random = nextRandom(randomState);
    randomState = random.state;
    phases.push(random.value * Math.PI * 2);
  }

  let drift = 0;
  const raw = Array.from({ length: count }, (_, index) => {
    const x = index * step;
    const random = nextRandom(randomState);
    randomState = random.state;
    drift = clamp(drift + (random.value - 0.5) * 7, -24, 24);
    const y =
      height * 0.69 +
      Math.sin(x / 125 + phases[0]!) * 43 +
      Math.sin(x / 59 + phases[1]!) * 18 +
      Math.sin(x / 260 + phases[2]!) * 34 +
      Math.sin(x / 31 + phases[3]!) * 5 +
      drift;
    return clamp(y, height * 0.48, height * 0.84);
  });

  let smoothed = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    smoothed = smoothed.map((value, index, values) => {
      const previous = values[Math.max(0, index - 1)] ?? value;
      const next = values[Math.min(values.length - 1, index + 1)] ?? value;
      return previous * 0.25 + value * 0.5 + next * 0.25;
    });
  }

  return smoothed.map((value) => round(value * 10) / 10);
}

export function terrainHeightAt(terrain: number[], x: number, step = TERRAIN_STEP): number {
  if (terrain.length === 0) return WORLD_HEIGHT;
  const index = clamp(x / step, 0, terrain.length - 1);
  const left = Math.floor(index);
  const right = Math.min(terrain.length - 1, left + 1);
  const mix = index - left;
  return (terrain[left] ?? WORLD_HEIGHT) * (1 - mix) + (terrain[right] ?? WORLD_HEIGHT) * mix;
}

export function simulateTrajectory(input: TrajectoryInput): TrajectoryResult {
  const worldWidth = input.worldWidth ?? WORLD_WIDTH;
  const worldHeight = input.worldHeight ?? WORLD_HEIGHT;
  const terrainStep = input.terrainStep ?? TERRAIN_STEP;
  const radians = (input.angle * Math.PI) / 180;
  const speed = 78 + input.power * 2.52;
  const dt = 1 / 30;
  let x = input.start.x;
  let y = input.start.y;
  let velocityX = Math.cos(radians) * speed * input.facing;
  let velocityY = -Math.sin(radians) * speed;
  const trajectory: BattlePoint[] = [{ x: round(x * 100) / 100, y: round(y * 100) / 100 }];

  for (let step = 1; step <= 420; step += 1) {
    const previousX = x;
    const previousY = y;
    velocityX += input.wind * dt;
    velocityY += input.gravity * dt;
    x += velocityX * dt;
    y += velocityY * dt;

    const segmentLength = Math.hypot(x - previousX, y - previousY);
    const segmentSamples = Math.max(1, Math.ceil(segmentLength / 2));
    for (let sample = 1; sample <= segmentSamples; sample += 1) {
      const mix = sample / segmentSamples;
      const sampleX = previousX + (x - previousX) * mix;
      const sampleY = previousY + (y - previousY) * mix;
      if (sampleX < 0 || sampleX > worldWidth || sampleY > worldHeight + 60) {
        return { trajectory, result: "miss" };
      }
      if (step <= 4) continue;
      for (const tank of input.tanks) {
        if (tank.health <= 0 || (tank.playerId === input.shooterPlayerId && step < 12)) continue;
        const distance = Math.hypot(sampleX - tank.x, sampleY - (tank.y - 8));
        if (distance <= 17) {
          const impact = { x: round(sampleX * 100) / 100, y: round(sampleY * 100) / 100 };
          trajectory.push(impact);
          return { trajectory, result: "impact", impact, directHitPlayerId: tank.playerId };
        }
      }
      if (sampleY >= terrainHeightAt(input.terrain, sampleX, terrainStep)) {
        const impact = { x: round(sampleX * 100) / 100, y: round(sampleY * 100) / 100 };
        trajectory.push(impact);
        return { trajectory, result: "impact", impact };
      }
    }

    if (step % 2 === 0) {
      trajectory.push({ x: round(x * 100) / 100, y: round(y * 100) / 100 });
    }
  }

  return { trajectory, result: "miss" };
}

export function carveAndSettleTerrain(
  terrain: number[],
  impact: BattlePoint,
  radius: number,
  height = WORLD_HEIGHT,
  step = TERRAIN_STEP
): number[] {
  let next = terrain.map((surfaceY, index) => {
    const x = index * step;
    const dx = Math.abs(x - impact.x);
    if (dx >= radius) return surfaceY;
    const circleDepth = Math.sqrt(Math.max(0, radius * radius - dx * dx)) * 0.78;
    const craterFloor = impact.y + circleDepth;
    return clamp(Math.max(surfaceY, craterFloor), 0, height - 8);
  });

  for (let pass = 0; pass < 5; pass += 1) {
    const settled = [...next];
    for (let index = 1; index < next.length - 1; index += 1) {
      const left = next[index - 1] ?? next[index]!;
      const center = next[index]!;
      const right = next[index + 1] ?? center;
      const neighborAverage = (left + right) / 2;
      if (center - neighborAverage > 15) {
        settled[index] = center - Math.min(5, (center - neighborAverage - 15) * 0.22);
      } else if (neighborAverage - center > 22) {
        settled[index] = center + Math.min(3, (neighborAverage - center - 22) * 0.12);
      }
    }
    next = settled;
  }

  return next.map((value) => round(value * 10) / 10);
}

export function spawnXForSeat(seat: number): number {
  return seat === 0 ? 135 : 865;
}

export function tankFacing(tank: Pick<TankState, "seat">): -1 | 1 {
  return tank.seat === 0 ? 1 : -1;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value);
}

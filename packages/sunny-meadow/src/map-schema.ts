import {
  ITEM_CATALOG,
  MOB_CATALOG,
  PLAYER_CONFIG,
  SCHEMA_VERSION,
  THEME_CATALOG
} from "./catalogs";
import type {
  DecorationEntity,
  HazardEntity,
  HazardKind,
  ItemSpawnEntity,
  LadderEntity,
  MobSpawnEntity,
  MovingPlatformEntity,
  NormalizedStage,
  PlatformEntity,
  PlatformSurface,
  PortalEntity
} from "./types";

export const LAYER_KEYS = [
  "platforms",
  "movingPlatforms",
  "ladders",
  "portals",
  "hazards",
  "mobSpawns",
  "itemSpawns",
  "decorations"
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

export type RuntimePlatform = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  oneWay: boolean;
  surface: PlatformSurface;
};

export type RuntimeHazard = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: HazardKind;
  damageRatio: number;
  bounceVy: number;
};

export type RuntimeMovingPlatform = RuntimePlatform & {
  prevX: number;
  prevY: number;
  dx: number;
  dy: number;
  waypoints: Array<{ x: number; y: number }>;
  speed: number;
  pauseTime: number;
  wpIndex: number;
  nextIndex: number;
  pauseTimer: number;
  direction: number;
};

export type RuntimeLadder = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
};

export type RuntimePortal = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PortalEntity["kind"];
  label: string;
  color: string;
  targetPortalId: string | null;
  targetStageId?: string;
  requiredLevel?: number;
};

export type RuntimeMobSpawn = {
  id: string;
  templateId: string;
  x: number;
  y: number;
  patrolMinX: number;
  patrolMaxX: number;
  facing: number;
};

export type RuntimeItemSpawn = {
  id: string;
  templateId: string;
  x: number;
  y: number;
  bobPhase: number;
};

export type RuntimeDecoration = {
  id: string;
  kind: DecorationEntity["kind"];
  x: number;
  y: number;
  text: string;
};

export type CompiledStage = {
  meta: NormalizedStage["meta"] & { worldWidth: number; worldHeight: number };
  spawn: { x: number; y: number };
  nextStageId: string | null;
  prevStageId: string | null;
  platforms: RuntimePlatform[];
  movingPlatforms: RuntimeMovingPlatform[];
  ladders: RuntimeLadder[];
  portals: RuntimePortal[];
  portalsById: Map<string, RuntimePortal>;
  hazards: RuntimeHazard[];
  mobSpawns: RuntimeMobSpawn[];
  itemSpawns: RuntimeItemSpawn[];
  decorations: RuntimeDecoration[];
};

export function createEmptyStage(opts: {
  id: string;
  stageNumber: number;
  name: string;
  recommendedMinLevel: number;
  recommendedMaxLevel: number;
  minEntryLevel: number;
  themeId: string;
  nextStageId: string | null;
  prevStageId: string | null;
  widthTiles?: number;
  heightTiles?: number;
  tileSize?: number;
}): NormalizedStage {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: opts.id,
      stageNumber: opts.stageNumber,
      name: opts.name,
      recommendedMinLevel: opts.recommendedMinLevel,
      recommendedMaxLevel: opts.recommendedMaxLevel,
      minEntryLevel: opts.minEntryLevel,
      tileSize: opts.tileSize ?? 48,
      widthTiles: opts.widthTiles ?? 200,
      heightTiles: opts.heightTiles ?? 18,
      screenWidthTiles: 20,
      screenHeightTiles: 12,
      themeId: opts.themeId,
      bgmId: "bgm_stage1"
    },
    spawn: { x: 3, y: 15 },
    nextStageId: opts.nextStageId,
    prevStageId: opts.prevStageId,
    layers: {
      platforms: { byId: {}, allIds: [] },
      movingPlatforms: { byId: {}, allIds: [] },
      ladders: { byId: {}, allIds: [] },
      portals: { byId: {}, allIds: [] },
      hazards: { byId: {}, allIds: [] },
      mobSpawns: { byId: {}, allIds: [] },
      itemSpawns: { byId: {}, allIds: [] },
      decorations: { byId: {}, allIds: [] }
    },
    links: {
      portalPairs: []
    }
  };
}

export function upsertEntity<T extends { id: string }>(
  layer: { byId: Record<string, T>; allIds: string[] },
  entity: T
): void {
  const exists = Object.prototype.hasOwnProperty.call(layer.byId, entity.id);
  layer.byId[entity.id] = structuredClone(entity);
  if (!exists) layer.allIds.push(entity.id);
}

export function getLayerList<T extends { id: string }>(
  layer: { byId: Record<string, T>; allIds: string[] }
): T[] {
  return layer.allIds.map((id) => layer.byId[id]).filter((e): e is T => Boolean(e));
}

export function compileStageForRuntime(stage: NormalizedStage): CompiledStage {
  const ts = stage.meta.tileSize;
  const worldWidth = stage.meta.widthTiles * ts;
  const worldHeight = stage.meta.heightTiles * ts;

  const platforms: RuntimePlatform[] = getLayerList<PlatformEntity>(stage.layers.platforms).map((p) => ({
    id: p.id,
    x: p.x * ts,
    y: p.y * ts,
    w: p.w * ts,
    h: p.h * ts,
    kind: p.kind,
    oneWay: p.oneWay,
    surface: p.surface ?? "normal"
  }));

  const movingPlatforms: RuntimeMovingPlatform[] = getLayerList<MovingPlatformEntity>(
    stage.layers.movingPlatforms
  ).map((mp) => {
    const waypoints = mp.waypoints.map((w) => ({ x: w.x * ts, y: w.y * ts }));
    return {
      id: mp.id,
      x: waypoints[0]!.x,
      y: waypoints[0]!.y,
      prevX: waypoints[0]!.x,
      prevY: waypoints[0]!.y,
      dx: 0,
      dy: 0,
      w: mp.w * ts,
      h: Math.round(mp.h * ts),
      kind: mp.kind,
      oneWay: true,
      surface: "normal",
      waypoints,
      speed: mp.speed,
      pauseTime: mp.pauseTime,
      wpIndex: 0,
      nextIndex: waypoints.length > 1 ? 1 : 0,
      pauseTimer: 0,
      direction: 1
    };
  });

  const ladders: RuntimeLadder[] = getLayerList<LadderEntity>(stage.layers.ladders).map((l) => ({
    id: l.id,
    x: l.x * ts + ts * 0.15,
    y: l.y * ts,
    w: ts * 0.7,
    h: l.h * ts,
    centerX: (l.x + 0.5) * ts
  }));

  const portalTargetMap = new Map<string, string>();
  for (const link of stage.links.portalPairs) {
    portalTargetMap.set(link.fromPortalId, link.toPortalId);
    if (link.bidirectional) {
      portalTargetMap.set(link.toPortalId, link.fromPortalId);
    }
  }

  const portalsById = new Map<string, RuntimePortal>();
  const portals: RuntimePortal[] = getLayerList<PortalEntity>(stage.layers.portals).map((pt) => {
    const compiled: RuntimePortal = {
      id: pt.id,
      x: pt.x * ts,
      y: pt.y * ts,
      w: pt.w * ts,
      h: pt.h * ts,
      kind: pt.kind,
      label: pt.label,
      color: pt.color,
      targetPortalId: portalTargetMap.get(pt.id) ?? null,
      ...(pt.targetStageId ? { targetStageId: pt.targetStageId } : {}),
      ...(pt.requiredLevel !== undefined ? { requiredLevel: pt.requiredLevel } : {})
    };
    portalsById.set(compiled.id, compiled);
    return compiled;
  });

  const hazards: RuntimeHazard[] = getLayerList<HazardEntity>(stage.layers.hazards).map((hz) => ({
    id: hz.id,
    x: hz.x * ts,
    y: hz.y * ts,
    w: hz.w * ts,
    h: hz.h * ts,
    kind: hz.kind,
    damageRatio: hz.damageRatio,
    bounceVy: hz.bounceVy
  }));

  const mobSpawns: RuntimeMobSpawn[] = getLayerList<MobSpawnEntity>(stage.layers.mobSpawns).map((m) => ({
    id: m.id,
    templateId: m.templateId,
    x: m.x * ts,
    y: m.y * ts,
    patrolMinX: m.patrolMinX * ts,
    patrolMaxX: m.patrolMaxX * ts,
    facing: m.facing
  }));

  const itemSpawns: RuntimeItemSpawn[] = getLayerList<ItemSpawnEntity>(stage.layers.itemSpawns).map((it) => ({
    id: it.id,
    templateId: it.templateId,
    x: (it.x + 0.5) * ts,
    y: (it.y + 0.5) * ts,
    bobPhase: (it.x * 0.7 + it.y * 1.1) % (Math.PI * 2)
  }));

  const decorations: RuntimeDecoration[] = getLayerList<DecorationEntity>(stage.layers.decorations).map((d) => ({
    id: d.id,
    kind: d.kind,
    x: d.x * ts,
    y: d.y * ts,
    text: d.text ?? ""
  }));

  return {
    meta: { ...stage.meta, worldWidth, worldHeight },
    spawn: { x: (stage.spawn.x + 0.5) * ts, y: stage.spawn.y * ts },
    nextStageId: stage.nextStageId,
    prevStageId: stage.prevStageId,
    platforms,
    movingPlatforms,
    ladders,
    portals,
    portalsById,
    hazards,
    mobSpawns,
    itemSpawns,
    decorations
  };
}

export function validateNormalizedStage(stage: NormalizedStage): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  reachableCount: number;
  totalNodes: number;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { widthTiles, heightTiles, tileSize, themeId } = stage.meta;

  if (!THEME_CATALOG[themeId]) {
    errors.push(`Unknown themeId: ${themeId}`);
  }

  for (const key of LAYER_KEYS) {
    const layer = stage.layers[key];
    const seen = new Set<string>();
    for (const id of layer.allIds) {
      if (seen.has(id)) errors.push(`${stage.meta.id}.${key}: duplicate id ${id}`);
      seen.add(id);
      if (!layer.byId[id]) errors.push(`${stage.meta.id}.${key}: missing byId[${id}]`);
    }
    for (const id of Object.keys(layer.byId)) {
      if (!seen.has(id)) errors.push(`${stage.meta.id}.${key}: byId[${id}] missing in allIds`);
    }
  }

  const platforms = getLayerList(stage.layers.platforms);
  const moving = getLayerList(stage.layers.movingPlatforms);
  const ladders = getLayerList(stage.layers.ladders);
  const portals = getLayerList(stage.layers.portals);
  const mobs = getLayerList(stage.layers.mobSpawns);
  const items = getLayerList(stage.layers.itemSpawns);

  for (const p of platforms) {
    if (p.x < 0 || p.x + p.w > widthTiles || p.y < 0 || p.y > heightTiles) {
      errors.push(`${stage.meta.id}: platform ${p.id} out of bounds`);
    }
  }
  for (const m of mobs) {
    if (!MOB_CATALOG[m.templateId]) errors.push(`${stage.meta.id}: unknown mob template ${m.templateId}`);
  }
  for (const it of items) {
    if (!ITEM_CATALOG[it.templateId]) errors.push(`${stage.meta.id}: unknown item template ${it.templateId}`);
  }
  for (const link of stage.links.portalPairs) {
    if (!stage.layers.portals.byId[link.fromPortalId] || !stage.layers.portals.byId[link.toPortalId]) {
      errors.push(`${stage.meta.id}: broken portal link ${link.id}`);
    }
  }

  // Strict ladder top & bottom platform connectivity check:
  // Every ladder must connect cleanly to a real platform at both its top and bottom
  // so players can never climb to the top of a ladder and drop into thin air.
  for (const l of ladders) {
    const lx = l.x + 0.5;
    const topY = l.y;
    const botY = l.y + l.h;
    const margin = 0.35;
    const hasTop = platforms.some(
      (p) => Math.abs(p.y - topY) <= 0.05 && lx >= p.x + margin && lx <= p.x + p.w - margin
    );
    const hasBot = platforms.some(
      (p) => Math.abs(p.y - botY) <= 0.05 && lx >= p.x + margin && lx <= p.x + p.w - margin
    );
    if (!hasTop) {
      errors.push(`${stage.meta.id}: ladder ${l.id} top (x=${lx}, y=${topY}) is not connected to any platform`);
    }
    if (!hasBot) {
      errors.push(`${stage.meta.id}: ladder ${l.id} bottom (x=${lx}, y=${botY}) is not connected to any platform`);
    }
  }

  // Physics reachability BFS
  const v0 = Math.abs(PLAYER_CONFIG.jumpVelocity);
  const g = PLAYER_CONFIG.gravity;
  const maxHeightTiles = (v0 * v0) / (2 * g) / tileSize;
  const maxHorizTiles = (PLAYER_CONFIG.moveSpeed * ((2 * v0) / g)) / tileSize;

  const nodes = [
    ...platforms.map((p) => ({
      id: p.id,
      minX: p.x,
      maxX: p.x + p.w,
      minY: p.y,
      maxY: p.y,
      bouncy: p.surface === "bouncy"
    })),
    ...moving.map((mp) => {
      const xs = mp.waypoints.map((w) => w.x);
      const ys = mp.waypoints.map((w) => w.y);
      return {
        id: mp.id,
        minX: Math.min(...xs),
        maxX: Math.max(...xs) + mp.w,
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        bouncy: false
      };
    })
  ];

  const findSurface = (tx: number, ty: number) => {
    let best = -1;
    let bestY = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (tx >= n.minX - 0.5 && tx <= n.maxX + 0.5 && n.minY >= ty - 0.5 && n.minY <= ty + 4 && n.minY < bestY) {
        best = i;
        bestY = n.minY;
      }
    }
    return best;
  };

  const canReach = (a: (typeof nodes)[number], b: (typeof nodes)[number]) => {
    const hGap = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
    const rise = a.minY - b.maxY;
    const effectiveMaxRise = a.bouncy ? 4.4 : maxHeightTiles * 0.92;
    if (rise <= effectiveMaxRise) {
      const allowedGap =
        rise > 0
          ? maxHorizTiles * 0.85 * Math.max(0.45, 1 - (rise / (effectiveMaxRise * 1.25)) * 0.5)
          : maxHorizTiles * 0.85 + Math.min(3.5, Math.abs(rise) * 0.55);
      if (hGap <= allowedGap) return true;
    }
    for (const l of ladders) {
      const lx = l.x + 0.5;
      const aOk = lx >= a.minX - 0.6 && lx <= a.maxX + 0.6 && a.minY >= l.y - 0.5 && a.minY <= l.y + l.h + 0.8;
      const bOk = lx >= b.minX - 0.6 && lx <= b.maxX + 0.6 && b.maxY >= l.y - 0.5 && b.maxY <= l.y + l.h + 0.8;
      if (aOk && bOk) return true;
    }
    return false;
  };

  const spawnIdx = findSurface(stage.spawn.x, stage.spawn.y);
  const portalNode = new Map<string, number>();
  for (const pt of portals) {
    const idx = findSurface(pt.x + pt.w * 0.5, pt.y + pt.h);
    if (idx >= 0) portalNode.set(pt.id, idx);
  }

  const visited = new Set<number>();
  if (spawnIdx < 0) {
    errors.push(`${stage.meta.id}: spawn point has no supporting platform`);
  } else {
    visited.add(spawnIdx);
    const queue = [spawnIdx];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (let nxt = 0; nxt < nodes.length; nxt++) {
        if (!visited.has(nxt) && canReach(nodes[cur]!, nodes[nxt]!)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
      for (const link of stage.links.portalPairs) {
        const f = portalNode.get(link.fromPortalId);
        const t = portalNode.get(link.toPortalId);
        if (f === cur && t !== undefined && !visited.has(t)) {
          visited.add(t);
          queue.push(t);
        }
        if (link.bidirectional && t === cur && f !== undefined && !visited.has(f)) {
          visited.add(f);
          queue.push(f);
        }
      }
    }
    if (visited.size < nodes.length) {
      const unreach = nodes.filter((_, i) => !visited.has(i)).map((n) => n.id);
      warnings.push(`${stage.meta.id}: unreachable platforms ${unreach.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    reachableCount: visited.size,
    totalNodes: nodes.length
  };
}

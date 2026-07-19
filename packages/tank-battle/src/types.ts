export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 600;
export const TERRAIN_STEP = 8;
export const MAX_HEALTH = 100;
export const TURN_MS = 45_000;

export type TankItem = "megaBlast" | "warhead" | "scope";
export type TankItemSelection = TankItem | "none";

export type TankItems = Record<TankItem, number>;

export type BattlePoint = {
  x: number;
  y: number;
};

export type TankState = {
  playerId: string;
  displayName: string;
  seat: number;
  color: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
};

export type ShotDamage = {
  playerId: string;
  blastDamage: number;
  fallDamage: number;
  totalDamage: number;
  remainingHealth: number;
};

export type LastShot = {
  id: number;
  resolved: boolean;
  shooterPlayerId: string;
  angle: number;
  power: number;
  item: TankItemSelection;
  wind: number;
  trajectory: BattlePoint[];
  result: "impact" | "miss";
  impact?: BattlePoint;
  directHitPlayerId?: string;
  explosionRadius: number;
  maxDamage: number;
  damage: ShotDamage[];
  debrisSeed: number;
  replayDurationMs: number;
};

export type PendingShotResolution = {
  terrain: number[];
  tanks: TankState[];
  damage: ShotDamage[];
};

export type TankBattleStageState = {
  worldWidth: number;
  worldHeight: number;
  terrainStep: number;
  terrainSeed: number;
  rngState: number;
  terrain: number[];
  gravity: number;
  wind: number;
  tanks: TankState[];
  turnPhase: "aiming" | "resolving";
  currentPlayerId?: string;
  pendingNextPlayerId?: string;
  turnNumber: number;
  turnDeadline?: number;
  resolutionDeadline?: number;
  pendingResolution?: PendingShotResolution;
  winnerPlayerId?: string;
  result?: "win" | "draw";
  lastShot?: LastShot;
};

export type TankBattlePlayerState = {
  seat: number;
  color: string;
  items: TankItems;
};

export type TankBattlePlayerView = TankState & {
  itemCounts: TankItems;
};

export type TankBattlePublicView = {
  roomPhase?: "waiting" | "active" | "finished" | "closed";
  worldWidth: number;
  worldHeight: number;
  terrainStep: number;
  terrain: number[];
  gravity: number;
  wind: number;
  players: TankBattlePlayerView[];
  turnPhase: "aiming" | "resolving";
  currentPlayerId?: string;
  turnNumber: number;
  turnDeadline?: number;
  winnerPlayerId?: string;
  result?: "win" | "draw";
  lastShot?: LastShot;
  rematchRequests?: string[];
};

export type TankBattlePrivateView = TankBattlePlayerState;

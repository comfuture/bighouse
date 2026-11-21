export type MobAiKind =
  | "patrol"
  | "dash"
  | "hopper"
  | "double_hop"
  | "lunge"
  | "backstep"
  | "swoop"
  | "charge"
  | "sonic_bat"
  | "golem_stomp"
  | "elastic_slime"
  | "web_spider"
  | "griffin_dive"
  | "fire_drake"
  | "teleport_wisp"
  | "star_dragon";

export type MobTemplate = {
  id: string;
  name: string;
  spriteKey: string;
  primaryColor: string;
  level: number;
  hp: number;
  atk: number;
  exp: number;
  score: number;
  speed: number;
  width: number;
  height: number;
  drawScale: number;
  ai: MobAiKind;
  aggroRange: number;
  /** Maximum vertical distance (px) at which this mob notices players (keeps grounded mobs on their own floor) */
  aggroVerticalRange?: number;
  knockbackResist: number;
  respawnSec: number;
  flying?: boolean;
  rangedAttack?: {
    color: string;
    speed: number;
    cooldownSec: number;
    spreadCount?: number;
    slowEffect?: boolean;
  };
  dashSpeed?: number;
  lungeSpeed?: number;
  hopVelocity?: number;
  hopInterval?: number;
  hasCrown?: boolean;
  isBoss?: boolean;
  dropChance: number;
  dropItem: string;
};

export type StatusEffectKind = "stun" | "crystal_dot" | "burn" | "shock" | "slow" | "poison";

export type WeaponStatusSpec = {
  kind: StatusEffectKind;
  durationSec: number;
  /** Periodic DoT tick damage as a fraction of total ATK (for DoT statuses) */
  dotRatio?: number;
  tickIntervalSec?: number;
  /** Movement speed multiplier while afflicted (e.g. 0.6) */
  speedMult?: number;
};

export type WeaponSplashSpec = {
  /** Forward wave reach in tiles (e.g. 2.0 tiles = 96px) */
  rangeTiles: number;
  heightPx: number;
  /** Splash wave damage multiplier relative to base hit */
  damageMult: number;
  waveColor: string;
  accentColor: string;
  style: "maple_wave" | "solar_shockwave" | "dragon_flame";
};

export type WeaponSpecialEffect = {
  statuses?: WeaponStatusSpec[];
  splash?: WeaponSplashSpec;
};

export type ActiveStatusEffect = {
  kind: StatusEffectKind;
  remaining: number;
  duration: number;
  tickDamage?: number;
  tickInterval?: number;
  tickTimer?: number;
  speedMult?: number;
  sourcePlayerId?: string;
};

export type WeaponTemplate = {
  id: string;
  name: string;
  type: "melee" | "ranged";
  atk: number;
  cooldown: number;
  reach: number;
  height: number;
  knockbackX: number;
  knockbackY: number;
  critChance: number;
  critMult: number;
  slashColor: string;
  accentColor: string;
  iconIndex: number;
  sfx: string;
  projectileSpeed?: number;
  projectileRange?: number;
  pierce?: number;
  minLevel?: number;
  special?: WeaponSpecialEffect;
  description: string;
};

export type ItemCategory = "heal" | "potion" | "max_hp" | "coin" | "weapon";

export type ItemTemplate = {
  id: string;
  name: string;
  category: ItemCategory;
  healAmount?: number;
  potionCount?: number;
  maxHpBonus?: number;
  score: number;
  iconIndex: number;
  glowColor: string;
  sfx: string;
  weaponId?: string;
  respawnSec: number;
};

export type BiomeStyle =
  | "meadow"
  | "clover"
  | "forest"
  | "cliff"
  | "maple"
  | "crystal"
  | "marsh"
  | "cloud"
  | "volcano"
  | "starlight";

export type StageTheme = {
  id: string;
  name: string;
  style: BiomeStyle;
  skyGradient: [string, string, string];
  ambientOverlay?: string;
  palette: {
    outline: string;
    crustHi: string;
    crustTop: string;
    crustMid: string;
    crustShade: string;
    bodyBase: string;
    bodyDark: string;
    bodyLight: string;
    woodTop: string;
    woodMid: string;
    woodDark: string;
    accent: string;
  };
};

export type NormalizedLayer<T extends { id: string }> = {
  byId: Record<string, T>;
  allIds: string[];
};

export type PlatformSurface =
  | "normal"
  | "bouncy"
  | "ice"
  | "conveyor_right"
  | "conveyor_left"
  | "mud";

export type PlatformEntity = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  oneWay: boolean;
  kind: string;
  surface?: PlatformSurface;
};

export type HazardKind = "water" | "spikes" | "lava" | "poison";

export type HazardEntity = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: HazardKind;
  damageRatio: number;
  bounceVy: number;
};

export type MovingPlatformEntity = {
  id: string;
  w: number;
  h: number;
  waypoints: Array<{ x: number; y: number }>;
  speed: number;
  pauseTime: number;
  kind: string;
};

export type LadderEntity = {
  id: string;
  x: number;
  y: number;
  h: number;
};

export type PortalEntity = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "warp" | "next_stage" | "prev_stage" | "goal";
  label: string;
  color: string;
  targetStageId?: string;
  requiredLevel?: number;
};

export type PortalPairLink = {
  id: string;
  fromPortalId: string;
  toPortalId: string;
  bidirectional: boolean;
};

export type MobSpawnEntity = {
  id: string;
  templateId: string;
  x: number;
  y: number;
  patrolMinX: number;
  patrolMaxX: number;
  facing: number;
};

export type ItemSpawnEntity = {
  id: string;
  templateId: string;
  x: number;
  y: number;
};

export type DecorationEntity = {
  id: string;
  kind: "flower_red" | "flower_yellow" | "bush" | "sign" | "rock" | "grass_tuft";
  x: number;
  y: number;
  text?: string;
};

export type NormalizedStage = {
  schemaVersion: string;
  meta: {
    id: string;
    stageNumber: number;
    name: string;
    recommendedMinLevel: number;
    recommendedMaxLevel: number;
    minEntryLevel: number;
    tileSize: number;
    widthTiles: number;
    heightTiles: number;
    screenWidthTiles: number;
    screenHeightTiles: number;
    themeId: string;
    bgmId: string;
  };
  spawn: { x: number; y: number };
  nextStageId: string | null;
  prevStageId: string | null;
  layers: {
    platforms: NormalizedLayer<PlatformEntity>;
    movingPlatforms: NormalizedLayer<MovingPlatformEntity>;
    ladders: NormalizedLayer<LadderEntity>;
    portals: NormalizedLayer<PortalEntity>;
    hazards: NormalizedLayer<HazardEntity>;
    mobSpawns: NormalizedLayer<MobSpawnEntity>;
    itemSpawns: NormalizedLayer<ItemSpawnEntity>;
    decorations: NormalizedLayer<DecorationEntity>;
  };
  links: {
    portalPairs: PortalPairLink[];
  };
};

export type PersistedPlayerProfile = {
  level: number;
  xp: number;
  goldenHeartBonus: number;
  hp: number;
  potions: number;
  coins: number;
  score: number;
  mobsDefeated: number;
  unlockedWeapons: string[];
  equippedWeaponId: string;
  weaponSwitchSeq?: number;
  highestStageNumber: number;
  lastStageId: string;
  lastX: number;
  lastY: number;
  savedAt: number;
};

export type WorldPlayerState = {
  playerId: string;
  displayName: string;
  stageId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  animState: "idle" | "walk" | "jump" | "climb" | "attack";
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  baseAtk: number;
  goldenHeartBonus: number;
  potions: number;
  coins: number;
  score: number;
  mobsDefeated: number;
  unlockedWeapons: string[];
  equippedWeaponId: string;
  weaponSwitchSeq?: number;
  highestStageNumber: number;
  lastUpdatedAt: number;
  /** Server timestamp of last active input/combat (used to validate 10s idle HP regen). */
  lastActivityAt?: number;
  /** Server timestamp of last idle HP regen tick (rate-limits gentle regen interval). */
  lastIdleRegenAt?: number;
  /**
   * Set while the player is down and waiting to revive. A dead player takes no
   * actions and does not move. Absent on states saved before death existed.
   */
  dead?: boolean;
};

/** What a player gives up to revive. */
export type DeathPenalty = {
  lostXp: number;
  lostCoins: number;
};

export type ServerMobState = {
  id: string;
  templateId: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  inCombat: boolean;
  respawnAt: number;
  spawnProtectUntil: number;
  lastHitAt: number;
  /** Synchronized world position & kinematics (pixels), led by nearest alive player */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  facing?: number;
  stateUpdatedAt?: number;
  authorityPlayerId?: string;
  /** Active server-tracked status effects on this mob (kind -> expiresAt ms) */
  statuses?: Partial<Record<StatusEffectKind, number>>;
  /** Cooperative hunting: tracks damage dealt per playerId in the current life cycle */
  contributors?: Record<string, number>;
  /** Timestamp when mob was defeated (enables grace-window simultaneous kill credit) */
  defeatedAt?: number;
  /** Players already awarded kill XP for the current life cycle */
  rewardedPlayers?: string[];
};

export type ServerItemState = {
  id: string;
  templateId: string;
  available: boolean;
  respawnAt: number;
  /** Timestamp when item was first collected (enables grace-window simultaneous pickup) */
  collectedAt?: number;
  /** Players who already collected this item in the current respawn cycle */
  collectedBy?: string[];
};

export type ServerStageRuntime = {
  stageId: string;
  mobs: Record<string, ServerMobState>;
  items: Record<string, ServerItemState>;
};

export type SunnyMeadowWorldState = {
  stages: Record<string, ServerStageRuntime>;
  playerStageMap: Record<string, string>;
  joinCounter: number;
};

export type RemotePlayerView = {
  playerId: string;
  displayName: string;
  stageId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  animState: WorldPlayerState["animState"];
  level: number;
  hp: number;
  maxHp: number;
  equippedWeaponId: string;
  dead?: boolean;
};

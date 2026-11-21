import type {
  ItemTemplate,
  MobAiKind,
  MobTemplate,
  StageTheme,
  StatusEffectKind,
  WeaponTemplate
} from "./types";

export const SCHEMA_VERSION = "2.0.0";

export const STATUS_METADATA: Record<
  StatusEffectKind,
  { label: string; color: string; bg: string; isDot?: boolean }
> = {
  stun: { label: "기절", color: "#FFD740", bg: "rgba(93, 58, 26, 0.88)" },
  crystal_dot: { label: "수정 파편", color: "#80DEEA", bg: "rgba(13, 71, 161, 0.88)", isDot: true },
  burn: { label: "화상", color: "#FFAB40", bg: "rgba(183, 28, 28, 0.88)", isDot: true },
  shock: { label: "감전", color: "#FFFF00", bg: "rgba(69, 39, 160, 0.88)", isDot: true },
  slow: { label: "감속", color: "#E1BEE7", bg: "rgba(74, 20, 140, 0.88)" },
  poison: { label: "중독", color: "#CCFF90", bg: "rgba(51, 105, 30, 0.88)", isDot: true }
};

/** Delay (seconds) an active mob telegraphs a red '!' before launching its attack. */
export const MOB_ALERT_TELEGRAPH_SEC = 0.5;

export function isActiveMobAi(ai: MobAiKind): boolean {
  return ai !== "patrol";
}

export const VIEWPORT = {
  width: 960,
  height: 576,
  tileSize: 48,
  screenWidthTiles: 20,
  screenHeightTiles: 12
} as const;

export const PLAYER_CONFIG = {
  hitboxWidth: 28,
  hitboxHeight: 42,
  baseMaxHp: 100,
  hpPerLevel: 18,
  baseAtk: 6,
  atkPerLevel: 4,
  moveSpeed: 268,
  groundAccel: 2350,
  airAccel: 1550,
  groundFriction: 2150,
  jumpVelocity: -632,
  jumpCutMultiplier: 0.54,
  gravity: 1680,
  maxFallSpeed: 760,
  climbSpeed: 188,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  invulnDuration: 1.0,
  knockbackVx: 225,
  knockbackVy: -265,
  dropThroughDuration: 0.22,
  portalCooldown: 0.7,
  startingPotions: 2,
  potionHealRatio: 0.45,
  minPotionHeal: 55,
  /** Seconds of zero player input before gentle idle HP regeneration begins */
  idleRegenDelaySec: 10,
  /** Interval (seconds) between gentle idle HP regeneration ticks */
  idleRegenIntervalSec: 2.0,
  /** Fraction of maxHp recovered per idle tick (much smaller than apple 25% / potion 45%) */
  idleRegenRatio: 0.03,
  minIdleRegenHeal: 2
} as const;

export function computeIdleRegenAmount(maxHp: number): number {
  return Math.max(PLAYER_CONFIG.minIdleRegenHeal, Math.round(maxHp * PLAYER_CONFIG.idleRegenRatio));
}

export type IdleRegenState = {
  idleTimer: number;
  tickTimer: number;
};

/**
 * Pure idle HP regeneration state machine:
 * - Resets immediately on any player input, damage, or non-resting movement.
 * - Activates after 10 seconds of zero input when hp < maxHp.
 * - Triggers a gentle heal tick at 10s and every `idleRegenIntervalSec` thereafter, never exceeding maxHp.
 */
export function stepIdleRegen(
  state: IdleRegenState,
  input: {
    hasInput: boolean;
    isResting: boolean;
    hp: number;
    maxHp: number;
    dt: number;
  }
): IdleRegenState & { active: boolean; shouldHeal: boolean } {
  if (input.hasInput || !input.isResting) {
    return { idleTimer: 0, tickTimer: 0, active: false, shouldHeal: false };
  }

  const prevIdle = state.idleTimer;
  const nextIdle = prevIdle + input.dt;
  if (nextIdle < PLAYER_CONFIG.idleRegenDelaySec) {
    return { idleTimer: nextIdle, tickTimer: 0, active: false, shouldHeal: false };
  }

  if (input.hp >= input.maxHp) {
    return {
      idleTimer: PLAYER_CONFIG.idleRegenDelaySec,
      tickTimer: 0,
      active: false,
      shouldHeal: false
    };
  }

  // Trigger first gentle heal right when crossing the 10s idle threshold
  if (prevIdle < PLAYER_CONFIG.idleRegenDelaySec) {
    return {
      idleTimer: PLAYER_CONFIG.idleRegenDelaySec,
      tickTimer: 0,
      active: true,
      shouldHeal: true
    };
  }

  const nextTick = state.tickTimer + input.dt;
  if (nextTick >= PLAYER_CONFIG.idleRegenIntervalSec) {
    return {
      idleTimer: PLAYER_CONFIG.idleRegenDelaySec,
      tickTimer: nextTick - PLAYER_CONFIG.idleRegenIntervalSec,
      active: true,
      shouldHeal: true
    };
  }

  return {
    idleTimer: PLAYER_CONFIG.idleRegenDelaySec,
    tickTimer: nextTick,
    active: true,
    shouldHeal: false
  };
}

export const WEAPON_CATALOG: Record<string, WeaponTemplate> = {
  wooden_sword: {
    id: "wooden_sword",
    name: "나무 목검",
    type: "melee",
    atk: 12,
    cooldown: 0.33,
    reach: 58,
    height: 44,
    knockbackX: 210,
    knockbackY: -165,
    critChance: 0.12,
    critMult: 1.5,
    slashColor: "#FFE082",
    accentColor: "#A1887F",
    iconIndex: 4,
    sfx: "sfx_attack_sword",
    description: "초원 모험의 시작을 함께하는 기본 목검"
  },
  leaf_blade: {
    id: "leaf_blade",
    name: "잎사귀 검",
    type: "melee",
    atk: 20,
    cooldown: 0.25,
    reach: 68,
    height: 48,
    knockbackX: 225,
    knockbackY: -180,
    critChance: 0.2,
    critMult: 1.55,
    slashColor: "#69F0AE",
    accentColor: "#2E7D32",
    iconIndex: 5,
    sfx: "sfx_attack_sword",
    description: "빠른 연타와 높은 치명타율의 초원 검"
  },
  star_wand: {
    id: "star_wand",
    name: "별빛 지팡이",
    type: "ranged",
    atk: 28,
    cooldown: 0.35,
    reach: 48,
    height: 44,
    projectileSpeed: 560,
    projectileRange: 360,
    knockbackX: 185,
    knockbackY: -155,
    critChance: 0.18,
    critMult: 1.5,
    slashColor: "#FFF176",
    accentColor: "#AB47BC",
    iconIndex: 6,
    sfx: "sfx_attack_staff",
    description: "먼 거리의 적에게 별빛 탄환을 발사"
  },
  golden_hammer: {
    id: "golden_hammer",
    name: "황금 해머",
    type: "melee",
    atk: 42,
    cooldown: 0.44,
    reach: 76,
    height: 56,
    knockbackX: 340,
    knockbackY: -240,
    critChance: 0.2,
    critMult: 1.6,
    slashColor: "#FFD54F",
    accentColor: "#F57F17",
    iconIndex: 7,
    sfx: "sfx_attack_sword",
    special: {
      statuses: [{ kind: "stun", durationSec: 1.0 }]
    },
    description: "적중 시 대상을 1초간 기절(별 헤일로)시키는 황금 망치"
  },
  maple_greatsword: {
    id: "maple_greatsword",
    name: "단풍 대검",
    type: "melee",
    atk: 58,
    cooldown: 0.34,
    reach: 80,
    height: 54,
    knockbackX: 270,
    knockbackY: -200,
    critChance: 0.22,
    critMult: 1.6,
    slashColor: "#FF8A65",
    accentColor: "#D84315",
    iconIndex: 8,
    sfx: "sfx_attack_sword",
    special: {
      splash: {
        rangeTiles: 2.0,
        heightPx: 62,
        damageMult: 0.68,
        waveColor: "#FF7043",
        accentColor: "#FFD54F",
        style: "maple_wave"
      }
    },
    description: "전방 2칸 범위의 단풍 검기 스플래시 파동을 날리는 대검"
  },
  crystal_rod: {
    id: "crystal_rod",
    name: "수정 지팡이",
    type: "ranged",
    atk: 72,
    cooldown: 0.33,
    reach: 52,
    height: 46,
    projectileSpeed: 640,
    projectileRange: 420,
    pierce: 2,
    knockbackX: 210,
    knockbackY: -170,
    critChance: 0.22,
    critMult: 1.6,
    slashColor: "#40C4FF",
    accentColor: "#0277BD",
    iconIndex: 9,
    sfx: "sfx_attack_staff",
    special: {
      statuses: [{ kind: "crystal_dot", durationSec: 4.0, dotRatio: 0.16, tickIntervalSec: 0.8 }]
    },
    description: "적을 꿰뚫고 4초간 수정 파편 지속 피해를 입히는 지팡이"
  },
  thunder_dagger: {
    id: "thunder_dagger",
    name: "번개 단검",
    type: "melee",
    atk: 86,
    cooldown: 0.21,
    reach: 70,
    height: 48,
    knockbackX: 230,
    knockbackY: -180,
    critChance: 0.3,
    critMult: 1.65,
    slashColor: "#FFFF00",
    accentColor: "#F9A825",
    iconIndex: 10,
    sfx: "sfx_attack_sword",
    special: {
      statuses: [{ kind: "shock", durationSec: 2.4, dotRatio: 0.14, tickIntervalSec: 0.8, speedMult: 0.6 }]
    },
    description: "초고속 연타로 감전(감속 + 전기 지속 피해)을 거는 단검"
  },
  solar_hammer: {
    id: "solar_hammer",
    name: "태양 해머",
    type: "melee",
    atk: 118,
    cooldown: 0.42,
    reach: 84,
    height: 60,
    knockbackX: 370,
    knockbackY: -260,
    critChance: 0.24,
    critMult: 1.7,
    slashColor: "#FFCA28",
    accentColor: "#FF6F00",
    iconIndex: 11,
    sfx: "sfx_attack_sword",
    special: {
      statuses: [{ kind: "stun", durationSec: 1.4 }],
      splash: {
        rangeTiles: 1.6,
        heightPx: 66,
        damageMult: 0.6,
        waveColor: "#FFD740",
        accentColor: "#FF6F00",
        style: "solar_shockwave"
      }
    },
    description: "1.4초 기절과 태양 충격파 스플래시를 터뜨리는 대망치"
  },
  dragon_blade: {
    id: "dragon_blade",
    name: "용린 블레이드",
    type: "melee",
    atk: 148,
    cooldown: 0.29,
    reach: 86,
    height: 58,
    knockbackX: 300,
    knockbackY: -220,
    critChance: 0.28,
    critMult: 1.7,
    slashColor: "#FF5252",
    accentColor: "#B71C1C",
    iconIndex: 12,
    sfx: "sfx_attack_sword",
    special: {
      statuses: [{ kind: "burn", durationSec: 3.5, dotRatio: 0.18, tickIntervalSec: 0.7 }],
      splash: {
        rangeTiles: 2.2,
        heightPx: 66,
        damageMult: 0.7,
        waveColor: "#FF3D00",
        accentColor: "#FFD54F",
        style: "dragon_flame"
      }
    },
    description: "2.2칸 화염 검기 스플래시와 3.5초 화상 지속 피해를 입히는 대검"
  },
  nebula_staff: {
    id: "nebula_staff",
    name: "성운 지팡이",
    type: "ranged",
    atk: 175,
    cooldown: 0.3,
    reach: 56,
    height: 50,
    projectileSpeed: 720,
    projectileRange: 480,
    pierce: 3,
    knockbackX: 250,
    knockbackY: -200,
    critChance: 0.3,
    critMult: 1.75,
    slashColor: "#EA80FC",
    accentColor: "#6A1B9A",
    iconIndex: 13,
    sfx: "sfx_attack_staff",
    special: {
      statuses: [
        { kind: "stun", durationSec: 0.8 },
        { kind: "burn", durationSec: 4.0, dotRatio: 0.18, tickIntervalSec: 0.8 }
      ]
    },
    description: "3관통 성운탄으로 중력 기절과 4초 성운 화상을 동시에 부여"
  }
};

export const WEAPON_ORDER = [
  "wooden_sword",
  "leaf_blade",
  "star_wand",
  "golden_hammer",
  "maple_greatsword",
  "crystal_rod",
  "thunder_dagger",
  "solar_hammer",
  "dragon_blade",
  "nebula_staff"
] as const;

/**
 * 17 distinct vivid-primary-colored SD monsters across Stages 1-10.
 * Notice: Blue Rabbit, Purple Snake, and King Mushroom have been moved from
 * Stage 1 into Stages 2, 3, and 4, and Stages 2-10 progressively introduce
 * stronger monsters with increasingly distinct movement & attack patterns.
 */
export const MOB_CATALOG: Record<string, MobTemplate> = {
  // Stage 1 (Lv 1-3): welcoming tutorial curve — generous XP, gentle damage, narrow ~2-tile aggro, same-floor only
  red_mushroom: {
    id: "red_mushroom",
    name: "빨간 버섯",
    spriteKey: "red_mushroom",
    primaryColor: "#E53935",
    level: 1,
    hp: 32,
    atk: 7,
    exp: 46,
    score: 100,
    speed: 58,
    width: 36,
    height: 38,
    drawScale: 1.0,
    ai: "patrol",
    aggroRange: 96,
    aggroVerticalRange: 40,
    knockbackResist: 0.0,
    respawnSec: 9,
    dropChance: 0.28,
    dropItem: "red_apple"
  },
  yellow_hamster: {
    id: "yellow_hamster",
    name: "노란 햄스터",
    spriteKey: "yellow_hamster",
    primaryColor: "#FFB300",
    level: 2,
    hp: 44,
    atk: 9,
    exp: 64,
    score: 140,
    speed: 74,
    dashSpeed: 126,
    width: 38,
    height: 38,
    drawScale: 1.0,
    ai: "dash",
    aggroRange: 100, // ~2 tiles (96px): only approaches nearby players on the same floor
    aggroVerticalRange: 40,
    knockbackResist: 0.0,
    respawnSec: 10,
    dropChance: 0.3,
    dropItem: "red_apple"
  },
  elder_hamster: {
    id: "elder_hamster",
    name: "대장 노란 햄스터",
    spriteKey: "yellow_hamster",
    primaryColor: "#FF8F00",
    level: 3,
    hp: 92,
    atk: 13,
    exp: 115,
    score: 260,
    speed: 78,
    dashSpeed: 138,
    width: 46,
    height: 46,
    drawScale: 1.28,
    ai: "dash",
    isElite: true,
    aggroRange: 116,
    aggroVerticalRange: 44,
    knockbackResist: 0.16,
    respawnSec: 16,
    dropChance: 0.45,
    dropItem: "sweet_potion"
  },

  // Stage 2 (Lv 3-5): Blue Rabbit moved from Stage 1 + Emerald Frog (gentle early active range)
  blue_rabbit: {
    id: "blue_rabbit",
    name: "파란 토끼",
    spriteKey: "blue_rabbit",
    primaryColor: "#2266EE",
    level: 4,
    hp: 78,
    atk: 14,
    exp: 108,
    score: 200,
    speed: 86,
    hopVelocity: -375,
    hopInterval: 1.45,
    width: 36,
    height: 46,
    drawScale: 1.08,
    ai: "hopper",
    aggroRange: 112, // ~2.3 tiles, same floor only
    aggroVerticalRange: 44,
    knockbackResist: 0.06,
    respawnSec: 10,
    dropChance: 0.3,
    dropItem: "red_apple"
  },
  emerald_frog: {
    id: "emerald_frog",
    name: "초록 개구리",
    spriteKey: "emerald_frog",
    primaryColor: "#00C853",
    level: 5,
    hp: 104,
    atk: 16,
    exp: 138,
    score: 240,
    speed: 82,
    hopVelocity: -465,
    hopInterval: 1.65,
    width: 38,
    height: 38,
    drawScale: 1.04,
    ai: "double_hop",
    isElite: true,
    aggroRange: 124, // ~2.6 tiles, same floor only
    aggroVerticalRange: 44,
    knockbackResist: 0.08,
    respawnSec: 11,
    dropChance: 0.3,
    dropItem: "sweet_potion"
  },

  // Stage 3 (Lv 6-8): Purple Snake moved from Stage 1 + Orange Fox
  purple_snake: {
    id: "purple_snake",
    name: "보라 뱀",
    spriteKey: "purple_snake",
    primaryColor: "#9B27D8",
    level: 7,
    hp: 155,
    atk: 22,
    exp: 208,
    score: 300,
    speed: 98,
    lungeSpeed: 235,
    width: 40,
    height: 40,
    drawScale: 1.06,
    ai: "lunge",
    aggroRange: 152,
    aggroVerticalRange: 44,
    knockbackResist: 0.12,
    respawnSec: 11,
    dropChance: 0.32,
    dropItem: "sweet_potion"
  },
  orange_fox: {
    id: "orange_fox",
    name: "주황 여우",
    spriteKey: "orange_fox",
    primaryColor: "#FF6D00",
    level: 8,
    hp: 192,
    atk: 26,
    exp: 265,
    score: 360,
    speed: 116,
    dashSpeed: 235,
    width: 42,
    height: 42,
    drawScale: 1.08,
    ai: "backstep",
    isElite: true,
    aggroRange: 170,
    aggroVerticalRange: 44,
    knockbackResist: 0.12,
    respawnSec: 11,
    dropChance: 0.32,
    dropItem: "sweet_potion"
  },

  // Stage 4 (Lv 9-11): Sky Owl + King Mushroom moved from Stage 1
  sky_owl: {
    id: "sky_owl",
    name: "하늘 올빼미",
    spriteKey: "sky_owl",
    primaryColor: "#00B0FF",
    level: 10,
    hp: 290,
    atk: 38,
    exp: 380,
    score: 460,
    speed: 122,
    width: 42,
    height: 42,
    drawScale: 1.1,
    ai: "swoop",
    flying: true,
    aggroRange: 290,
    knockbackResist: 0.15,
    respawnSec: 12,
    dropChance: 0.32,
    dropItem: "sweet_potion"
  },
  king_mushroom: {
    id: "king_mushroom",
    name: "왕 빨간 버섯",
    spriteKey: "red_mushroom",
    primaryColor: "#D50000",
    level: 11,
    hp: 520,
    atk: 44,
    exp: 720,
    score: 900,
    speed: 74,
    hopVelocity: -410,
    hopInterval: 1.9,
    width: 56,
    height: 58,
    drawScale: 1.52,
    hasCrown: true,
    isBoss: true,
    isElite: true,
    ai: "hopper",
    aggroRange: 300,
    knockbackResist: 0.38,
    respawnSec: 20,
    dropChance: 1.0,
    dropItem: "golden_heart"
  },

  // Stage 5 (Lv 12-14): Crimson Boar
  crimson_boar: {
    id: "crimson_boar",
    name: "진홍 멧돼지",
    spriteKey: "crimson_boar",
    primaryColor: "#C62828",
    level: 13,
    hp: 460,
    atk: 52,
    exp: 680,
    score: 620,
    speed: 100,
    dashSpeed: 340,
    width: 48,
    height: 44,
    drawScale: 1.18,
    ai: "charge",
    isElite: true,
    aggroRange: 320,
    knockbackResist: 0.32,
    respawnSec: 12,
    dropChance: 0.34,
    dropItem: "sweet_potion"
  },

  // Stage 6 (Lv 15-17): Teal Bat + Cobalt Golem
  teal_bat: {
    id: "teal_bat",
    name: "청록 박쥐",
    spriteKey: "teal_bat",
    primaryColor: "#00BFA5",
    level: 16,
    hp: 620,
    atk: 62,
    exp: 1120,
    score: 780,
    speed: 132,
    width: 44,
    height: 40,
    drawScale: 1.12,
    ai: "sonic_bat",
    flying: true,
    rangedAttack: {
      color: "#64FFDA",
      speed: 310,
      cooldownSec: 2.3,
      spreadCount: 1
    },
    aggroRange: 330,
    knockbackResist: 0.16,
    respawnSec: 12,
    dropChance: 0.34,
    dropItem: "sweet_potion"
  },
  cobalt_golem: {
    id: "cobalt_golem",
    name: "코발트 골렘",
    spriteKey: "cobalt_golem",
    primaryColor: "#2962FF",
    level: 17,
    hp: 860,
    atk: 72,
    exp: 1520,
    score: 980,
    speed: 66,
    hopVelocity: -360,
    hopInterval: 2.2,
    width: 54,
    height: 56,
    drawScale: 1.36,
    ai: "golem_stomp",
    isElite: true,
    aggroRange: 280,
    knockbackResist: 0.62,
    respawnSec: 14,
    dropChance: 0.4,
    dropItem: "sweet_potion"
  },

  // Stage 7 (Lv 18-20): Lime Slime + Violet Spider
  lime_slime: {
    id: "lime_slime",
    name: "연두 슬라임",
    spriteKey: "lime_slime",
    primaryColor: "#76FF03",
    level: 19,
    hp: 980,
    atk: 80,
    exp: 2250,
    score: 1120,
    speed: 112,
    hopVelocity: -460,
    hopInterval: 0.95,
    width: 44,
    height: 42,
    drawScale: 1.14,
    ai: "elastic_slime",
    aggroRange: 290,
    knockbackResist: 0.18,
    respawnSec: 12,
    dropChance: 0.36,
    dropItem: "sweet_potion"
  },
  violet_spider: {
    id: "violet_spider",
    name: "자주 거미",
    spriteKey: "violet_spider",
    primaryColor: "#D500F9",
    level: 20,
    hp: 1180,
    atk: 90,
    exp: 2950,
    score: 1320,
    speed: 128,
    hopVelocity: -430,
    hopInterval: 1.7,
    width: 46,
    height: 42,
    drawScale: 1.16,
    ai: "web_spider",
    isElite: true,
    rangedAttack: {
      color: "#EA80FC",
      speed: 330,
      cooldownSec: 2.1,
      spreadCount: 1,
      slowEffect: true
    },
    aggroRange: 340,
    knockbackResist: 0.25,
    respawnSec: 13,
    dropChance: 0.38,
    dropItem: "sweet_potion"
  },

  // Stage 8 (Lv 21-24): Gold Griffin
  gold_griffin: {
    id: "gold_griffin",
    name: "황금 그리핀",
    spriteKey: "gold_griffin",
    primaryColor: "#FFD600",
    level: 23,
    hp: 1620,
    atk: 108,
    exp: 5200,
    score: 1750,
    speed: 140,
    width: 52,
    height: 50,
    drawScale: 1.28,
    ai: "griffin_dive",
    isElite: true,
    flying: true,
    rangedAttack: {
      color: "#FFE57F",
      speed: 360,
      cooldownSec: 2.2,
      spreadCount: 2
    },
    aggroRange: 370,
    knockbackResist: 0.34,
    respawnSec: 13,
    dropChance: 0.42,
    dropItem: "sweet_potion"
  },

  // Stage 9 (Lv 25-28): Scarlet Drake
  scarlet_drake: {
    id: "scarlet_drake",
    name: "주홍 도마뱀",
    spriteKey: "scarlet_drake",
    primaryColor: "#FF1744",
    level: 26,
    hp: 2250,
    atk: 128,
    exp: 9800,
    score: 2350,
    speed: 124,
    hopVelocity: -420,
    hopInterval: 1.9,
    width: 50,
    height: 50,
    drawScale: 1.26,
    ai: "fire_drake",
    isElite: true,
    rangedAttack: {
      color: "#FF6E40",
      speed: 370,
      cooldownSec: 2.0,
      spreadCount: 3
    },
    aggroRange: 380,
    knockbackResist: 0.4,
    respawnSec: 14,
    dropChance: 0.45,
    dropItem: "sweet_potion"
  },

  // Stage 10 (Lv 29-35): Indigo Wisp + Starlight Dragon (Final Boss)
  indigo_wisp: {
    id: "indigo_wisp",
    name: "심연 유령",
    spriteKey: "indigo_wisp",
    primaryColor: "#3D5AFE",
    level: 30,
    hp: 2950,
    atk: 148,
    exp: 19500,
    score: 3100,
    speed: 136,
    width: 46,
    height: 50,
    drawScale: 1.22,
    ai: "teleport_wisp",
    isElite: true,
    flying: true,
    rangedAttack: {
      color: "#8C9EFF",
      speed: 390,
      cooldownSec: 1.85,
      spreadCount: 2
    },
    aggroRange: 400,
    knockbackResist: 0.3,
    respawnSec: 14,
    dropChance: 0.48,
    dropItem: "sweet_potion"
  },
  starlight_dragon: {
    id: "starlight_dragon",
    name: "별빛 드래곤",
    spriteKey: "starlight_dragon",
    primaryColor: "#651FFF",
    level: 33,
    hp: 6200,
    atk: 175,
    exp: 52000,
    score: 8500,
    speed: 130,
    width: 66,
    height: 64,
    drawScale: 1.62,
    hasCrown: true,
    isBoss: true,
    isElite: true,
    ai: "star_dragon",
    flying: true,
    rangedAttack: {
      color: "#E040FB",
      speed: 410,
      cooldownSec: 1.7,
      spreadCount: 3
    },
    aggroRange: 460,
    knockbackResist: 0.65,
    respawnSec: 24,
    dropChance: 1.0,
    dropItem: "golden_heart"
  }
};

export const ITEM_CATALOG: Record<string, ItemTemplate> = {
  red_apple: {
    id: "red_apple",
    name: "빨간 사과",
    category: "heal",
    healAmount: 35,
    score: 50,
    iconIndex: 0,
    glowColor: "#FF5252",
    sfx: "sfx_item_pickup",
    respawnSec: 16
  },
  sweet_potion: {
    id: "sweet_potion",
    name: "달콤 포션",
    category: "potion",
    potionCount: 1,
    score: 80,
    iconIndex: 1,
    glowColor: "#FF4081",
    sfx: "sfx_item_pickup",
    respawnSec: 24
  },
  golden_heart: {
    id: "golden_heart",
    name: "황금 하트",
    category: "max_hp",
    maxHpBonus: 20,
    healAmount: 60,
    score: 250,
    iconIndex: 2,
    glowColor: "#FFD740",
    sfx: "sfx_potion",
    respawnSec: 60
  },
  star_coin: {
    id: "star_coin",
    name: "별 코인",
    category: "coin",
    score: 100,
    iconIndex: 3,
    glowColor: "#FFEE58",
    sfx: "sfx_item_pickup",
    respawnSec: 18
  },
  weapon_leaf_blade: {
    id: "weapon_leaf_blade",
    name: "잎사귀 검",
    category: "weapon",
    weaponId: "leaf_blade",
    score: 200,
    iconIndex: 5,
    glowColor: "#69F0AE",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_star_wand: {
    id: "weapon_star_wand",
    name: "별빛 지팡이",
    category: "weapon",
    weaponId: "star_wand",
    score: 250,
    iconIndex: 6,
    glowColor: "#EA80FC",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_golden_hammer: {
    id: "weapon_golden_hammer",
    name: "황금 해머",
    category: "weapon",
    weaponId: "golden_hammer",
    score: 300,
    iconIndex: 7,
    glowColor: "#FFD740",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_maple_greatsword: {
    id: "weapon_maple_greatsword",
    name: "단풍 대검",
    category: "weapon",
    weaponId: "maple_greatsword",
    score: 400,
    iconIndex: 8,
    glowColor: "#FF8A65",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_crystal_rod: {
    id: "weapon_crystal_rod",
    name: "수정 지팡이",
    category: "weapon",
    weaponId: "crystal_rod",
    score: 500,
    iconIndex: 9,
    glowColor: "#40C4FF",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_thunder_dagger: {
    id: "weapon_thunder_dagger",
    name: "번개 단검",
    category: "weapon",
    weaponId: "thunder_dagger",
    score: 600,
    iconIndex: 10,
    glowColor: "#FFFF00",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_solar_hammer: {
    id: "weapon_solar_hammer",
    name: "태양 해머",
    category: "weapon",
    weaponId: "solar_hammer",
    score: 750,
    iconIndex: 11,
    glowColor: "#FFCA28",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_dragon_blade: {
    id: "weapon_dragon_blade",
    name: "용린 블레이드",
    category: "weapon",
    weaponId: "dragon_blade",
    score: 900,
    iconIndex: 12,
    glowColor: "#FF5252",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  weapon_nebula_staff: {
    id: "weapon_nebula_staff",
    name: "성운 지팡이",
    category: "weapon",
    weaponId: "nebula_staff",
    score: 1200,
    iconIndex: 13,
    glowColor: "#EA80FC",
    sfx: "sfx_potion",
    respawnSec: 0
  },
  treasure_chest: {
    id: "treasure_chest",
    name: "보물 상자",
    category: "chest",
    score: 140,
    iconIndex: 0,
    glowColor: "#FFD740",
    sfx: "sfx_potion",
    respawnSec: 65
  }
};

export const THEME_CATALOG: Record<string, StageTheme> = {
  sunny_meadow: {
    id: "sunny_meadow",
    name: "햇살 초원",
    style: "meadow",
    skyGradient: ["#69C8FF", "#CBEFFF", "#FFF8DC"],
    palette: {
      outline: "#442A1A",
      crustHi: "#B2EE6C",
      crustTop: "#80D648",
      crustMid: "#54B238",
      crustShade: "#3A8A2A",
      bodyBase: "#A66E42",
      bodyDark: "#8A5630",
      bodyLight: "#BF8656",
      woodTop: "#E0A860",
      woodMid: "#BC7C3E",
      woodDark: "#8E5628",
      accent: "#FFE082"
    }
  },
  clover_hills: {
    id: "clover_hills",
    name: "토끼 언덕",
    style: "clover",
    skyGradient: ["#4FC3F7", "#B3E5FC", "#F1F8E9"],
    ambientOverlay: "rgba(185, 246, 202, 0.08)",
    palette: {
      outline: "#3B2818",
      crustHi: "#B9F6CA",
      crustTop: "#4CD97B",
      crustMid: "#2AB563",
      crustShade: "#1C8547",
      bodyBase: "#C49558",
      bodyDark: "#A0743D",
      bodyLight: "#D9B178",
      woodTop: "#F2C57C",
      woodMid: "#C99349",
      woodDark: "#96682E",
      accent: "#FFF176"
    }
  },
  serpent_woods: {
    id: "serpent_woods",
    name: "보라 뱀 숲",
    style: "forest",
    skyGradient: ["#4A5596", "#8B7BC4", "#C8E6C9"],
    ambientOverlay: "rgba(103, 58, 183, 0.16)",
    palette: {
      outline: "#27183B",
      crustHi: "#A5D6A7",
      crustTop: "#43A047",
      crustMid: "#2E7D32",
      crustShade: "#1B5E20",
      bodyBase: "#5D4B6E",
      bodyDark: "#453454",
      bodyLight: "#76618C",
      woodTop: "#9E7BB5",
      woodMid: "#73538A",
      woodDark: "#4E3461",
      accent: "#CE93D8"
    }
  },
  breezy_cliffs: {
    id: "breezy_cliffs",
    name: "바람 절벽",
    style: "cliff",
    skyGradient: ["#1E88E5", "#64B5F6", "#FFFDE7"],
    ambientOverlay: "rgba(129, 212, 250, 0.08)",
    palette: {
      outline: "#2B3847",
      crustHi: "#DCEDC8",
      crustTop: "#9CCC65",
      crustMid: "#7CB342",
      crustShade: "#558B2F",
      bodyBase: "#90A4AE",
      bodyDark: "#607D8B",
      bodyLight: "#B0BEC5",
      woodTop: "#D7B88E",
      woodMid: "#A8845B",
      woodDark: "#785B3C",
      accent: "#80D8FF"
    }
  },
  maple_canyon: {
    id: "maple_canyon",
    name: "단풍 협곡",
    style: "maple",
    skyGradient: ["#E65100", "#FF9800", "#FFE0B2"],
    ambientOverlay: "rgba(255, 112, 67, 0.16)",
    palette: {
      outline: "#4A1C0D",
      crustHi: "#FFCC80",
      crustTop: "#FF7043",
      crustMid: "#E64A19",
      crustShade: "#BF360C",
      bodyBase: "#A15538",
      bodyDark: "#7D3B23",
      bodyLight: "#C27051",
      woodTop: "#F5B06B",
      woodMid: "#C97A3B",
      woodDark: "#8F4F1F",
      accent: "#FFD54F"
    }
  },
  crystal_cavern: {
    id: "crystal_cavern",
    name: "수정 동굴",
    style: "crystal",
    skyGradient: ["#0D1B4C", "#1E3A8A", "#26C6DA"],
    ambientOverlay: "rgba(13, 71, 161, 0.24)",
    palette: {
      outline: "#101B38",
      crustHi: "#B2EBF2",
      crustTop: "#4DD0E1",
      crustMid: "#00ACC1",
      crustShade: "#00838F",
      bodyBase: "#3F5175",
      bodyDark: "#2B3957",
      bodyLight: "#5B6F99",
      woodTop: "#81D4FA",
      woodMid: "#29B6F6",
      woodDark: "#0277BD",
      accent: "#84FFFF"
    }
  },
  twilight_marsh: {
    id: "twilight_marsh",
    name: "황혼 습지",
    style: "marsh",
    skyGradient: ["#311B5C", "#7B1FA2", "#F48FB1"],
    ambientOverlay: "rgba(106, 27, 154, 0.20)",
    palette: {
      outline: "#241236",
      crustHi: "#CCFF90",
      crustTop: "#7CB342",
      crustMid: "#558B2F",
      crustShade: "#33691E",
      bodyBase: "#4E3A59",
      bodyDark: "#372640",
      bodyLight: "#6B5278",
      woodTop: "#8E6B9E",
      woodMid: "#654773",
      woodDark: "#432C4E",
      accent: "#B9F6CA"
    }
  },
  cloud_sanctuary: {
    id: "cloud_sanctuary",
    name: "구름 신전",
    style: "cloud",
    skyGradient: ["#1976D2", "#90CAF9", "#FFFDE7"],
    ambientOverlay: "rgba(255, 245, 157, 0.12)",
    palette: {
      outline: "#5D4524",
      crustHi: "#FFFDF5",
      crustTop: "#FFE082",
      crustMid: "#FFCA28",
      crustShade: "#F59E0B",
      bodyBase: "#F3EDE0",
      bodyDark: "#D6CCB8",
      bodyLight: "#FFFFFF",
      woodTop: "#FFE57F",
      woodMid: "#FFB300",
      woodDark: "#C67C00",
      accent: "#FFF59D"
    }
  },
  ember_ridge: {
    id: "ember_ridge",
    name: "화산 능선",
    style: "volcano",
    skyGradient: ["#2A0805", "#9A220A", "#FF7043"],
    ambientOverlay: "rgba(216, 67, 21, 0.22)",
    palette: {
      outline: "#1F0A07",
      crustHi: "#FFAB91",
      crustTop: "#FF5722",
      crustMid: "#C62828",
      crustShade: "#7F0000",
      bodyBase: "#4A3A3A",
      bodyDark: "#2E2222",
      bodyLight: "#695252",
      woodTop: "#FF8A65",
      woodMid: "#8D3B2A",
      woodDark: "#541E14",
      accent: "#FFAB40"
    }
  },
  starlight_summit: {
    id: "starlight_summit",
    name: "별빛 정상",
    style: "starlight",
    skyGradient: ["#080B24", "#241468", "#6A1B9A"],
    ambientOverlay: "rgba(69, 39, 160, 0.22)",
    palette: {
      outline: "#170C36",
      crustHi: "#FFF59D",
      crustTop: "#CE93D8",
      crustMid: "#8E24AA",
      crustShade: "#4A148C",
      bodyBase: "#2C2854",
      bodyDark: "#1C183B",
      bodyLight: "#433E7A",
      woodTop: "#FFD54F",
      woodMid: "#AB47BC",
      woodDark: "#6A1B9A",
      accent: "#FFD740"
    }
  }
};

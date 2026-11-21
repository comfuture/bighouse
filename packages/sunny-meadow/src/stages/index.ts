/**
 * All 10 Normalized Multi-Biome Expanding Stages (Stages 1..10) for Sunny Meadow Adventure.
 *
 * - Screen count expands progressively from 10 screens (200 tiles) in Stage 1
 *   up to 20 screens (400 tiles) in Stage 10 so higher-level players have rich,
 *   expansive hunting grounds matching the exponential XP curve.
 * - Vertical height varies per stage (18 to 30 tiles) with towering multi-story
 *   vertical climbs on cliffs, caverns, sky sanctuaries, and the starlight summit.
 * - Each stage uses a unique biome visual theme, distinct combinations of special
 *   terrain surfaces (bouncy, ice, conveyor, mud) and environmental hazards
 *   (water, spikes, lava, poison) that damage and launch players back up.
 * - Every stage includes a completely isolated portal chamber accessible only via
 *   bidirectional warp portals, packed with bonus monsters and rewards.
 */

import { MOB_CATALOG } from "../catalogs";
import { createEmptyStage, upsertEntity } from "../map-schema";
import type {
  DecorationEntity,
  HazardKind,
  NormalizedStage,
  PlatformSurface
} from "../types";

type ZoneKind =
  | "spawn"
  | "water_brook"
  | "bouncy_valley"
  | "ladder_canopy"
  | "cliff_tower"
  | "ice_skating"
  | "conveyor_gauntlet"
  | "mud_swamp"
  | "lava_canyon"
  | "hunting_arena"
  | "portal_hub"
  | "boss_arena"
  | "summit_exit";

type StageBlueprint = {
  stageNumber: number;
  id: string;
  name: string;
  themeId: string;
  screenCount: number;
  heightTiles: number;
  recommendedMinLevel: number;
  recommendedMaxLevel: number;
  minEntryLevel: number;
  primaryHazard: HazardKind;
  secondaryHazard: HazardKind;
  primarySurface: PlatformSurface;
  chamberName: string;
  chamberColor: string;
  chamberSurface: PlatformSurface;
  mobs: {
    primary: string;
    secondary: string;
    elite?: string;
    boss?: string;
  };
  weaponPickup?: {
    itemId: string;
    label: string;
    inChamber?: boolean;
  };
  signIntro: string;
  signPortal: string;
  signClimax: string;
  /** Main course zones (length === screenCount - 1); final screen is the isolated portal chamber */
  zones: ZoneKind[];
};

const HAZARD_DEFAULTS: Record<HazardKind, { damageRatio: number; bounceVy: number }> = {
  water: { damageRatio: 0.1, bounceVy: -610 },
  spikes: { damageRatio: 0.14, bounceVy: -580 },
  poison: { damageRatio: 0.13, bounceVy: -570 },
  lava: { damageRatio: 0.18, bounceVy: -660 }
};

const BLUEPRINTS: StageBlueprint[] = [
  {
    stageNumber: 1,
    id: "stage-1",
    name: "스테이지 1 · 햇살 초원 입구",
    themeId: "sunny_meadow",
    screenCount: 10,
    heightTiles: 18,
    recommendedMinLevel: 1,
    recommendedMaxLevel: 3,
    minEntryLevel: 1,
    primaryHazard: "water",
    secondaryHazard: "water",
    primarySurface: "normal",
    chamberName: "비밀 하늘 정원",
    chamberColor: "#40C4FF",
    chamberSurface: "bouncy",
    mobs: { primary: "red_mushroom", secondary: "yellow_hamster" },
    weaponPickup: { itemId: "weapon_leaf_blade", label: "잎사귀 검" },
    signIntro: "이동: ←→  점프: Space  공격: X  사다리·포털: ↑  포션: F  (시냇물에 빠지면 튕겨 올라와요!)",
    signPortal: "포털(↑)로 격리된 '비밀 하늘 정원'에 들어가 황금 하트와 보너스 몹을 만나보세요!",
    signClimax: "Lv.3 이상이면 스테이지 2 토끼 언덕길로 넘어가 경험치를 이어가세요!",
    zones: [
      "spawn",
      "water_brook",
      "ladder_canopy",
      "portal_hub",
      "bouncy_valley",
      "hunting_arena",
      "water_brook",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 2,
    id: "stage-2",
    name: "스테이지 2 · 토끼 언덕길",
    themeId: "clover_hills",
    screenCount: 11,
    heightTiles: 20,
    recommendedMinLevel: 3,
    recommendedMaxLevel: 5,
    minEntryLevel: 2,
    primaryHazard: "water",
    secondaryHazard: "spikes",
    primarySurface: "bouncy",
    chamberName: "클로버 비밀 굴",
    chamberColor: "#69F0AE",
    chamberSurface: "bouncy",
    mobs: { primary: "yellow_hamster", secondary: "blue_rabbit", elite: "emerald_frog" },
    signIntro: "탄성 버섯 발판에서 높이 뛰어올라 파란 토끼와 초록 개구리를 공략하세요!",
    signPortal: "클로버 비밀 굴 포털(↑) 안에는 숨겨진 황금 하트와 토끼 무리가 있습니다.",
    signClimax: "언덕 정상 포털에서 보라 뱀 숲(스테이지 3)으로 이동할 수 있어요.",
    zones: [
      "spawn",
      "bouncy_valley",
      "water_brook",
      "hunting_arena",
      "portal_hub",
      "ladder_canopy",
      "bouncy_valley",
      "hunting_arena",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 3,
    id: "stage-3",
    name: "스테이지 3 · 보라 뱀 숲",
    themeId: "serpent_woods",
    screenCount: 12,
    heightTiles: 22,
    recommendedMinLevel: 6,
    recommendedMaxLevel: 8,
    minEntryLevel: 4,
    primaryHazard: "poison",
    secondaryHazard: "spikes",
    primarySurface: "mud",
    chamberName: "보라 뱀 성소",
    chamberColor: "#CE93D8",
    chamberSurface: "mud",
    mobs: { primary: "blue_rabbit", secondary: "purple_snake", elite: "orange_fox" },
    weaponPickup: { itemId: "weapon_star_wand", label: "별빛 지팡이", inChamber: true },
    signIntro: "진흙 발판은 이동이 느려지고 바닥 독 늪에 빠지면 피해와 함께 튕겨 오릅니다!",
    signPortal: "보라 뱀 성소 포털(↑) 깊은 곳에 원거리 무기 '별빛 지팡이'가 숨겨져 있어요!",
    signClimax: "별빛 지팡이로 멀리서 견제하며 바람 절벽(스테이지 4)으로 향하세요!",
    zones: [
      "spawn",
      "mud_swamp",
      "ladder_canopy",
      "hunting_arena",
      "mud_swamp",
      "portal_hub",
      "bouncy_valley",
      "ladder_canopy",
      "hunting_arena",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 4,
    id: "stage-4",
    name: "스테이지 4 · 바람 절벽",
    themeId: "breezy_cliffs",
    screenCount: 13,
    heightTiles: 26,
    recommendedMinLevel: 9,
    recommendedMaxLevel: 11,
    minEntryLevel: 7,
    primaryHazard: "spikes",
    secondaryHazard: "water",
    primarySurface: "conveyor_right",
    chamberName: "독수리 전망대",
    chamberColor: "#80D8FF",
    chamberSurface: "bouncy",
    mobs: { primary: "purple_snake", secondary: "sky_owl", boss: "king_mushroom" },
    weaponPickup: { itemId: "weapon_golden_hammer", label: "황금 해머" },
    signIntro: "높은 수직 절벽과 바람 컨베이어, 바닥 가시 함정을 피해 정상으로 오르세요!",
    signPortal: "독수리 전망대 포털(↑)에서 하늘 위 고공 사냥터를 경험해보세요.",
    signClimax: "절벽 결투장에 왕 빨간 버섯 출현! 점프 스톰프를 피하며 공략하세요!",
    zones: [
      "spawn",
      "cliff_tower",
      "water_brook",
      "bouncy_valley",
      "hunting_arena",
      "portal_hub",
      "ladder_canopy",
      "conveyor_gauntlet",
      "hunting_arena",
      "bouncy_valley",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 5,
    id: "stage-5",
    name: "스테이지 5 · 단풍 협곡",
    themeId: "maple_canyon",
    screenCount: 14,
    heightTiles: 22,
    recommendedMinLevel: 12,
    recommendedMaxLevel: 14,
    minEntryLevel: 10,
    primaryHazard: "lava",
    secondaryHazard: "spikes",
    primarySurface: "conveyor_right",
    chamberName: "단풍 숨은 협곡",
    chamberColor: "#FFAB40",
    chamberSurface: "conveyor_right",
    mobs: { primary: "orange_fox", secondary: "sky_owl", elite: "crimson_boar" },
    weaponPickup: { itemId: "weapon_maple_greatsword", label: "단풍 대검", inChamber: true },
    signIntro: "협곡 바닥의 뜨거운 용암에 떨어지면 큰 피해를 입고 높이 튕겨 오릅니다!",
    signPortal: "단풍 숨은 협곡 포털(↑) 안에서 강력한 '단풍 대검'을 얻을 수 있습니다!",
    signClimax: "협곡 끝 포털은 수정 동굴(스테이지 6)로 이어집니다.",
    zones: [
      "spawn",
      "lava_canyon",
      "conveyor_gauntlet",
      "hunting_arena",
      "bouncy_valley",
      "portal_hub",
      "lava_canyon",
      "ladder_canopy",
      "hunting_arena",
      "conveyor_gauntlet",
      "lava_canyon",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 6,
    id: "stage-6",
    name: "스테이지 6 · 수정 동굴",
    themeId: "crystal_cavern",
    screenCount: 15,
    heightTiles: 26,
    recommendedMinLevel: 15,
    recommendedMaxLevel: 17,
    minEntryLevel: 13,
    primaryHazard: "spikes",
    secondaryHazard: "water",
    primarySurface: "ice",
    chamberName: "수정 보물고",
    chamberColor: "#84FFFF",
    chamberSurface: "ice",
    mobs: { primary: "sky_owl", secondary: "teal_bat", elite: "cobalt_golem" },
    weaponPickup: { itemId: "weapon_crystal_rod", label: "수정 지팡이" },
    signIntro: "미끄러운 빙판 발판과 깊은 지하 수직 동굴! 수정 가시에 찔리지 않도록 주의하세요.",
    signPortal: "수정 보물고 포털(↑)에는 고밀도 동굴 몹과 황금 하트가 기다립니다.",
    signClimax: "동굴 출구 포털 너머에 황혼 습지(스테이지 7)가 기다립니다.",
    zones: [
      "spawn",
      "ice_skating",
      "cliff_tower",
      "water_brook",
      "hunting_arena",
      "ice_skating",
      "portal_hub",
      "cliff_tower",
      "hunting_arena",
      "ice_skating",
      "bouncy_valley",
      "hunting_arena",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 7,
    id: "stage-7",
    name: "스테이지 7 · 황혼 습지",
    themeId: "twilight_marsh",
    screenCount: 16,
    heightTiles: 22,
    recommendedMinLevel: 18,
    recommendedMaxLevel: 20,
    minEntryLevel: 16,
    primaryHazard: "poison",
    secondaryHazard: "spikes",
    primarySurface: "mud",
    chamberName: "황혼 마녀의 섬",
    chamberColor: "#EA80FC",
    chamberSurface: "bouncy",
    mobs: { primary: "teal_bat", secondary: "lime_slime", elite: "violet_spider" },
    weaponPickup: { itemId: "weapon_thunder_dagger", label: "번개 단검", inChamber: true },
    signIntro: "독 늪과 진흙 발판, 포자 점프대가 뒤섞인 거대한 황혼 습지입니다!",
    signPortal: "황혼 마녀의 섬 포털(↑)에서 초고속 '번개 단검'을 챙겨가세요!",
    signClimax: "습지 너머 높이 솟은 구름 신전(스테이지 8)으로 올라가세요!",
    zones: [
      "spawn",
      "mud_swamp",
      "bouncy_valley",
      "hunting_arena",
      "mud_swamp",
      "ladder_canopy",
      "portal_hub",
      "hunting_arena",
      "mud_swamp",
      "conveyor_gauntlet",
      "bouncy_valley",
      "hunting_arena",
      "mud_swamp",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 8,
    id: "stage-8",
    name: "스테이지 8 · 구름 신전",
    themeId: "cloud_sanctuary",
    screenCount: 17,
    heightTiles: 28,
    recommendedMinLevel: 21,
    recommendedMaxLevel: 24,
    minEntryLevel: 19,
    primaryHazard: "spikes",
    secondaryHazard: "water",
    primarySurface: "bouncy",
    chamberName: "천공 별궁",
    chamberColor: "#FFD740",
    chamberSurface: "ice",
    mobs: { primary: "lime_slime", secondary: "violet_spider", elite: "gold_griffin" },
    weaponPickup: { itemId: "weapon_solar_hammer", label: "태양 해머" },
    signIntro: "구름 점프대, 하늘 빙판 제단, 고공 수직 신전 탑을 넘나드는 천공 스테이지!",
    signPortal: "천공 별궁 포털(↑)에서 그리핀과 슬라임 무리를 집중 사냥하세요.",
    signClimax: "구름 너머 화산 능선(스테이지 9)으로 도전하세요!",
    zones: [
      "spawn",
      "bouncy_valley",
      "cliff_tower",
      "ice_skating",
      "conveyor_gauntlet",
      "hunting_arena",
      "portal_hub",
      "cliff_tower",
      "bouncy_valley",
      "hunting_arena",
      "ice_skating",
      "conveyor_gauntlet",
      "cliff_tower",
      "hunting_arena",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 9,
    id: "stage-9",
    name: "스테이지 9 · 화산 능선",
    themeId: "ember_ridge",
    screenCount: 18,
    heightTiles: 24,
    recommendedMinLevel: 25,
    recommendedMaxLevel: 28,
    minEntryLevel: 22,
    primaryHazard: "lava",
    secondaryHazard: "spikes",
    primarySurface: "conveyor_right",
    chamberName: "용암 심장부",
    chamberColor: "#FF5252",
    chamberSurface: "conveyor_left",
    mobs: { primary: "cobalt_golem", secondary: "gold_griffin", elite: "scarlet_drake" },
    weaponPickup: { itemId: "weapon_dragon_blade", label: "용린 블레이드", inChamber: true },
    signIntro: "끓어오르는 용암 강과 고속 컨베이어 발판! 화산 도마뱀의 3연 화염탄을 피하세요.",
    signPortal: "용암 심장부 포털(↑) 깊숙한 곳에 '용린 블레이드'가 잠들어 있습니다!",
    signClimax: "드디어 20화면 최후의 대서사, 별빛 정상(스테이지 10)이 눈앞입니다!",
    zones: [
      "spawn",
      "lava_canyon",
      "conveyor_gauntlet",
      "hunting_arena",
      "lava_canyon",
      "bouncy_valley",
      "portal_hub",
      "cliff_tower",
      "lava_canyon",
      "hunting_arena",
      "conveyor_gauntlet",
      "lava_canyon",
      "hunting_arena",
      "bouncy_valley",
      "lava_canyon",
      "boss_arena",
      "summit_exit"
    ]
  },
  {
    stageNumber: 10,
    id: "stage-10",
    name: "스테이지 10 · 별빛 정상",
    themeId: "starlight_summit",
    screenCount: 20,
    heightTiles: 30,
    recommendedMinLevel: 29,
    recommendedMaxLevel: 35,
    minEntryLevel: 26,
    primaryHazard: "lava",
    secondaryHazard: "spikes",
    primarySurface: "ice",
    chamberName: "성운 아공간",
    chamberColor: "#EA80FC",
    chamberSurface: "bouncy",
    mobs: { primary: "gold_griffin", secondary: "scarlet_drake", elite: "indigo_wisp", boss: "starlight_dragon" },
    weaponPickup: { itemId: "weapon_nebula_staff", label: "성운 지팡이", inChamber: true },
    signIntro: "20화면 × 초고층 별빛 정상! 빙판·탄성·컨베이어·용암·독 늪을 모두 돌파하세요!",
    signPortal: "성운 아공간 포털(↑)에서 궁극 무기 '성운 지팡이'와 보너스 사냥터를 만나세요!",
    signClimax: "최종 보스 별빛 드래곤을 물리치고 정상의 별빛 포털에 도달하세요!",
    zones: [
      "spawn",
      "bouncy_valley",
      "cliff_tower",
      "ice_skating",
      "lava_canyon",
      "hunting_arena",
      "conveyor_gauntlet",
      "portal_hub",
      "cliff_tower",
      "hunting_arena",
      "mud_swamp",
      "ice_skating",
      "lava_canyon",
      "hunting_arena",
      "bouncy_valley",
      "conveyor_gauntlet",
      "cliff_tower",
      "boss_arena",
      "summit_exit"
    ]
  }
];

function buildStageFromBlueprint(bp: StageBlueprint): NormalizedStage {
  const n = bp.stageNumber;
  const widthTiles = bp.screenCount * 20;
  const heightTiles = bp.heightTiles;
  const groundY = heightTiles - 3;

  const stage = createEmptyStage({
    id: bp.id,
    stageNumber: n,
    name: bp.name,
    recommendedMinLevel: bp.recommendedMinLevel,
    recommendedMaxLevel: bp.recommendedMaxLevel,
    minEntryLevel: bp.minEntryLevel,
    themeId: bp.themeId,
    nextStageId: n < 10 ? `stage-${n + 1}` : null,
    prevStageId: n > 1 ? `stage-${n - 1}` : null,
    widthTiles,
    heightTiles
  });

  stage.spawn = { x: 4, y: groundY };

  const pfx = `s${n}`;
  let seq = 0;
  const uid = (tag: string) => `${tag}_${++seq}`;

  const addPlat = (
    id: string,
    x: number,
    y: number,
    w: number,
    h = 1,
    oneWay = true,
    surface: PlatformSurface = "normal",
    kind = bp.themeId
  ) =>
    upsertEntity(stage.layers.platforms, {
      id: `${pfx}_${id}`,
      x,
      y,
      w,
      h,
      oneWay,
      kind,
      ...(surface !== "normal" ? { surface } : {})
    });

  const addMoving = (
    id: string,
    w: number,
    waypoints: Array<{ x: number; y: number }>,
    speed = 88 + n * 3,
    pauseTime = 0.42
  ) =>
    upsertEntity(stage.layers.movingPlatforms, {
      id: `${pfx}_${id}`,
      w,
      h: 0.6,
      waypoints,
      speed,
      pauseTime,
      kind: "wood_float"
    });

  const addLadder = (id: string, x: number, y: number, h: number) =>
    upsertEntity(stage.layers.ladders, { id: `${pfx}_${id}`, x, y, h });

  const addHazard = (id: string, kind: HazardKind, x: number, y: number, w: number, h = 2) => {
    const def = HAZARD_DEFAULTS[kind];
    upsertEntity(stage.layers.hazards, {
      id: `${pfx}_${id}`,
      kind,
      x,
      y,
      w,
      h,
      damageRatio: def.damageRatio,
      bounceVy: def.bounceVy
    });
  };

  const addPortal = (
    id: string,
    x: number,
    surfaceY: number,
    kind: "warp" | "next_stage" | "prev_stage" | "goal",
    label: string,
    color: string,
    extra?: { targetStageId?: string; requiredLevel?: number }
  ) =>
    upsertEntity(stage.layers.portals, {
      id: `${pfx}_${id}`,
      x,
      y: Number((surfaceY - 1.7).toFixed(2)),
      w: 1.2,
      h: 1.7,
      kind,
      label,
      color,
      ...(extra?.targetStageId ? { targetStageId: extra.targetStageId } : {}),
      ...(extra?.requiredLevel !== undefined ? { requiredLevel: extra.requiredLevel } : {})
    });

  const linkPortals = (id: string, fromId: string, toId: string) =>
    stage.links.portalPairs.push({
      id: `${pfx}_${id}`,
      fromPortalId: `${pfx}_${fromId}`,
      toPortalId: `${pfx}_${toId}`,
      bidirectional: true
    });

  const addMob = (
    id: string,
    templateId: string,
    x: number,
    surfaceY: number,
    patrolMinX: number,
    patrolMaxX: number,
    facing = -1
  ) =>
    upsertEntity(stage.layers.mobSpawns, {
      id: `${pfx}_${id}`,
      templateId,
      x,
      y: surfaceY,
      patrolMinX,
      patrolMaxX,
      facing
    });

  const addItem = (id: string, templateId: string, x: number, surfaceY: number) =>
    upsertEntity(stage.layers.itemSpawns, { id: `${pfx}_${id}`, templateId, x, y: surfaceY - 1 });

  const addDeco = (id: string, kind: DecorationEntity["kind"], x: number, surfaceY: number, text?: string) =>
    upsertEntity(stage.layers.decorations, {
      id: `${pfx}_${id}`,
      kind,
      x,
      y: surfaceY - 1,
      ...(text ? { text } : {})
    });

  const m1 = bp.mobs.primary;
  const m2 = bp.mobs.secondary;
  const m3 = bp.mobs.elite ?? bp.mobs.secondary;
  const mBoss = bp.mobs.boss ?? m3;
  // On early/mid stages, avoid placing flying mobs (e.g. sky_owl) right over moving platforms
  const mGrounded = n <= 5 && MOB_CATALOG[m2]?.flying ? m1 : m2;
  const mGroundedElite = n <= 5 && MOB_CATALOG[m3]?.flying ? m1 : m3;
  let weaponPlaced = false;

  // Build each 20-tile zone along the main course (screens 0 .. screenCount - 2)
  bp.zones.forEach((zone, zIdx) => {
    const x0 = zIdx * 20;
    const z = `z${zIdx}`;

    if (zone === "spawn") {
      // Safe starting zone; preserve s1_mob_1a & s1_it_1c1 IDs for Stage 1 compatibility
      addPlat("g1", x0, groundY, 20, 3, false);
      addPlat("p1_a", x0 + 7, groundY - 2, 5, 1, true, bp.primarySurface === "bouncy" ? "bouncy" : "normal");
      addPlat("p1_b", x0 + 13, groundY - 4, 5, 1, true);
      if (n > 1) {
        addPortal("pt_prev", x0 + 1.2, groundY, "prev_stage", `← 스테이지 ${n - 1}`, "#80DEEA", {
          targetStageId: `stage-${n - 1}`
        });
      }
      addMob("mob_1a", m1, x0 + 11, groundY, x0 + 8, x0 + 15);
      addMob("mob_1b", m1, x0 + 17, groundY, x0 + 14, x0 + 19.5);
      addItem("it_1c1", "star_coin", x0 + 8, groundY - 2);
      addItem("it_1c2", "star_coin", x0 + 10, groundY - 2);
      addItem("it_1c3", "star_coin", x0 + 14, groundY - 4);
      addItem("it_1ap", "red_apple", x0 + 16, groundY - 4);
      addDeco("dec_s1_sign", "sign", x0 + 6, groundY, bp.signIntro);
      addDeco("dec_s1_f1", "flower_red", x0 + 2.8, groundY);
      addDeco("dec_s1_b1", "bush", x0 + 9, groundY);
      return;
    }

    if (zone === "water_brook") {
      // Twin hazard brooks (water/spikes) with stepping stones & arched overpass
      const hz: HazardKind = bp.primaryHazard === "lava" ? "lava" : "water";
      addPlat(`${z}_gl`, x0, groundY, 4, 3, false);
      addHazard(`${z}_hz1`, hz, x0 + 4, groundY + 1, 5, 2);
      addPlat(`${z}_step1`, x0 + 5, groundY - 1, 3, 1, true);
      addPlat(`${z}_gm`, x0 + 9, groundY, 4, 3, false);
      addHazard(`${z}_hz2`, hz, x0 + 13, groundY + 1, 4, 2);
      addPlat(`${z}_step2`, x0 + 14, groundY - 1, 3, 1, true);
      addPlat(`${z}_gr`, x0 + 17, groundY, 3, 3, false);

      // Upper scenic bridge connected by ladder
      addPlat(`${z}_hi`, x0 + 4, groundY - 5, 11, 1, true);
      addLadder(`${z}_lad`, x0 + 10, groundY - 5, 5);

      addMob(zIdx === 1 ? "mob_2a" : uid(`${z}_m`), m1, x0 + 11, groundY, x0 + 9.3, x0 + 12.7);
      addMob(zIdx === 1 ? "mob_2b" : uid(`${z}_m`), m2, x0 + 8, groundY - 5, x0 + 4.5, x0 + 14.5);
      addMob(uid(`${z}_m`), m2, x0 + 18, groundY, x0 + 17.2, x0 + 19.7);

      addItem(uid(`${z}_i`), "star_coin", x0 + 6, groundY - 1);
      addItem(uid(`${z}_i`), "star_coin", x0 + 8, groundY - 5);
      addItem(uid(`${z}_i`), "star_coin", x0 + 12, groundY - 5);
      addItem(uid(`${z}_i`), "red_apple", x0 + 15, groundY - 1);
      addDeco(uid(`${z}_d`), "flower_yellow", x0 + 2, groundY);
      return;
    }

    if (zone === "bouncy_valley") {
      // Springy bouncy pads launching across a hazard valley to sky platforms (rise = 4 tiles!)
      const hz = bp.primaryHazard;
      addPlat(`${z}_gl`, x0, groundY, 4, 3, false);
      addHazard(`${z}_hz`, hz, x0 + 4, groundY + 1, 12, 2);
      addPlat(`${z}_b1`, x0 + 4, groundY, 3, 1, true, "bouncy");
      addPlat(`${z}_hi1`, x0 + 6, groundY - 4, 5, 1, true);
      addPlat(`${z}_b2`, x0 + 10, groundY - 4, 3, 1, true, "bouncy");
      addPlat(`${z}_hi2`, x0 + 12, groundY - 8, 6, 1, true);
      addPlat(`${z}_low_pad`, x0 + 11, groundY, 3, 1, true, "bouncy");
      addPlat(`${z}_gr`, x0 + 16, groundY, 4, 3, false);

      addMob(uid(`${z}_m`), m2, x0 + 8, groundY - 4, x0 + 6.3, x0 + 10.7);
      addMob(uid(`${z}_m`), m3, x0 + 15, groundY - 8, x0 + 12.4, x0 + 17.6);
      addMob(uid(`${z}_m`), m1, x0 + 18, groundY, x0 + 16.3, x0 + 19.7);

      addItem(uid(`${z}_i`), "star_coin", x0 + 5, groundY - 3);
      addItem(uid(`${z}_i`), "star_coin", x0 + 11, groundY - 7);
      addItem(uid(`${z}_i`), "star_coin", x0 + 14, groundY - 8);
      addItem(uid(`${z}_i`), "sweet_potion", x0 + 16, groundY - 8);
      addDeco(uid(`${z}_d`), "bush", x0 + 2, groundY);
      return;
    }

    if (zone === "ladder_canopy") {
      // 3-story vertical canopy with ladders, spike/poison pit, and dense mob tiers
      addPlat(`${z}_gl`, x0, groundY, 9, 3, false);
      addHazard(`${z}_hz`, bp.secondaryHazard, x0 + 9, groundY + 1, 4, 2);
      addPlat(`${z}_bridge`, x0 + 9, groundY - 1, 4, 1, true);
      addPlat(`${z}_gr`, x0 + 13, groundY, 7, 3, false);

      addPlat(`${z}_t1`, x0 + 2, groundY - 4, 10, 1, true);
      addPlat(`${z}_t2`, x0 + 8, groundY - 8, 10, 1, true);
      addLadder(`${z}_l1`, x0 + 4, groundY - 4, 4);
      addLadder(`${z}_l2`, x0 + 10, groundY - 8, 4);
      addLadder(`${z}_l3`, x0 + 16, groundY - 8, 8);

      addMob(uid(`${z}_m`), m1, x0 + 5, groundY, x0 + 1, x0 + 8.5);
      addMob(uid(`${z}_m`), m2, x0 + 7, groundY - 4, x0 + 2.5, x0 + 11.5);
      addMob(uid(`${z}_m`), m3, x0 + 13, groundY - 8, x0 + 8.5, x0 + 17.5);
      addMob(uid(`${z}_m`), m2, x0 + 17, groundY, x0 + 13.5, x0 + 19.5);

      addItem(uid(`${z}_i`), "star_coin", x0 + 6, groundY - 4);
      addItem(uid(`${z}_i`), "star_coin", x0 + 12, groundY - 8);
      addItem(uid(`${z}_i`), "red_apple", x0 + 15, groundY - 8);
      addDeco(uid(`${z}_d`), "rock", x0 + 18, groundY);
      return;
    }

    if (zone === "cliff_tower") {
      // Tall multi-story vertical climb exploiting heightTiles (24..30)!
      const climbFloors = Math.min(4, Math.max(2, Math.floor((groundY - 6) / 4)));
      addPlat(`${z}_g`, x0, groundY, 20, 3, false);
      // Hazard strip in middle ground with safe jump-over ledge
      addHazard(`${z}_hz`, bp.secondaryHazard, x0 + 8, groundY - 0.5, 4, 0.7);
      addPlat(`${z}_over`, x0 + 7, groundY - 2, 6, 1, true, bp.primarySurface === "ice" ? "ice" : "normal");

      for (let f = 1; f <= climbFloors; f++) {
        const fy = groundY - f * 4;
        const leftSide = f % 2 === 1;
        const px = leftSide ? x0 + 2 : x0 + 8;
        const pw = 10;
        const surf: PlatformSurface =
          f === climbFloors ? "normal" : bp.primarySurface === "bouncy" ? "bouncy" : bp.primarySurface === "ice" ? "ice" : "normal";
        addPlat(`${z}_f${f}`, px, fy, pw, 1, true, surf);
        // Ladder strictly inside the overlap of floor f-1 and floor f
        const ladX = f === 1 ? x0 + 4 : leftSide ? x0 + 9 : x0 + 10;
        addLadder(`${z}_lad${f}`, ladX, fy, 4);
        addMob(
          uid(`${z}_m`),
          f === climbFloors ? mGroundedElite : f % 2 === 0 ? mGrounded : m1,
          px + 5,
          fy,
          px + 0.5,
          px + pw - 0.5
        );
        addItem(uid(`${z}_i`), f === climbFloors ? "sweet_potion" : "star_coin", px + 3, fy);
      }

      // Express elevator on the right side descending from top to ground,
      // plus a stationary normal anchor platform at its midpoint as a safe combat perch!
      const topY = groundY - climbFloors * 4;
      const elevMidY = Math.round((groundY - 1 + topY) / 2);
      addMoving(`${z}_elev`, 3, [
        { x: x0 + 14, y: groundY - 1 },
        { x: x0 + 14, y: topY }
      ]);
      addPlat(`${z}_elev_anchor`, x0 + 17, elevMidY, 3, 1, true, "normal");
      addMob(uid(`${z}_m`), mGrounded, x0 + 3, groundY, x0 + 0.5, x0 + 7);
      addItem(uid(`${z}_i`), "star_coin", x0 + 15, topY);
      return;
    }

    if (zone === "ice_skating") {
      // Slippery ice shelves over spike/water trenches
      addPlat(`${z}_gl`, x0, groundY, 4, 3, false, "ice");
      addHazard(`${z}_hz1`, "spikes", x0 + 4, groundY + 1, 3, 2);
      addPlat(`${z}_gm`, x0 + 7, groundY, 7, 3, false, "ice");
      addHazard(`${z}_hz2`, "spikes", x0 + 14, groundY + 1, 3, 2);
      addPlat(`${z}_gr`, x0 + 17, groundY, 3, 3, false, "ice");

      addPlat(`${z}_i1`, x0 + 3, groundY - 2, 5, 1, true, "ice");
      addPlat(`${z}_i2`, x0 + 9, groundY - 4, 8, 1, true, "ice");
      addPlat(`${z}_i3`, x0 + 5, groundY - 7, 7, 1, true, "ice");
      addLadder(`${z}_lad`, x0 + 10, groundY - 7, 3);

      addMob(uid(`${z}_m`), m1, x0 + 10, groundY, x0 + 7.4, x0 + 13.6);
      addMob(uid(`${z}_m`), m2, x0 + 13, groundY - 4, x0 + 9.4, x0 + 16.6);
      addMob(uid(`${z}_m`), m3, x0 + 8, groundY - 7, x0 + 5.4, x0 + 11.6);

      addItem(uid(`${z}_i`), "star_coin", x0 + 5, groundY - 2);
      addItem(uid(`${z}_i`), "star_coin", x0 + 12, groundY - 4);
      addItem(uid(`${z}_i`), "red_apple", x0 + 8, groundY - 7);
      return;
    }

    if (zone === "conveyor_gauntlet") {
      // Alternating conveyor ledges + stationary central normal combat anchor + moving bridge
      const hz = bp.primaryHazard === "water" ? "spikes" : bp.primaryHazard;
      addPlat(`${z}_gl`, x0, groundY, 3, 3, false);
      addHazard(`${z}_hz`, hz, x0 + 3, groundY + 1, 14, 2);
      addPlat(`${z}_c1`, x0 + 3, groundY - 1, 4, 1, true, "conveyor_right");
      // Stationary normal combat foothold right in the middle of the gauntlet
      addPlat(`${z}_anchor`, x0 + 7, groundY - 2, 4, 1, true, "normal");
      addPlat(`${z}_c2`, x0 + 11, groundY - 2, 3, 1, true, "conveyor_left");
      addPlat(`${z}_c3`, x0 + 5, groundY - 5, 8, 1, true, "conveyor_right");
      addMoving(`${z}_mp`, 3, [
        { x: x0 + 14, y: groundY - 3 },
        { x: x0 + 14, y: groundY - 1 }
      ]);
      addPlat(`${z}_gr`, x0 + 17, groundY, 3, 3, false);
      addLadder(`${z}_lad`, x0 + 9, groundY - 5, 3);

      addMob(uid(`${z}_m`), mGrounded, x0 + 12, groundY - 2, x0 + 7.4, x0 + 13.6);
      addMob(uid(`${z}_m`), mGroundedElite, x0 + 9, groundY - 5, x0 + 5.4, x0 + 12.6);
      addMob(uid(`${z}_m`), m1, x0 + 18, groundY, x0 + 17.2, x0 + 19.6);

      addItem(uid(`${z}_i`), "star_coin", x0 + 5, groundY - 1);
      addItem(uid(`${z}_i`), "star_coin", x0 + 8, groundY - 5);
      addItem(uid(`${z}_i`), "sweet_potion", x0 + 12, groundY - 5);
      return;
    }

    if (zone === "mud_swamp") {
      // Sticky mud islands & bouncy spore pads over bubbling poison bogs
      addPlat(`${z}_gl`, x0, groundY, 4, 3, false, "mud");
      addHazard(`${z}_hz1`, "poison", x0 + 4, groundY + 1, 5, 2);
      addPlat(`${z}_m1`, x0 + 5, groundY - 1, 4, 1, true, "mud");
      addPlat(`${z}_gm`, x0 + 9, groundY, 4, 3, false, "mud");
      addHazard(`${z}_hz2`, "poison", x0 + 13, groundY + 1, 4, 2);
      addPlat(`${z}_b1`, x0 + 13, groundY, 3, 1, true, "bouncy");
      addPlat(`${z}_gr`, x0 + 17, groundY, 3, 3, false, "mud");

      addPlat(`${z}_hi`, x0 + 8, groundY - 4, 9, 1, true, "normal");
      addLadder(`${z}_lad`, x0 + 10, groundY - 4, 4);

      addMob(uid(`${z}_m`), m1, x0 + 11, groundY, x0 + 9.3, x0 + 12.7);
      addMob(uid(`${z}_m`), m2, x0 + 12, groundY - 4, x0 + 8.5, x0 + 16.5);
      addMob(uid(`${z}_m`), m3, x0 + 18, groundY, x0 + 17.2, x0 + 19.7);

      addItem(uid(`${z}_i`), "star_coin", x0 + 7, groundY - 1);
      addItem(uid(`${z}_i`), "star_coin", x0 + 11, groundY - 4);
      addItem(uid(`${z}_i`), "red_apple", x0 + 15, groundY - 4);
      return;
    }

    if (zone === "lava_canyon") {
      // Blazing lava river across the canyon floor crossed via rock pillars, moving bridge,
      // and a stationary central normal combat anchor platform right over the midpoint!
      addPlat(`${z}_gl`, x0, groundY, 3, 3, false);
      addHazard(`${z}_hz`, "lava", x0 + 3, groundY + 1, 14, 2);
      addPlat(`${z}_isl1`, x0 + 4, groundY - 1, 4, 1, true);
      addMoving(`${z}_mp1`, 3, [
        { x: x0 + 7, y: groundY - 1 },
        { x: x0 + 11, y: groundY - 1 }
      ]);
      addPlat(`${z}_anchor`, x0 + 9, groundY - 3, 3, 1, true, "normal");
      addPlat(`${z}_isl2`, x0 + 13, groundY - 1, 3, 1, true, "conveyor_right");
      addPlat(`${z}_hi`, x0 + 5, groundY - 5, 10, 1, true);
      addLadder(`${z}_lad`, x0 + 6, groundY - 5, 4);
      addPlat(`${z}_gr`, x0 + 17, groundY, 3, 3, false);

      addMob(uid(`${z}_m`), mGrounded, x0 + 6, groundY - 1, x0 + 4.3, x0 + 7.7);
      addMob(uid(`${z}_m`), mGroundedElite, x0 + 10, groundY - 5, x0 + 5.5, x0 + 14.5);
      addMob(uid(`${z}_m`), mGrounded, x0 + 18, groundY, x0 + 17.2, x0 + 19.6);

      addItem(uid(`${z}_i`), "star_coin", x0 + 10, groundY - 3);
      addItem(uid(`${z}_i`), "star_coin", x0 + 8, groundY - 5);
      addItem(uid(`${z}_i`), "red_apple", x0 + 13, groundY - 5);
      return;
    }

    if (zone === "hunting_arena") {
      // Rich 3-tier mob grinding ground so higher stages provide ample XP!
      const tierSurf: PlatformSurface =
        bp.primarySurface === "ice" || bp.primarySurface === "mud" ? bp.primarySurface : "normal";
      addPlat(`${z}_g`, x0, groundY, 20, 3, false);
      addPlat(`${z}_t1`, x0 + 2, groundY - 3, 16, 1, true, tierSurf);
      addPlat(`${z}_t2`, x0 + 4, groundY - 7, 12, 1, true);

      addLadder(`${z}_l1`, x0 + 4, groundY - 3, 3);
      addLadder(`${z}_l2`, x0 + 15, groundY - 3, 3);
      addLadder(`${z}_l3`, x0 + 10, groundY - 7, 4);

      addMob(uid(`${z}_m`), m1, x0 + 6, groundY, x0 + 1, x0 + 10);
      addMob(uid(`${z}_m`), m2, x0 + 15, groundY, x0 + 11, x0 + 19);
      addMob(uid(`${z}_m`), m2, x0 + 8, groundY - 3, x0 + 2.5, x0 + 12);
      addMob(uid(`${z}_m`), m3, x0 + 14, groundY - 3, x0 + 11, x0 + 17.5);
      addMob(uid(`${z}_m`), m3, x0 + 10, groundY - 7, x0 + 4.5, x0 + 15.5);

      if (bp.weaponPickup && !bp.weaponPickup.inChamber && !weaponPlaced) {
        weaponPlaced = true;
        addItem("it_weap", bp.weaponPickup.itemId, x0 + 9, groundY - 7);
      } else {
        addItem(uid(`${z}_i`), "star_coin", x0 + 7, groundY - 7);
      }
      addItem(uid(`${z}_i`), "red_apple", x0 + 13, groundY - 3);
      addItem(uid(`${z}_i`), "sweet_potion", x0 + 14, groundY - 7);
      addDeco(uid(`${z}_d`), "bush", x0 + 18, groundY);
      return;
    }

    if (zone === "portal_hub") {
      // Sanctuary containing the glowing Warp Portal to this stage's isolated chamber!
      addPlat(`${z}_g`, x0, groundY, 20, 3, false);
      addPlat(`${z}_a`, x0 + 2, groundY - 2, 6, 1, true);
      addPlat(`${z}_b`, x0 + 10, groundY - 4, 8, 1, true);
      addPlat(`${z}_top`, x0 + 4, groundY - 6, 9, 1, true);
      addLadder(`${z}_lad`, x0 + 11, groundY - 6, 2);
      addLadder(`${z}_lad2`, x0 + 6, groundY - 6, 4);

      addPortal("pt_chamber_in", x0 + 7.5, groundY - 6, "warp", `${bp.chamberName} 입장`, bp.chamberColor);

      addMob(uid(`${z}_m`), m2, x0 + 10, groundY, x0 + 3, x0 + 17);
      addMob(uid(`${z}_m`), m3, x0 + 14, groundY - 4, x0 + 10.5, x0 + 17.5);

      addItem(uid(`${z}_i`), "star_coin", x0 + 5, groundY - 2);
      addItem(uid(`${z}_i`), "red_apple", x0 + 15, groundY - 4);
      addDeco(uid(`${z}_sign`), "sign", x0 + 4, groundY - 2, bp.signPortal);
      addDeco(uid(`${z}_f`), "flower_red", x0 + 10, groundY - 6);
      return;
    }

    if (zone === "boss_arena") {
      // Climax / Boss encounter with hazard edges & tactical high ground
      // Overlap z_l (x0+2..x0+9) and z_top (x0+6..x0+14) so z_lad (x0+7) connects both cleanly!
      addPlat(`${z}_g`, x0, groundY, 20, 3, false);
      addPlat(`${z}_l`, x0 + 2, groundY - 2, 7, 1, true);
      addPlat(`${z}_top`, x0 + 6, groundY - 5, 8, 1, true, bp.primarySurface === "bouncy" ? "bouncy" : "normal");
      addPlat(`${z}_r`, x0 + 14, groundY - 3, 5, 1, true);
      addLadder(`${z}_lad`, x0 + 7, groundY - 5, 3);

      addMob("mob_boss", mBoss, x0 + 11, groundY, x0 + 3, x0 + 18);
      addMob(uid(`${z}_m`), m2, x0 + 10, groundY - 5, x0 + 6.4, x0 + 13.6);
      addMob(uid(`${z}_m`), m3, x0 + 16, groundY - 3, x0 + 14.3, x0 + 18.6);

      addItem(uid(`${z}_i`), "red_apple", x0 + 4, groundY - 2);
      addItem(uid(`${z}_i`), "sweet_potion", x0 + 10, groundY - 5);
      addItem(uid(`${z}_i`), "star_coin", x0 + 12, groundY - 5);
      addDeco(uid(`${z}_sign`), "sign", x0 + 1.5, groundY, bp.signClimax);
      return;
    }

    if (zone === "summit_exit") {
      // Ends cleanly at x0 + 14 so there is a wide 8-tile impassable void before the isolated chamber!
      addPlat(`${z}_g`, x0, groundY, 14, 3, false);
      addPlat(`${z}_a`, x0 + 2, groundY - 2, 6, 1, true);
      addPlat(`${z}_top`, x0 + 5, groundY - 5, 9, 1, true);
      addLadder(`${z}_lad`, x0 + 6, groundY - 5, 3);

      if (n < 10) {
        const nextBp = BLUEPRINTS[n]!;
        addPortal(
          "pt_next",
          x0 + 11,
          groundY - 5,
          "next_stage",
          `스테이지 ${n + 1} 이동 (권장 Lv.${nextBp.recommendedMinLevel}+)`,
          "#FFD740",
          {
            targetStageId: nextBp.id,
            requiredLevel: nextBp.minEntryLevel
          }
        );
      } else {
        addPortal("pt_goal", x0 + 11, groundY - 5, "goal", "전설의 별빛 정상 클리어!", "#FFD740");
      }

      addMob(uid(`${z}_m`), m1, x0 + 8, groundY, x0 + 2, x0 + 13);
      addItem(uid(`${z}_i`), "star_coin", x0 + 4, groundY - 2);
      addItem(uid(`${z}_i`), "star_coin", x0 + 8, groundY - 5);
      addItem(uid(`${z}_i`), "star_coin", x0 + 9, groundY - 6);
      addItem(uid(`${z}_i`), "star_coin", x0 + 10, groundY - 5);
      addDeco(uid(`${z}_f1`), "flower_red", x0 + 8, groundY - 5);
      addDeco(uid(`${z}_f2`), "flower_yellow", x0 + 12.5, groundY - 5);
    }
  });

  // ==================== FINAL SCREEN: COMPLETELY ISOLATED PORTAL CHAMBER ====================
  // Placed at x = (screenCount - 1) * 20 + 2 (8 tiles away from summit_exit's right edge x0+14!)
  // and elevated high so it is strictly unreachable except via the bidirectional warp portal.
  const isoX = (bp.screenCount - 1) * 20 + 2;
  const isoFloorY = Math.max(9, groundY - 4);
  addPlat("iso_floor", isoX, isoFloorY, 17, 2, false);
  addPlat("iso_mid", isoX + 2, isoFloorY - 3, 13, 1, true, bp.chamberSurface);
  addPlat("iso_top", isoX + 5, isoFloorY - 6, 8, 1, true);
  addLadder("iso_lad1", isoX + 4, isoFloorY - 3, 3);
  addLadder("iso_lad2", isoX + 11, isoFloorY - 6, 3);

  addPortal("pt_chamber_out", isoX + 1.2, isoFloorY, "warp", "본 맵으로 돌아가기", bp.chamberColor);
  linkPortals("link_chamber", "pt_chamber_in", "pt_chamber_out");

  // Bonus mobs & rare treasure inside the isolated portal chamber!
  addMob("iso_mob1", m2, isoX + 7, isoFloorY, isoX + 3.5, isoX + 15.5);
  addMob("iso_mob2", m3, isoX + 13, isoFloorY, isoX + 9, isoX + 16.4);
  addMob("iso_mob3", m3, isoX + 9, isoFloorY - 3, isoX + 2.5, isoX + 14.5);

  if (bp.weaponPickup && bp.weaponPickup.inChamber && !weaponPlaced) {
    weaponPlaced = true;
    addItem("it_weap", bp.weaponPickup.itemId, isoX + 9, isoFloorY - 6);
  }
  addItem("iso_gh", "golden_heart", isoX + 7, isoFloorY - 6);
  addItem("iso_po", "sweet_potion", isoX + 11, isoFloorY - 6);
  addItem("iso_c1", "star_coin", isoX + 6, isoFloorY - 3);
  addItem("iso_c2", "star_coin", isoX + 8, isoFloorY - 3);
  addItem("iso_c3", "star_coin", isoX + 10, isoFloorY - 3);
  addDeco("iso_f1", "flower_red", isoX + 5.5, isoFloorY - 6);
  addDeco("iso_f2", "flower_yellow", isoX + 12, isoFloorY - 6);

  return stage;
}

export const ALL_STAGES: NormalizedStage[] = BLUEPRINTS.map(buildStageFromBlueprint);

export const STAGES_BY_ID: Record<string, NormalizedStage> = Object.fromEntries(
  ALL_STAGES.map((st) => [st.meta.id, st])
);

export const STAGE_IDS: string[] = ALL_STAGES.map((st) => st.meta.id);

export function getStageById(stageId: string): NormalizedStage {
  return STAGES_BY_ID[stageId] ?? ALL_STAGES[0]!;
}

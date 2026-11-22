/**
 * Economy, 4x6 Inventory, Treasure Chest, Elite Drop, Shop, 3-Tier Upgrade Stones
 * (초급/중급/고급), Dismantle (강화석 가루), Smelting (제련) & Weapon Enhancement Domain Module.
 *
 * Pure and deterministic so client, server, and unit tests share identical formulas
 * and anti-abuse invariants. Verified against the master Google Spreadsheet in AGENTS.md.
 */

import type {
  InventoryItemSpec,
  InventorySlot,
  MobTemplate,
  UpgradeStoneColor,
  UpgradeStoneId,
  UpgradeStoneTier,
  WeaponTemplate,
  WeaponUpgradeStat,
  WeaponUpgradeState
} from "./types";

export const INVENTORY_ROWS = 4;
export const INVENTORY_COLS = 6;
export const INVENTORY_SIZE = INVENTORY_ROWS * INVENTORY_COLS; // 24 slots
export const STONE_MAX_STACK = 20;
export const POWDER_MAX_STACK = 999;
export const MAX_WEAPON_UPGRADE_LEVEL = 10;
export const ECONOMY_ACTION_COOLDOWN_MS = 150;
export const STONE_POWDER_ITEM_ID = "stone_powder";

export const UPGRADE_STONE_TIER_LABELS: Record<UpgradeStoneTier, string> = {
  1: "초급",
  2: "중급",
  3: "고급"
};

/** Tier 1 (초급) stone IDs — preserved as canonical base IDs for D1 profile compatibility. */
export const UPGRADE_STONE_IDS: readonly UpgradeStoneId[] = [
  "stone_green",
  "stone_blue",
  "stone_orange",
  "stone_red"
] as const;

export const ALL_UPGRADE_STONE_IDS: readonly UpgradeStoneId[] = [
  "stone_green",
  "stone_blue",
  "stone_orange",
  "stone_red",
  "stone_green_t2",
  "stone_blue_t2",
  "stone_orange_t2",
  "stone_red_t2",
  "stone_green_t3",
  "stone_blue_t3",
  "stone_orange_t3",
  "stone_red_t3"
] as const;

export function getStoneIdForColorAndTier(color: UpgradeStoneColor, tier: UpgradeStoneTier): UpgradeStoneId {
  if (tier === 1) return `stone_${color}` as UpgradeStoneId;
  return `stone_${color}_t${tier}` as UpgradeStoneId;
}

export const INVENTORY_ITEMS: Record<string, InventoryItemSpec> = {
  // ---- Tier 1: 초급 강화석 (+0 → +3, 상점 구매 및 전 스테이지 드롭) ----
  stone_red: {
    id: "stone_red",
    name: "초급 붉은 강화석",
    kind: "stone",
    tier: 1,
    colorKey: "red",
    dismantlePowder: 3,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 5,
    color: "#FF5252",
    buyPrice: 60,
    sellPrice: 15,
    upgradeStat: "atk",
    description: "초급 공격력 강화 재료"
  },
  stone_green: {
    id: "stone_green",
    name: "초급 초록 강화석",
    kind: "stone",
    tier: 1,
    colorKey: "green",
    dismantlePowder: 3,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 2,
    color: "#69F0AE",
    buyPrice: 55,
    sellPrice: 14,
    upgradeStat: "dex",
    description: "초급 공격속도 강화 재료"
  },
  stone_blue: {
    id: "stone_blue",
    name: "초급 푸른 강화석",
    kind: "stone",
    tier: 1,
    colorKey: "blue",
    dismantlePowder: 4,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 3,
    color: "#40C4FF",
    buyPrice: 80,
    sellPrice: 20,
    description: "초급 마력 강화 재료"
  },
  stone_orange: {
    id: "stone_orange",
    name: "초급 주황 강화석",
    kind: "stone",
    tier: 1,
    colorKey: "orange",
    dismantlePowder: 5,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 4,
    color: "#FFAB40",
    buyPrice: 100,
    sellPrice: 25,
    description: "초급 태양 강화 재료"
  },

  // ---- Tier 2: 중급 강화석 (+3 → +6, 제련 및 스테이지 4~10 드롭) ----
  stone_red_t2: {
    id: "stone_red_t2",
    name: "중급 붉은 강화석",
    kind: "stone",
    tier: 2,
    colorKey: "red",
    dismantlePowder: 8,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 5,
    color: "#FF5252",
    sellPrice: 70,
    upgradeStat: "atk",
    description: "중급 공격력 강화 재료"
  },
  stone_green_t2: {
    id: "stone_green_t2",
    name: "중급 초록 강화석",
    kind: "stone",
    tier: 2,
    colorKey: "green",
    dismantlePowder: 8,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 2,
    color: "#69F0AE",
    sellPrice: 65,
    upgradeStat: "dex",
    description: "중급 공격속도 강화 재료"
  },
  stone_blue_t2: {
    id: "stone_blue_t2",
    name: "중급 푸른 강화석",
    kind: "stone",
    tier: 2,
    colorKey: "blue",
    dismantlePowder: 10,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 3,
    color: "#40C4FF",
    sellPrice: 90,
    description: "중급 마력 강화 재료"
  },
  stone_orange_t2: {
    id: "stone_orange_t2",
    name: "중급 주황 강화석",
    kind: "stone",
    tier: 2,
    colorKey: "orange",
    dismantlePowder: 12,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 4,
    color: "#FFAB40",
    sellPrice: 110,
    description: "중급 태양 강화 재료"
  },

  // ---- Tier 3: 고급 강화석 (+6 → +10, 제련 및 스테이지 7~10 드롭) ----
  stone_red_t3: {
    id: "stone_red_t3",
    name: "고급 붉은 강화석",
    kind: "stone",
    tier: 3,
    colorKey: "red",
    dismantlePowder: 20,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 5,
    color: "#FF5252",
    sellPrice: 180,
    upgradeStat: "atk",
    description: "고급 공격력 강화 재료"
  },
  stone_green_t3: {
    id: "stone_green_t3",
    name: "고급 초록 강화석",
    kind: "stone",
    tier: 3,
    colorKey: "green",
    dismantlePowder: 20,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 2,
    color: "#69F0AE",
    sellPrice: 170,
    upgradeStat: "dex",
    description: "고급 공격속도 강화 재료"
  },
  stone_blue_t3: {
    id: "stone_blue_t3",
    name: "고급 푸른 강화석",
    kind: "stone",
    tier: 3,
    colorKey: "blue",
    dismantlePowder: 24,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 3,
    color: "#40C4FF",
    sellPrice: 220,
    description: "고급 마력 강화 재료"
  },
  stone_orange_t3: {
    id: "stone_orange_t3",
    name: "고급 주황 강화석",
    kind: "stone",
    tier: 3,
    colorKey: "orange",
    dismantlePowder: 28,
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 4,
    color: "#FFAB40",
    sellPrice: 260,
    description: "고급 태양 강화 재료"
  },

  // ---- 강화석 가루 (강화석 분해로 획득 → 제련 핵심 재료) ----
  stone_powder: {
    id: STONE_POWDER_ITEM_ID,
    name: "강화석 가루",
    kind: "powder",
    stackable: true,
    maxStack: POWDER_MAX_STACK,
    sheet: "economy",
    iconIndex: 4,
    color: "#E1BEE7",
    sellPrice: 3,
    description: "강화석 분해로 얻는 제련 재료"
  },

  // ---- 유물 ----
  lucky_charm: {
    id: "lucky_charm",
    name: "초원 행운 부적",
    kind: "relic",
    stackable: false,
    maxStack: 1,
    sheet: "items",
    iconIndex: 2,
    color: "#FFD740",
    buyPrice: 90,
    sellPrice: 22,
    description: "희귀 장식 유물"
  }
};

export type SmeltingRecipe = {
  id: string;
  outputItemId: UpgradeStoneId;
  tier: UpgradeStoneTier;
  colorKey: UpgradeStoneColor;
  powderCost: number;
  coinCost: number;
};

/**
 * Verified smelting recipes (AGENTS.md Sheet 3: 3_강화_제련_비용표).
 * Every recipe enforces:
 * - dismantlePowder / powderCost <= 0.67 (no powder duplication loop)
 * - sellPrice / impliedBasisCost <= 0.30 (no coin arbitrage)
 * - for Tier 1, implied smelting cost >= shop buyPrice (color conversion sink, never a discount)
 */
export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  // 초급 (색상 변환용)
  { id: "smelt_red_t1", outputItemId: "stone_red", tier: 1, colorKey: "red", powderCost: 5, coinCost: 20 },
  { id: "smelt_green_t1", outputItemId: "stone_green", tier: 1, colorKey: "green", powderCost: 5, coinCost: 20 },
  { id: "smelt_blue_t1", outputItemId: "stone_blue", tier: 1, colorKey: "blue", powderCost: 7, coinCost: 25 },
  { id: "smelt_orange_t1", outputItemId: "stone_orange", tier: 1, colorKey: "orange", powderCost: 9, coinCost: 30 },
  // 중급 (+3 → +6 핵심 재료)
  { id: "smelt_red_t2", outputItemId: "stone_red_t2", tier: 2, colorKey: "red", powderCost: 12, coinCost: 90 },
  { id: "smelt_green_t2", outputItemId: "stone_green_t2", tier: 2, colorKey: "green", powderCost: 12, coinCost: 90 },
  { id: "smelt_blue_t2", outputItemId: "stone_blue_t2", tier: 2, colorKey: "blue", powderCost: 15, coinCost: 110 },
  { id: "smelt_orange_t2", outputItemId: "stone_orange_t2", tier: 2, colorKey: "orange", powderCost: 18, coinCost: 130 },
  // 고급 (+6 → +10 엔드게임 재료)
  { id: "smelt_red_t3", outputItemId: "stone_red_t3", tier: 3, colorKey: "red", powderCost: 30, coinCost: 280 },
  { id: "smelt_green_t3", outputItemId: "stone_green_t3", tier: 3, colorKey: "green", powderCost: 30, coinCost: 280 },
  { id: "smelt_blue_t3", outputItemId: "stone_blue_t3", tier: 3, colorKey: "blue", powderCost: 36, coinCost: 340 },
  { id: "smelt_orange_t3", outputItemId: "stone_orange_t3", tier: 3, colorKey: "orange", powderCost: 42, coinCost: 400 }
] as const;

export const SMELTING_RECIPES_BY_ID: Record<string, SmeltingRecipe> = Object.fromEntries(
  SMELTING_RECIPES.map((r) => [r.id, r])
);

export function canDismantleItem(itemId: string): boolean {
  const spec = INVENTORY_ITEMS[itemId];
  return Boolean(spec && typeof spec.dismantlePowder === "number" && spec.dismantlePowder > 0);
}

export function computeDismantleYield(itemId: string, quantity: number): number {
  const spec = INVENTORY_ITEMS[itemId];
  const qty = Math.floor(quantity);
  if (!spec || !spec.dismantlePowder || !Number.isFinite(qty) || qty <= 0) return 0;
  return spec.dismantlePowder * qty;
}

export type ShopOffer = {
  id: string;
  itemId: string;
  name: string;
  buyPrice: number;
  sellPrice: number;
  delivery: "inventory" | "potion";
  sheet: "economy" | "items";
  iconIndex: number;
  color: string;
  description: string;
};

/** Only Tier 1 (초급) stones, potions, and relics are sold in Shop; 중급/고급 are smelted or dropped. */
export const SHOP_OFFERS: readonly ShopOffer[] = [
  {
    id: "offer_stone_red",
    itemId: "stone_red",
    name: INVENTORY_ITEMS.stone_red!.name,
    buyPrice: INVENTORY_ITEMS.stone_red!.buyPrice!,
    sellPrice: INVENTORY_ITEMS.stone_red!.sellPrice,
    delivery: "inventory",
    sheet: "economy",
    iconIndex: 5,
    color: "#FF5252",
    description: "초급 공격력 강화 재료"
  },
  {
    id: "offer_stone_green",
    itemId: "stone_green",
    name: INVENTORY_ITEMS.stone_green!.name,
    buyPrice: INVENTORY_ITEMS.stone_green!.buyPrice!,
    sellPrice: INVENTORY_ITEMS.stone_green!.sellPrice,
    delivery: "inventory",
    sheet: "economy",
    iconIndex: 2,
    color: "#69F0AE",
    description: "초급 공격속도 강화 재료"
  },
  {
    id: "offer_stone_blue",
    itemId: "stone_blue",
    name: INVENTORY_ITEMS.stone_blue!.name,
    buyPrice: INVENTORY_ITEMS.stone_blue!.buyPrice!,
    sellPrice: INVENTORY_ITEMS.stone_blue!.sellPrice,
    delivery: "inventory",
    sheet: "economy",
    iconIndex: 3,
    color: "#40C4FF",
    description: "초급 마력 강화 재료"
  },
  {
    id: "offer_stone_orange",
    itemId: "stone_orange",
    name: INVENTORY_ITEMS.stone_orange!.name,
    buyPrice: INVENTORY_ITEMS.stone_orange!.buyPrice!,
    sellPrice: INVENTORY_ITEMS.stone_orange!.sellPrice,
    delivery: "inventory",
    sheet: "economy",
    iconIndex: 4,
    color: "#FFAB40",
    description: "초급 태양 강화 재료"
  },
  {
    id: "offer_sweet_potion",
    itemId: "sweet_potion",
    name: "달콤 포션",
    buyPrice: 35,
    sellPrice: 0,
    delivery: "potion",
    sheet: "items",
    iconIndex: 1,
    color: "#FF80AB",
    description: "HP 45% 회복 · [F] 즉시 추가"
  },
  {
    id: "offer_lucky_charm",
    itemId: "lucky_charm",
    name: INVENTORY_ITEMS.lucky_charm!.name,
    buyPrice: INVENTORY_ITEMS.lucky_charm!.buyPrice!,
    sellPrice: INVENTORY_ITEMS.lucky_charm!.sellPrice,
    delivery: "inventory",
    sheet: "items",
    iconIndex: 2,
    color: "#FFD740",
    description: "희귀 장식 유물"
  }
];

export const SHOP_OFFERS_BY_ID: Record<string, ShopOffer> = Object.fromEntries(
  SHOP_OFFERS.map((o) => [o.id, o])
);

// ==================== 4×6 INVENTORY OPERATIONS ====================

export function createEmptyInventory(): InventorySlot[] {
  return Array.from({ length: INVENTORY_SIZE }, () => null);
}

export function normalizeInventory(raw: unknown): InventorySlot[] {
  const out = createEmptyInventory();
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < Math.min(INVENTORY_SIZE, raw.length); i++) {
    const slot = raw[i];
    if (!slot || typeof slot !== "object") continue;
    const itemId = typeof (slot as { itemId?: unknown }).itemId === "string" ? (slot as { itemId: string }).itemId : "";
    const qty = Number((slot as { quantity?: unknown }).quantity);
    const spec = INVENTORY_ITEMS[itemId];
    if (!spec || !Number.isFinite(qty) || qty <= 0) continue;
    out[i] = {
      itemId,
      quantity: Math.max(1, Math.min(spec.maxStack, Math.floor(qty)))
    };
  }
  return out;
}

export function countItemInInventory(inv: readonly InventorySlot[], itemId: string): number {
  let total = 0;
  for (const slot of inv) {
    if (slot && slot.itemId === itemId) total += slot.quantity;
  }
  return total;
}

export function canAddItemToInventory(inv: readonly InventorySlot[], itemId: string, quantity: number): boolean {
  const spec = INVENTORY_ITEMS[itemId];
  if (!spec || !Number.isFinite(quantity) || quantity <= 0) return false;
  let remaining = Math.floor(quantity);
  if (spec.stackable && spec.maxStack > 1) {
    for (const slot of inv) {
      if (slot && slot.itemId === itemId && slot.quantity < spec.maxStack) {
        remaining -= spec.maxStack - slot.quantity;
        if (remaining <= 0) return true;
      }
    }
  }
  for (const slot of inv) {
    if (slot === null) {
      remaining -= spec.maxStack;
      if (remaining <= 0) return true;
    }
  }
  return remaining <= 0;
}

export function addItemToInventory(
  inv: readonly InventorySlot[],
  itemId: string,
  quantity: number
): { inventory: InventorySlot[]; added: number; overflow: number } {
  const spec = INVENTORY_ITEMS[itemId];
  const next = inv.map((s) => (s ? { ...s } : null));
  const want = Math.max(0, Math.floor(quantity));
  if (!spec || want <= 0) return { inventory: next, added: 0, overflow: want };

  let remaining = want;
  if (spec.stackable && spec.maxStack > 1) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const slot = next[i];
      if (slot && slot.itemId === itemId && slot.quantity < spec.maxStack) {
        const take = Math.min(remaining, spec.maxStack - slot.quantity);
        slot.quantity += take;
        remaining -= take;
      }
    }
  }
  for (let i = 0; i < next.length && remaining > 0; i++) {
    if (next[i] === null) {
      const take = Math.min(remaining, spec.maxStack);
      next[i] = { itemId, quantity: take };
      remaining -= take;
    }
  }
  return { inventory: next, added: want - remaining, overflow: remaining };
}

export function removeItemFromInventory(
  inv: readonly InventorySlot[],
  itemId: string,
  quantity: number
): { inventory: InventorySlot[]; removed: number } {
  const next = inv.map((s) => (s ? { ...s } : null));
  const want = Math.max(0, Math.floor(quantity));
  if (want <= 0) return { inventory: next, removed: 0 };

  let remaining = want;
  // Drain smallest/partial stacks from the back first so full stacks remain tidy
  for (let i = next.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = next[i];
    if (slot && slot.itemId === itemId) {
      const take = Math.min(remaining, slot.quantity);
      slot.quantity -= take;
      remaining -= take;
      if (slot.quantity <= 0) next[i] = null;
    }
  }
  return { inventory: next, removed: want - remaining };
}

export function removeItemAtSlot(
  inv: readonly InventorySlot[],
  slotIndex: number,
  quantity: number
): { inventory: InventorySlot[]; removed: number; itemId: string | null } {
  const next = inv.map((s) => (s ? { ...s } : null));
  const idx = Math.floor(slotIndex);
  const want = Math.max(0, Math.floor(quantity));
  if (idx < 0 || idx >= next.length || want <= 0) {
    return { inventory: next, removed: 0, itemId: null };
  }
  const slot = next[idx];
  if (!slot) return { inventory: next, removed: 0, itemId: null };
  const take = Math.min(want, slot.quantity);
  slot.quantity -= take;
  if (slot.quantity <= 0) next[idx] = null;
  return { inventory: next, removed: take, itemId: slot.itemId };
}

// ==================== TREASURE CHEST & ELITE DROP TABLES ====================

/**
 * Stage-scaled coin haul from a Treasure Chest.
 * Higher stages carry significantly richer rewards!
 */
export function computeChestCoinReward(stageNumber: number): number {
  const s = Math.max(1, Math.min(10, Math.floor(stageNumber)));
  return Math.round(20 + s * 12 + s * s * 2);
}

/**
 * Selects stone tier (초급=1, 중급=2, 고급=3) by stage number (AGENTS.md Sheet 6).
 * Defaults to Tier 1 when `tierRoll01` is 0 so low rolls favor basic stones cleanly.
 */
export function pickUpgradeStoneTierForStage(stageNumber: number, tierRoll01 = 0): UpgradeStoneTier {
  const r = Math.max(0, Math.min(0.9999, Number.isFinite(tierRoll01) ? tierRoll01 : 0));
  const s = Math.max(1, Math.min(10, Math.floor(stageNumber)));
  if (s <= 3) return 1;
  if (s === 4) return r < 0.9 ? 1 : 2;
  if (s === 5) return r < 0.65 ? 1 : 2;
  if (s === 6) return r < 0.55 ? 1 : 2;
  if (s === 7) return r < 0.45 ? 1 : r < 0.95 ? 2 : 3;
  if (s === 8) return r < 0.3 ? 1 : r < 0.8 ? 2 : 3;
  if (s === 9) return r < 0.2 ? 1 : r < 0.7 ? 2 : 3;
  return r < 0.15 ? 1 : r < 0.6 ? 2 : 3;
}

export function pickUpgradeStoneForStage(
  stageNumber: number,
  colorRoll01: number,
  tierRoll01 = 0
): UpgradeStoneId {
  const r = Math.max(0, Math.min(0.9999, Number.isFinite(colorRoll01) ? colorRoll01 : 0.5));
  const s = Math.max(1, Math.floor(stageNumber));
  let color: UpgradeStoneColor;
  if (s <= 2) {
    if (r < 0.44) color = "red";
    else if (r < 0.84) color = "green";
    else if (r < 0.94) color = "blue";
    else color = "orange";
  } else if (s <= 5) {
    if (r < 0.34) color = "red";
    else if (r < 0.66) color = "green";
    else if (r < 0.86) color = "blue";
    else color = "orange";
  } else {
    if (r < 0.28) color = "red";
    else if (r < 0.54) color = "green";
    else if (r < 0.78) color = "blue";
    else color = "orange";
  }
  const tier = pickUpgradeStoneTierForStage(s, tierRoll01);
  return getStoneIdForColorAndTier(color, tier);
}

/**
 * Rare upgrade stone roll when opening a Treasure Chest.
 */
export function rollChestStoneDrop(
  stageNumber: number,
  chanceRoll01: number,
  colorRoll01: number,
  tierRoll01 = 0
): { itemId: UpgradeStoneId; quantity: number } | null {
  const s = Math.max(1, Math.floor(stageNumber));
  const chance = Math.min(0.55, 0.28 + s * 0.025);
  if (chanceRoll01 >= chance) return null;
  const itemId = pickUpgradeStoneForStage(s, colorRoll01, tierRoll01);
  const quantity = s >= 7 && chanceRoll01 < chance * 0.35 ? 2 : 1;
  return { itemId, quantity };
}

/**
 * Rare upgrade stone drop roll when defeating an Elite or Boss monster.
 * Normal non-elite mobs never drop upgrade stones.
 */
export function rollEliteStoneDrop(
  mobTpl: Pick<MobTemplate, "isElite" | "isBoss">,
  stageNumber: number,
  chanceRoll01: number,
  colorRoll01: number,
  tierRoll01 = 0
): { itemId: UpgradeStoneId; quantity: number } | null {
  if (!mobTpl.isElite && !mobTpl.isBoss) return null;
  const chance = mobTpl.isBoss ? 0.48 : 0.22;
  if (chanceRoll01 >= chance) return null;
  const itemId = pickUpgradeStoneForStage(stageNumber, colorRoll01, tierRoll01);
  return { itemId, quantity: 1 };
}

// ==================== CHARACTER DEX & TIERED WEAPON ENHANCEMENT ====================

export function computePlayerBaseDex(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return 4 + Math.floor((lv - 1) * 0.6);
}

export function createEmptyWeaponUpgrade(): WeaponUpgradeState {
  return { atkLevel: 0, dexLevel: 0, failStreak: 0 };
}

export function normalizeWeaponUpgrades(raw: unknown): Record<string, WeaponUpgradeState> {
  const out: Record<string, WeaponUpgradeState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [wid, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const rawAtk = Math.max(0, Math.floor(Number((val as { atkLevel?: unknown }).atkLevel ?? 0) || 0));
    const rawDex = Math.max(0, Math.floor(Number((val as { dexLevel?: unknown }).dexLevel ?? 0) || 0));
    const atkLevel = Math.min(MAX_WEAPON_UPGRADE_LEVEL, rawAtk);
    const dexLevel = Math.min(MAX_WEAPON_UPGRADE_LEVEL - atkLevel, rawDex);
    const failStreak = Math.max(0, Math.min(10, Math.floor(Number((val as { failStreak?: unknown }).failStreak ?? 0) || 0)));
    if (atkLevel > 0 || dexLevel > 0 || failStreak > 0) {
      out[wid] = { atkLevel, dexLevel, failStreak };
    }
  }
  return out;
}

export function getWeaponUpgrade(
  upgrades: Record<string, WeaponUpgradeState> | undefined,
  weaponId: string
): WeaponUpgradeState {
  const u = upgrades?.[weaponId];
  if (!u) return createEmptyWeaponUpgrade();
  const atkLevel = Math.max(0, Math.min(MAX_WEAPON_UPGRADE_LEVEL, Math.floor(u.atkLevel || 0)));
  const dexLevel = Math.max(0, Math.min(MAX_WEAPON_UPGRADE_LEVEL - atkLevel, Math.floor(u.dexLevel || 0)));
  const failStreak = Math.max(0, Math.min(10, Math.floor(u.failStreak || 0)));
  return { atkLevel, dexLevel, failStreak };
}

export function computeWeaponAtkPerUpgrade(weaponBaseAtk: number): number {
  return Math.max(3, Math.round(weaponBaseAtk * 0.08) + 2);
}

export const WEAPON_DEX_PER_UPGRADE = 2;

const UPGRADE_TIERS: readonly UpgradeStoneTier[] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3] as const;
const UPGRADE_STONES_REQUIRED = [1, 1, 1, 1, 2, 2, 1, 2, 2, 3] as const;
const UPGRADE_COIN_COSTS = [25, 36, 53, 80, 120, 175, 250, 360, 500, 700] as const;
const UPGRADE_BASE_RATES = [1.0, 1.0, 1.0, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25] as const;

export type WeaponUpgradePreview = {
  stat: WeaponUpgradeStat;
  stoneId: UpgradeStoneId;
  stoneTier: UpgradeStoneTier;
  currentTotalLevel: number;
  maxTotalLevel: number;
  atCap: boolean;
  stonesRequired: number;
  coinCost: number;
  successRate: number;
  statGain: number;
};

/**
 * Computes tiered upgrade cost, required stone tier (초급/중급/고급), success chance
 * (with +5% soft pity per fail up to +25%), and hard +10 cap check.
 * Verified against AGENTS.md Sheet 3 (`3_강화_제련_비용표`).
 */
export function computeUpgradePreview(
  weapon: Pick<WeaponTemplate, "atk">,
  stat: WeaponUpgradeStat,
  current: WeaponUpgradeState
): WeaponUpgradePreview {
  const totalLevel = current.atkLevel + current.dexLevel;
  const atCap = totalLevel >= MAX_WEAPON_UPGRADE_LEVEL;
  const clamped = Math.min(MAX_WEAPON_UPGRADE_LEVEL - 1, Math.max(0, totalLevel));
  const stoneTier = UPGRADE_TIERS[clamped] ?? 3;
  const color: UpgradeStoneColor = stat === "atk" ? "red" : "green";
  const stoneId = getStoneIdForColorAndTier(color, stoneTier);
  const stonesRequired = UPGRADE_STONES_REQUIRED[clamped] ?? 3;
  const coinCost = UPGRADE_COIN_COSTS[clamped] ?? 700;
  const baseRate = atCap ? 0 : (UPGRADE_BASE_RATES[clamped] ?? 0.25);
  const pityBonus = Math.min(0.25, current.failStreak * 0.05);
  const successRate = atCap ? 0 : Math.min(1.0, Number((baseRate + pityBonus).toFixed(2)));
  const statGain = stat === "atk" ? computeWeaponAtkPerUpgrade(weapon.atk) : WEAPON_DEX_PER_UPGRADE;

  return {
    stat,
    stoneId,
    stoneTier,
    currentTotalLevel: totalLevel,
    maxTotalLevel: MAX_WEAPON_UPGRADE_LEVEL,
    atCap,
    stonesRequired,
    coinCost,
    successRate,
    statGain
  };
}

export type EffectiveCombatStats = {
  totalLevel: number;
  atkBonus: number;
  dexBonus: number;
  totalAtk: number;
  totalDex: number;
  critChance: number;
  cooldownSec: number;
};

/**
 * Computes final combat stats incorporating character base ATK/DEX and weapon enhancements
 * (verified in AGENTS.md Sheet 1, Sheet 4, and Sheet 5):
 * - Red Stone (`atkLevel`) boosts raw attack power.
 * - Green Stone (`dexLevel`) boosts attack speed (-3.0% cooldown per upgrade, capped at -38% / 0.14s)
 *   and critical hit chance (+1.8% per upgrade, capped at 65%), while keeping natural level-based
 *   DEX scaling gentle (-0.4% cd / +0.4% crit per baseDex) so high-level players never cap out early.
 */
export function computeEffectiveCombatStats(
  weapon: Pick<WeaponTemplate, "atk" | "critChance" | "cooldown">,
  baseAtk: number,
  baseDex: number,
  upgrade: WeaponUpgradeState
): EffectiveCombatStats {
  const atkBonus = upgrade.atkLevel * computeWeaponAtkPerUpgrade(weapon.atk);
  const dexBonus = upgrade.dexLevel * WEAPON_DEX_PER_UPGRADE;
  const totalAtk = baseAtk + weapon.atk + atkBonus;
  const totalDex = baseDex + dexBonus;
  const critChance = Math.min(
    0.65,
    Number((weapon.critChance + baseDex * 0.004 + dexBonus * 0.009).toFixed(4))
  );
  const cooldownMult = Math.max(0.62, 1 - baseDex * 0.004 - dexBonus * 0.015);
  const cooldownSec = Math.max(0.14, Number((weapon.cooldown * cooldownMult).toFixed(3)));

  return {
    totalLevel: upgrade.atkLevel + upgrade.dexLevel,
    atkBonus,
    dexBonus,
    totalAtk,
    totalDex,
    critChance,
    cooldownSec
  };
}

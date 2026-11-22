/**
 * Economy, 4x6 Inventory, Treasure Chest, Elite Drop, Shop & Weapon Enhancement Domain Module.
 *
 * Pure and deterministic so client, server, and unit tests share identical formulas
 * and anti-abuse invariants.
 */

import type {
  InventoryItemSpec,
  InventorySlot,
  MobTemplate,
  UpgradeStoneId,
  WeaponTemplate,
  WeaponUpgradeStat,
  WeaponUpgradeState
} from "./types";

export const INVENTORY_ROWS = 4;
export const INVENTORY_COLS = 6;
export const INVENTORY_SIZE = INVENTORY_ROWS * INVENTORY_COLS; // 24 slots
export const STONE_MAX_STACK = 20;
export const MAX_WEAPON_UPGRADE_LEVEL = 10;
export const ECONOMY_ACTION_COOLDOWN_MS = 150;

export const UPGRADE_STONE_IDS: readonly UpgradeStoneId[] = [
  "stone_green",
  "stone_blue",
  "stone_orange",
  "stone_red"
] as const;

export const INVENTORY_ITEMS: Record<string, InventoryItemSpec> = {
  stone_red: {
    id: "stone_red",
    name: "붉은 강화석",
    kind: "stone",
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 5,
    color: "#FF5252",
    buyPrice: 60,
    sellPrice: 15,
    upgradeStat: "atk",
    description: "ATK 강화 재료"
  },
  stone_green: {
    id: "stone_green",
    name: "초록 강화석",
    kind: "stone",
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 2,
    color: "#69F0AE",
    buyPrice: 55,
    sellPrice: 14,
    upgradeStat: "dex",
    description: "DEX 강화 재료"
  },
  stone_blue: {
    id: "stone_blue",
    name: "푸른 강화석",
    kind: "stone",
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 3,
    color: "#40C4FF",
    buyPrice: 80,
    sellPrice: 20,
    description: "마력 강화 재료"
  },
  stone_orange: {
    id: "stone_orange",
    name: "주황 강화석",
    kind: "stone",
    stackable: true,
    maxStack: STONE_MAX_STACK,
    sheet: "economy",
    iconIndex: 4,
    color: "#FFAB40",
    buyPrice: 100,
    sellPrice: 25,
    description: "태양 강화 재료"
  },
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
    description: "ATK 강화 재료"
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
    description: "DEX 강화 재료"
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
    description: "마력 강화 재료"
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
    description: "태양 강화 재료"
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
  const next = normalizeInventory(inv);
  const spec = INVENTORY_ITEMS[itemId];
  const want = Math.max(0, Math.floor(quantity));
  if (!spec || want <= 0) return { inventory: next, added: 0, overflow: want };

  let remaining = want;
  // 1. Fill existing stacks first for stackable items (e.g. Upgrade Stones up to 20 per slot)
  if (spec.stackable && spec.maxStack > 1) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const slot = next[i];
      if (slot && slot.itemId === itemId && slot.quantity < spec.maxStack) {
        const take = Math.min(remaining, spec.maxStack - slot.quantity);
        next[i] = { itemId, quantity: slot.quantity + take };
        remaining -= take;
      }
    }
  }
  // 2. Place remaining units into empty slots (respecting maxStack: 20 for stones, 1 for non-stackables)
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
  const next = normalizeInventory(inv);
  const want = Math.max(0, Math.floor(quantity));
  if (want <= 0) return { inventory: next, removed: 0 };

  let remaining = want;
  // Consume from rightmost / partial stacks first so neat stacks stay intact
  for (let i = next.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = next[i];
    if (slot && slot.itemId === itemId) {
      const take = Math.min(remaining, slot.quantity);
      const left = slot.quantity - take;
      next[i] = left > 0 ? { itemId, quantity: left } : null;
      remaining -= take;
    }
  }
  return { inventory: next, removed: want - remaining };
}

export function removeItemAtSlot(
  inv: readonly InventorySlot[],
  slotIndex: number,
  quantity: number
): { inventory: InventorySlot[]; removed: number; itemId: string | null } {
  const next = normalizeInventory(inv);
  const idx = Math.floor(slotIndex);
  const want = Math.max(0, Math.floor(quantity));
  if (idx < 0 || idx >= next.length || want <= 0) {
    return { inventory: next, removed: 0, itemId: null };
  }
  const slot = next[idx];
  if (!slot) return { inventory: next, removed: 0, itemId: null };
  const take = Math.min(want, slot.quantity);
  const left = slot.quantity - take;
  next[idx] = left > 0 ? { itemId: slot.itemId, quantity: left } : null;
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

export function pickUpgradeStoneForStage(stageNumber: number, colorRoll01: number): UpgradeStoneId {
  const r = Math.max(0, Math.min(0.9999, Number.isFinite(colorRoll01) ? colorRoll01 : 0.5));
  const s = Math.max(1, Math.floor(stageNumber));
  // Early stages emphasize Red (ATK) & Green (DEX) so players can start enhancing right away;
  // Mid & high stages introduce more Blue & Orange stones for future effect-imbuing!
  if (s <= 2) {
    if (r < 0.44) return "stone_red";
    if (r < 0.84) return "stone_green";
    if (r < 0.94) return "stone_blue";
    return "stone_orange";
  }
  if (s <= 5) {
    if (r < 0.34) return "stone_red";
    if (r < 0.66) return "stone_green";
    if (r < 0.86) return "stone_blue";
    return "stone_orange";
  }
  if (r < 0.28) return "stone_red";
  if (r < 0.54) return "stone_green";
  if (r < 0.78) return "stone_blue";
  return "stone_orange";
}

/**
 * Rare upgrade stone roll when opening a Treasure Chest.
 */
export function rollChestStoneDrop(
  stageNumber: number,
  chanceRoll01: number,
  colorRoll01: number
): { itemId: UpgradeStoneId; quantity: number } | null {
  const s = Math.max(1, Math.floor(stageNumber));
  const chance = Math.min(0.55, 0.28 + s * 0.025);
  if (chanceRoll01 >= chance) return null;
  const itemId = pickUpgradeStoneForStage(s, colorRoll01);
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
  colorRoll01: number
): { itemId: UpgradeStoneId; quantity: number } | null {
  if (!mobTpl.isElite && !mobTpl.isBoss) return null;
  const chance = mobTpl.isBoss ? 0.48 : 0.22;
  if (chanceRoll01 >= chance) return null;
  const itemId = pickUpgradeStoneForStage(stageNumber, colorRoll01);
  return { itemId, quantity: 1 };
}

// ==================== CHARACTER DEX & WEAPON ENHANCEMENT ====================

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

const UPGRADE_BASE_RATES = [1.0, 1.0, 1.0, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25] as const;

export type WeaponUpgradePreview = {
  stat: WeaponUpgradeStat;
  stoneId: UpgradeStoneId;
  currentTotalLevel: number;
  maxTotalLevel: number;
  atCap: boolean;
  stonesRequired: number;
  coinCost: number;
  successRate: number;
  statGain: number;
};

/**
 * Computes upgrade cost, success chance (with soft pity), and hard cap check.
 * Anti-abuse safeguards:
 * - Hard total cap of +10 per weapon (cannot upgrade infinitely).
 * - Escalating stone count (1..4) and exponential coin fee.
 * - Diminishing success rate at high levels without destroying the weapon.
 */
export function computeUpgradePreview(
  weapon: Pick<WeaponTemplate, "atk">,
  stat: WeaponUpgradeStat,
  current: WeaponUpgradeState
): WeaponUpgradePreview {
  const totalLevel = current.atkLevel + current.dexLevel;
  const atCap = totalLevel >= MAX_WEAPON_UPGRADE_LEVEL;
  const stoneId: UpgradeStoneId = stat === "atk" ? "stone_red" : "stone_green";
  const clamped = Math.min(MAX_WEAPON_UPGRADE_LEVEL - 1, Math.max(0, totalLevel));
  const stonesRequired = 1 + Math.floor(clamped / 3);
  const coinCost = Math.round(25 * Math.pow(1.45, clamped));
  const baseRate = atCap ? 0 : (UPGRADE_BASE_RATES[clamped] ?? 0.25);
  const pityBonus = Math.min(0.25, current.failStreak * 0.05);
  const successRate = atCap ? 0 : Math.min(1.0, Number((baseRate + pityBonus).toFixed(2)));
  const statGain = stat === "atk" ? computeWeaponAtkPerUpgrade(weapon.atk) : WEAPON_DEX_PER_UPGRADE;

  return {
    stat,
    stoneId,
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
 * Computes final combat stats incorporating character base ATK/DEX and weapon enhancements.
 * - Red Stone (ATK) boosts raw attack power.
 * - Green Stone (DEX) boosts critical hit chance (+0.6% per DEX, capped at 65%)
 *   and attack speed (-0.8% cooldown per DEX, capped at -30%).
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
  const critChance = Math.min(0.65, Number((weapon.critChance + totalDex * 0.006).toFixed(4)));
  const cooldownMult = Math.max(0.7, 1 - totalDex * 0.008);
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

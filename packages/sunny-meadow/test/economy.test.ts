import { describe, expect, it } from "vitest";
import { ITEM_CATALOG, MOB_CATALOG, WEAPON_CATALOG } from "../src/catalogs";
import {
  addItemToInventory,
  canAddItemToInventory,
  computeChestCoinReward,
  computeEffectiveCombatStats,
  computePlayerBaseDex,
  computeUpgradePreview,
  countItemInInventory,
  createEmptyInventory,
  createEmptyWeaponUpgrade,
  INVENTORY_COLS,
  INVENTORY_ROWS,
  INVENTORY_SIZE,
  INVENTORY_ITEMS,
  MAX_WEAPON_UPGRADE_LEVEL,
  removeItemAtSlot,
  removeItemFromInventory,
  rollChestStoneDrop,
  rollEliteStoneDrop,
  SHOP_OFFERS,
  STONE_MAX_STACK,
  UPGRADE_STONE_IDS
} from "../src/economy";

describe("@bighouse/sunny-meadow economy, 4x6 inventory, chests & weapon upgrades", () => {
  it("provides a 4x6 (24-slot) inventory that stacks upgrade stones up to 20 and keeps non-stackables separate", () => {
    expect(INVENTORY_ROWS).toBe(4);
    expect(INVENTORY_COLS).toBe(6);
    expect(INVENTORY_SIZE).toBe(24);
    expect(STONE_MAX_STACK).toBe(20);

    let inv = createEmptyInventory();
    expect(inv).toHaveLength(24);

    // Adding 25 red stones fills slot 0 to 20 and spills 5 into slot 1
    const r1 = addItemToInventory(inv, "stone_red", 25);
    expect(r1.added).toBe(25);
    expect(r1.overflow).toBe(0);
    expect(r1.inventory[0]).toEqual({ itemId: "stone_red", quantity: 20 });
    expect(r1.inventory[1]).toEqual({ itemId: "stone_red", quantity: 5 });
    expect(countItemInInventory(r1.inventory, "stone_red")).toBe(25);
    inv = r1.inventory;

    // Non-stackable lucky_charm occupies separate single slots even when added in quantity 2
    const r2 = addItemToInventory(inv, "lucky_charm", 2);
    expect(r2.added).toBe(2);
    expect(r2.inventory[2]).toEqual({ itemId: "lucky_charm", quantity: 1 });
    expect(r2.inventory[3]).toEqual({ itemId: "lucky_charm", quantity: 1 });
    inv = r2.inventory;

    // Removing 8 red stones drains the partial stack first, then trims the full stack cleanly
    const r3 = removeItemFromInventory(inv, "stone_red", 8);
    expect(r3.removed).toBe(8);
    expect(r3.inventory[1]).toBeNull();
    expect(r3.inventory[0]).toEqual({ itemId: "stone_red", quantity: 17 });

    // Slot-specific removal
    const r4 = removeItemAtSlot(r3.inventory, 2, 1);
    expect(r4.removed).toBe(1);
    expect(r4.itemId).toBe("lucky_charm");
    expect(r4.inventory[2]).toBeNull();
    expect(canAddItemToInventory(r4.inventory, "stone_green", 40)).toBe(true);
  });

  it("defines 4 colored upgrade stones and enforces anti-arbitrage shop pricing (sell << buy)", () => {
    expect(UPGRADE_STONE_IDS).toEqual(["stone_green", "stone_blue", "stone_orange", "stone_red"]);
    expect(ITEM_CATALOG.treasure_chest?.category).toBe("chest");

    for (const id of UPGRADE_STONE_IDS) {
      const spec = INVENTORY_ITEMS[id]!;
      expect(spec.maxStack).toBe(20);
      expect(spec.buyPrice).toBeGreaterThan(0);
      // Selling must always yield <= 30% of buy price so buy->sell coin farming is impossible
      expect(spec.sellPrice).toBeLessThanOrEqual(Math.floor(spec.buyPrice! * 0.3));
    }

    for (const offer of SHOP_OFFERS) {
      expect(offer.buyPrice).toBeGreaterThan(0);
      if (offer.sellPrice > 0) {
        expect(offer.sellPrice).toBeLessThan(offer.buyPrice * 0.35);
      }
    }
  });

  it("scales treasure chest coin hauls strictly upward across stages 1..10 and restricts stone drops to elites/chests", () => {
    for (let s = 1; s < 10; s++) {
      expect(computeChestCoinReward(s + 1)).toBeGreaterThan(computeChestCoinReward(s));
    }
    expect(computeChestCoinReward(1)).toBeGreaterThanOrEqual(30);
    expect(computeChestCoinReward(10)).toBeGreaterThanOrEqual(300);

    // Normal mobs never drop upgrade stones; elite & boss mobs do on rare rolls
    expect(rollEliteStoneDrop(MOB_CATALOG.red_mushroom!, 1, 0.01, 0.2)).toBeNull();
    expect(rollEliteStoneDrop(MOB_CATALOG.yellow_hamster!, 1, 0.01, 0.2)).toBeNull();
    expect(rollEliteStoneDrop(MOB_CATALOG.elder_hamster!, 1, 0.05, 0.2)).toEqual({
      itemId: "stone_red",
      quantity: 1
    });
    expect(rollEliteStoneDrop(MOB_CATALOG.elder_hamster!, 1, 0.9, 0.2)).toBeNull();
    expect(rollEliteStoneDrop(MOB_CATALOG.king_mushroom!, 4, 0.35, 0.7)).toEqual({
      itemId: "stone_blue",
      quantity: 1
    });

    // Chest rare stone roll
    expect(rollChestStoneDrop(5, 0.1, 0.95)).toEqual({ itemId: "stone_orange", quantity: 1 });
    expect(rollChestStoneDrop(5, 0.95, 0.5)).toBeNull();
  });

  it("caps weapon upgrades at +10, escalates costs, and applies red (ATK) & green (DEX) combat bonuses safely", () => {
    const sword = WEAPON_CATALOG.leaf_blade!;
    const lv0 = computeUpgradePreview(sword, "atk", createEmptyWeaponUpgrade());
    const lv5 = computeUpgradePreview(sword, "atk", { atkLevel: 3, dexLevel: 2, failStreak: 0 });
    const lv9 = computeUpgradePreview(sword, "dex", { atkLevel: 5, dexLevel: 4, failStreak: 0 });
    const lv10 = computeUpgradePreview(sword, "atk", { atkLevel: 6, dexLevel: 4, failStreak: 0 });

    expect(lv0.stoneId).toBe("stone_red");
    expect(lv9.stoneId).toBe("stone_green");
    expect(lv0.successRate).toBe(1.0);
    expect(lv5.coinCost).toBeGreaterThan(lv0.coinCost);
    expect(lv9.stonesRequired).toBeGreaterThan(lv0.stonesRequired);
    expect(lv9.successRate).toBeLessThan(lv5.successRate);
    expect(lv10.atCap).toBe(true);
    expect(lv10.maxTotalLevel).toBe(MAX_WEAPON_UPGRADE_LEVEL);

    // Pity increases success rate after consecutive failures without exceeding 100%
    const lv9Pity = computeUpgradePreview(sword, "dex", { atkLevel: 5, dexLevel: 4, failStreak: 3 });
    expect(lv9Pity.successRate).toBeGreaterThan(lv9.successRate);

    // Combat stats reflect ATK + DEX bonuses with safe caps
    const baseStats = computeEffectiveCombatStats(sword, 10, computePlayerBaseDex(1), createEmptyWeaponUpgrade());
    const upStats = computeEffectiveCombatStats(sword, 10, computePlayerBaseDex(1), {
      atkLevel: 4,
      dexLevel: 4,
      failStreak: 0
    });
    expect(upStats.totalAtk).toBeGreaterThan(baseStats.totalAtk);
    expect(upStats.totalDex).toBe(baseStats.totalDex + 8);
    expect(upStats.critChance).toBeGreaterThan(baseStats.critChance);
    expect(upStats.cooldownSec).toBeLessThan(baseStats.cooldownSec);
  });
});

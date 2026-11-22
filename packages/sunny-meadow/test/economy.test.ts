import { describe, expect, it } from "vitest";
import type { RoomState } from "@bighouse/game-sdk/server";
import { ITEM_CATALOG, MOB_CATALOG, WEAPON_CATALOG } from "../src/catalogs";
import {
  addItemToInventory,
  ALL_UPGRADE_STONE_IDS,
  canAddItemToInventory,
  canDismantleItem,
  computeChestCoinReward,
  computeDismantleYield,
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
  POWDER_MAX_STACK,
  removeItemAtSlot,
  removeItemFromInventory,
  rollChestStoneDrop,
  rollEliteStoneDrop,
  SHOP_OFFERS,
  SMELTING_RECIPES,
  SMELTING_RECIPES_BY_ID,
  STONE_MAX_STACK,
  STONE_POWDER_ITEM_ID,
  UPGRADE_STONE_IDS
} from "../src/economy";
import { validateNormalizedStage } from "../src/map-schema";
import { createMenuModeSync } from "../src/menu-mode-sync";
import { sunnyMeadowDefinition } from "../src/server";
import { ALL_STAGES } from "../src/stages/index";

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
    expect(lv0.stoneTier).toBe(1);
    expect(lv5.stoneId).toBe("stone_red_t2");
    expect(lv5.stoneTier).toBe(2);
    expect(lv9.stoneId).toBe("stone_green_t3");
    expect(lv9.stoneTier).toBe(3);
    expect(lv0.successRate).toBe(1.0);
    expect(lv5.coinCost).toBeGreaterThan(lv0.coinCost);
    expect(lv9.stonesRequired).toBeGreaterThan(lv0.stonesRequired);
    expect(lv9.successRate).toBeLessThan(lv5.successRate);
    expect(lv10.atCap).toBe(true);
    expect(lv10.maxTotalLevel).toBe(MAX_WEAPON_UPGRADE_LEVEL);

    // Pity increases success rate after consecutive failures without exceeding 100%
    const lv9Pity = computeUpgradePreview(sword, "dex", { atkLevel: 5, dexLevel: 4, failStreak: 3 });
    expect(lv9Pity.successRate).toBeGreaterThan(lv9.successRate);

    // Combat stats reflect ATK + DEX bonuses with safe caps, and mixed builds stay viable at mid/end-game
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

    // Even at Lv.60, green attack-speed upgrades still reduce cooldown (not capped out by baseDex alone)
    const nebula = WEAPON_CATALOG.nebula_staff!;
    const lv60Base = computeEffectiveCombatStats(nebula, 242, computePlayerBaseDex(60), createEmptyWeaponUpgrade());
    const lv60Speed = computeEffectiveCombatStats(nebula, 242, computePlayerBaseDex(60), { atkLevel: 0, dexLevel: 4, failStreak: 0 });
    expect(lv60Speed.cooldownSec).toBeLessThan(lv60Base.cooldownSec);
  });

  it("enforces 3-tier stones (초급/중급/고급), powder dismantling, and zero-arbitrage smelting invariants", () => {
    expect(ALL_UPGRADE_STONE_IDS).toHaveLength(12);
    expect(INVENTORY_ITEMS.stone_red?.name).toBe("초급 붉은 강화석");
    expect(INVENTORY_ITEMS.stone_green?.name).toBe("초급 초록 강화석");
    expect(INVENTORY_ITEMS.stone_blue?.name).toBe("초급 푸른 강화석");
    expect(INVENTORY_ITEMS.stone_orange?.name).toBe("초급 주황 강화석");
    expect(INVENTORY_ITEMS[STONE_POWDER_ITEM_ID]?.maxStack).toBe(POWDER_MAX_STACK);

    const powderSell = INVENTORY_ITEMS[STONE_POWDER_ITEM_ID]!.sellPrice;
    const powderBasisCost = INVENTORY_ITEMS.stone_red!.buyPrice! / INVENTORY_ITEMS.stone_red!.dismantlePowder!; // 20c

    for (const recipe of SMELTING_RECIPES) {
      const spec = INVENTORY_ITEMS[recipe.outputItemId]!;
      expect(canDismantleItem(spec.id)).toBe(true);
      const dismantleYield = computeDismantleYield(spec.id, 1);
      // 1) No powder duplication loop: dismantling always returns strictly less than smelting consumes
      expect(dismantleYield / recipe.powderCost).toBeLessThan(0.75);
      // 2) Dismantle -> sell powder never beats selling the stone directly
      expect(dismantleYield * powderSell).toBeLessThan(spec.sellPrice);
      // 3) Selling a stone yields <= 30% of its buy or smelted basis cost
      const basisCost = spec.buyPrice ?? recipe.powderCost * powderBasisCost + recipe.coinCost;
      expect(spec.sellPrice / basisCost).toBeLessThanOrEqual(0.3);
      // 4) Smelting Tier 1 is a color-conversion sink, never cheaper than shop buyPrice
      if (spec.buyPrice) {
        expect(recipe.powderCost * powderBasisCost + recipe.coinCost).toBeGreaterThanOrEqual(spec.buyPrice);
      }
    }

    // High-stage drops can yield 중급 (t2) and 고급 (t3) stones
    expect(rollChestStoneDrop(5, 0.1, 0.1, 0.85)?.itemId).toBe("stone_red_t2");
    expect(rollChestStoneDrop(10, 0.1, 0.1, 0.9)?.itemId).toBe("stone_red_t3");
  });

  it("executes server-authoritative dismantleItem and smeltStone actions and gates +4 upgrades on 중급 stones", () => {
    const now = 1_700_004_000_000;
    const room = {
      roomId: "room-smelt",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    const p1 = { playerId: "p1", displayName: "제련사", seat: 0, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [p1],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;

    // Seed player with 4 초급 붉은 강화석 (12 powder when dismantled), 500 coins, and a +3 weapon
    const seededInv = addItemToInventory(createEmptyInventory(), "stone_red", 4).inventory;
    Object.assign(state.playerStates.p1!, {
      coins: 500,
      inventory: seededInv,
      weaponUpgrades: { wooden_sword: { atkLevel: 2, dexLevel: 1, failStreak: 0 } }
    });

    // Upgrading +3 -> +4 with only 초급 stones must fail (requires 중급 붉은 강화석)
    const blockedUpgrade = sunnyMeadowDefinition.applyAction(
      { state, now: now + 200 },
      { playerId: "p1", clientActionId: "u_block", expectedVersion: 0, type: "upgradeWeapon", payload: { weaponId: "wooden_sword", stat: "atk" } }
    );
    expect(blockedUpgrade.events).toContainEqual(
      expect.objectContaining({ type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "insufficient_stones" }) })
    );

    // Dismantle all 4 초급 붉은 강화석 -> yields 12 강화석 가루
    const dismantled = sunnyMeadowDefinition.applyAction(
      { state, now: now + 500 },
      { playerId: "p1", clientActionId: "dis1", expectedVersion: 0, type: "dismantleItem", payload: { slotIndex: 0, quantity: 4 } }
    );
    state = dismantled.state;
    expect(dismantled.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.itemDismantled",
        payload: expect.objectContaining({ itemId: "stone_red", quantity: 4, powderGained: 12 })
      })
    );
    expect(countItemInInventory((state.playerStates.p1 as { inventory: typeof seededInv }).inventory, STONE_POWDER_ITEM_ID)).toBe(12);

    // Smelt 1 중급 붉은 강화석 (12 가루 + 90 코인)
    const recipe = SMELTING_RECIPES_BY_ID.smelt_red_t2!;
    const smelted = sunnyMeadowDefinition.applyAction(
      { state, now: now + 800 },
      { playerId: "p1", clientActionId: "sm1", expectedVersion: 0, type: "smeltStone", payload: { recipeId: recipe.id, quantity: 1 } }
    );
    state = smelted.state;
    expect(smelted.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.stoneSmelted",
        payload: expect.objectContaining({ itemId: "stone_red_t2", quantity: 1, powderSpent: 12, coinsSpent: 90 })
      })
    );
    expect((state.playerStates.p1 as { coins: number }).coins).toBe(500 - 90);
    expect(countItemInInventory((state.playerStates.p1 as { inventory: typeof seededInv }).inventory, "stone_red_t2")).toBe(1);

    // Now +3 -> +4 upgrade consumes the smelted 중급 붉은 강화석
    const upgraded = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1100 },
      { playerId: "p1", clientActionId: "u_t2", expectedVersion: 0, type: "upgradeWeapon", payload: { weaponId: "wooden_sword", stat: "atk" } }
    );
    expect(upgraded.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.weaponUpgraded",
        payload: expect.objectContaining({ stoneId: "stone_red_t2", stonesSpent: 1, coinsSpent: 80 })
      })
    );
  });

  it("places rare elite-guarded treasure chests across all 10 stages with 100% map validity", () => {
    for (const stage of ALL_STAGES) {
      const report = validateNormalizedStage(stage);
      expect(report.valid, `${stage.meta.id}: ${report.errors.join(", ")}`).toBe(true);

      const chests = stage.layers.itemSpawns.allIds
        .map((id) => stage.layers.itemSpawns.byId[id]!)
        .filter((it) => it.templateId === "treasure_chest");
      expect(chests.length, `${stage.meta.id} chests`).toBeGreaterThanOrEqual(2);

      const eliteMobs = stage.layers.mobSpawns.allIds
        .map((id) => stage.layers.mobSpawns.byId[id]!)
        .filter((m) => Boolean(MOB_CATALOG[m.templateId]?.isElite));
      expect(eliteMobs.length, `${stage.meta.id} elite guards`).toBeGreaterThanOrEqual(2);

      for (const ch of chests) {
        const guarded = eliteMobs.some((m) => Math.abs(m.x - ch.x) <= 6 && Math.abs(m.y - (ch.y + 1)) <= 2);
        expect(guarded, `${stage.meta.id} chest ${ch.id} should be guarded by an elite mob`).toBe(true);
      }
    }
  });

  it("runs server-authoritative chest opening, menu safe mode, shop buy/sell, weapon upgrades & D1 persistence", () => {
    const now = 1_700_002_000_000;
    const room = {
      roomId: "room-econ",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    const p1 = { playerId: "p1", displayName: "상인", seat: 0, connected: true, ready: true, joinedAt: now };
    const p2 = { playerId: "p2", displayName: "관전자", seat: 1, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [p1, p2],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p2, null).state;

    // 1. Opening a Stage 1 Treasure Chest awards stage-scaled coins and blocks race duplication
    const open1 = sunnyMeadowDefinition.applyAction(
      { state, now: now + 100 },
      { playerId: "p1", clientActionId: "ch1", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_chest_boss" } }
    );
    state = open1.state;
    expect((state.playerStates.p1 as { coins: number }).coins).toBe(computeChestCoinReward(1));
    expect(open1.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.chestOpened",
        payload: expect.objectContaining({ itemId: "s1_chest_boss", coins: computeChestCoinReward(1) })
      })
    );
    const open2Race = sunnyMeadowDefinition.applyAction(
      { state, now: now + 200 },
      { playerId: "p2", clientActionId: "ch2", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_chest_boss" } }
    );
    expect((open2Race.state.playerStates.p2 as { coins: number }).coins).toBe(0);

    // 2. Menu safe mode blocks damage & broadcasts inMenu: true to remote players
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 300 },
      { playerId: "p1", clientActionId: "menu_on", expectedVersion: 0, type: "setMenuMode", payload: { inMenu: true } }
    ).state;
    const pubForP2 = sunnyMeadowDefinition.getPublicView({ state, now: now + 310 }, "p2") as {
      nearbyPlayers: Array<{ playerId: string; inMenu?: boolean }>;
    };
    expect(pubForP2.nearbyPlayers.find((p) => p.playerId === "p1")?.inMenu).toBe(true);
    const hurtInMenu = sunnyMeadowDefinition.applyAction(
      { state, now: now + 350 },
      { playerId: "p1", clientActionId: "hurt_menu", expectedVersion: 0, type: "playerHurt", payload: { amount: 30 } }
    );
    expect((hurtInMenu.state.playerStates.p1 as { hp: number }).hp).toBe(100);

    // 3. Shop Buy & Sell (with unfavorable sell price)
    Object.assign(state.playerStates.p1!, { coins: 500 });
    const buyRed = sunnyMeadowDefinition.applyAction(
      { state, now: now + 600 },
      { playerId: "p1", clientActionId: "buy1", expectedVersion: 0, type: "shopBuy", payload: { offerId: "offer_stone_red", quantity: 3 } }
    );
    state = buyRed.state;
    expect((state.playerStates.p1 as { coins: number }).coins).toBe(500 - 180);

    const buyGreen = sunnyMeadowDefinition.applyAction(
      { state, now: now + 900 },
      { playerId: "p1", clientActionId: "buy2", expectedVersion: 0, type: "shopBuy", payload: { offerId: "offer_stone_green", quantity: 2 } }
    );
    state = buyGreen.state;
    expect((state.playerStates.p1 as { coins: number }).coins).toBe(320 - 110);

    // Sell 1 red stone from slot 0 -> receives 15 coins (much less than 60 buy price!)
    const sellOne = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1200 },
      { playerId: "p1", clientActionId: "sell1", expectedVersion: 0, type: "shopSell", payload: { slotIndex: 0, quantity: 1 } }
    );
    state = sellOne.state;
    expect((state.playerStates.p1 as { coins: number }).coins).toBe(210 + 15);

    // 4. Weapon Enhancement: Red stone -> ATK (+1), Green stone -> DEX (+1) (100% rate at +0..+2!)
    const upgAtk = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1500 },
      { playerId: "p1", clientActionId: "upg1", expectedVersion: 0, type: "upgradeWeapon", payload: { weaponId: "wooden_sword", stat: "atk" } }
    );
    state = upgAtk.state;
    expect(upgAtk.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.weaponUpgraded",
        payload: expect.objectContaining({ weaponId: "wooden_sword", stat: "atk", success: true, atkLevel: 1 })
      })
    );

    const upgDex = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1800 },
      { playerId: "p1", clientActionId: "upg2", expectedVersion: 0, type: "upgradeWeapon", payload: { weaponId: "wooden_sword", stat: "dex" } }
    );
    state = upgDex.state;
    expect(upgDex.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.weaponUpgraded",
        payload: expect.objectContaining({ weaponId: "wooden_sword", stat: "dex", success: true, dexLevel: 1, totalLevel: 2 })
      })
    );

    // 5. Hard +10 cap prevents infinite enhancement even with abundant stones & coins
    Object.assign(state.playerStates.p1!, {
      coins: 99999,
      weaponUpgrades: { wooden_sword: { atkLevel: 6, dexLevel: 4, failStreak: 0 } }
    });
    const capped = sunnyMeadowDefinition.applyAction(
      { state, now: now + 2100 },
      { playerId: "p1", clientActionId: "upg_cap", expectedVersion: 0, type: "upgradeWeapon", payload: { weaponId: "wooden_sword", stat: "atk" } }
    );
    expect(capped.events).toContainEqual(
      expect.objectContaining({ type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "upgrade_maxed" }) })
    );

    // 6. Profile persistence preserves inventory & weaponUpgrades cleanly
    const profile = sunnyMeadowDefinition.extractPlayerProfile!({ state, now: now + 2200 }, "p1") as {
      inventory?: unknown[];
      weaponUpgrades?: Record<string, { atkLevel: number; dexLevel: number }>;
    };
    expect(profile.inventory).toHaveLength(24);
    expect(profile.weaponUpgrades?.wooden_sword).toMatchObject({ atkLevel: 6, dexLevel: 4 });
  });

  it("excludes inMenu players from server-side mob authority selection so nearby active players can sync mobs", () => {
    const now = 1_700_003_000_000;
    const room = {
      roomId: "room-mob-auth",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    const p1 = { playerId: "p1", displayName: "가까운유저", seat: 0, connected: true, ready: true, joinedAt: now };
    const p2 = { playerId: "p2", displayName: "활동유저", seat: 1, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [p1, p2],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p2, null).state;

    const stageRt = (state.stageState as { stages: Record<string, { mobs: Record<string, { x: number; y: number; spawnProtectUntil: number; authorityPlayerId?: string }> }> }).stages["stage-1"]!;
    const [mobId, mob] = Object.entries(stageRt.mobs)[0]!;
    mob.spawnProtectUntil = 0;
    const baseX = mob.x;
    const baseY = mob.y;

    // Place p1 right beside the mob and p2 320px away (well beyond the 140-160px hysteresis margin).
    Object.assign(state.playerStates.p1!, { x: baseX, y: baseY });
    Object.assign(state.playerStates.p2!, { x: baseX + 320, y: baseY });

    // While p1 is active, p1 holds authority and p2's mob kinematics update is rejected.
    const p1Sync = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 100 },
      "p1",
      { type: "playerPose", payload: { x: baseX, y: baseY, vx: 0, vy: 0, facing: 1, animState: "idle", mobs: [[mobId, baseX + 12, baseY, 40, 0, 1]] } }
    );
    expect(p1Sync?.payload.mobs).toHaveLength(1);
    expect(mob.authorityPlayerId).toBe("p1");

    const p2Rejected = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 150 },
      "p2",
      { type: "playerPose", payload: { x: baseX + 320, y: baseY, vx: 0, vy: 0, facing: -1, animState: "walk", mobs: [[mobId, baseX + 30, baseY, 60, 0, 1]] } }
    );
    expect(p2Rejected?.payload.mobs).toBeUndefined();

    // Once p1 opens inventory/shop (inMenu: true), p1 is excluded and p2 immediately takes mob authority.
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 200 },
      { playerId: "p1", clientActionId: "menu1", expectedVersion: 0, type: "setMenuMode", payload: { inMenu: true } }
    ).state;

    const p1Ignored = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 250 },
      "p1",
      { type: "playerPose", payload: { x: baseX, y: baseY, vx: 0, vy: 0, facing: 1, animState: "idle", mobs: [[mobId, baseX + 5, baseY, 10, 0, 1]] } }
    );
    expect(p1Ignored).toBeUndefined();

    const p2Accepted = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 260 },
      "p2",
      { type: "playerPose", payload: { x: baseX + 320, y: baseY, vx: 0, vy: 0, facing: -1, animState: "walk", mobs: [[mobId, baseX + 48, baseY, 75, 0, 1]] } }
    );
    expect(p2Accepted?.payload.mobs).toEqual([[mobId, baseX + 48, baseY, 75, 0, 1]]);
    const updatedMob = (p2Accepted?.stageState as typeof state.stageState & { stages: Record<string, { mobs: Record<string, { x: number; authorityPlayerId?: string }> }> }).stages["stage-1"]!.mobs[mobId]!;
    expect(updatedMob.x).toBe(baseX + 48);
    expect(updatedMob.authorityPlayerId).toBe("p2");
  });

  it("reconciles menu mode after refresh or offline dialog transitions when the connection is restored", () => {
    // 1. Page refresh while server still retains inMenu: true during disconnect grace period
    const afterRefresh = createMenuModeSync();
    afterRefresh.observeServer(true);
    expect(afterRefresh.shouldResync({ connected: true, desired: false, now: 1000 })).toBe(true);
    afterRefresh.markSent(1000);
    // Avoid spamming before throttle interval elapses
    expect(afterRefresh.shouldResync({ connected: true, desired: false, now: 1100 })).toBe(false);
    // Once server confirms inMenu: false, no further resync needed
    afterRefresh.observeServer(false);
    expect(afterRefresh.shouldResync({ connected: true, desired: false, now: 2000 })).toBe(false);

    // 2. Dialog closed while disconnected, then socket reconnects
    const offlineClose = createMenuModeSync();
    offlineClose.observeServer(true);
    expect(offlineClose.shouldResync({ connected: false, desired: false, now: 1000 })).toBe(false);
    expect(offlineClose.shouldResync({ connected: true, desired: false, now: 1050, force: true })).toBe(true);

    // 3. Dialog opened while disconnected, then socket reconnects
    const offlineOpen = createMenuModeSync();
    offlineOpen.observeServer(false);
    expect(offlineOpen.shouldResync({ connected: false, desired: true, now: 1000 })).toBe(false);
    expect(offlineOpen.shouldResync({ connected: true, desired: true, now: 1050, force: true })).toBe(true);
  });
});

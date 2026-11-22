import { describe, expect, it } from "vitest";
import {
  clientPointToCanvasLogical,
  computeWeaponSlotHitboxes,
  createHudClickController,
  hitTestHudPoint,
  hitTestWeaponSlotPoint,
  HUD_COIN_HITBOX,
  HUD_STATUS_HITBOX
} from "../src/hud-interactions";

describe("@bighouse/sunny-meadow HUD hitboxes & click activation", () => {
  it("separates top-left character status (inventory) and top-right coin pill (shop) hitboxes", () => {
    // Center of top-left character status card -> inventory
    expect(
      hitTestHudPoint(HUD_STATUS_HITBOX.x + HUD_STATUS_HITBOX.w / 2, HUD_STATUS_HITBOX.y + HUD_STATUS_HITBOX.h / 2)
    ).toBe("inventory");

    // Center of top-right coin/shop badge -> shop
    expect(
      hitTestHudPoint(HUD_COIN_HITBOX.x + HUD_COIN_HITBOX.w / 2, HUD_COIN_HITBOX.y + HUD_COIN_HITBOX.h / 2)
    ).toBe("shop");

    // Middle of canvas -> null
    expect(hitTestHudPoint(480, 288)).toBeNull();
  });

  it("maps scaled CSS canvas coordinates accurately to logical 960x576 coordinates", () => {
    const rect = { left: 100, top: 50, width: 480, height: 288 }; // 0.5x scale
    const shopClientX = rect.left + (HUD_COIN_HITBOX.x + 20) * 0.5;
    const shopClientY = rect.top + (HUD_COIN_HITBOX.y + 10) * 0.5;
    const logical = clientPointToCanvasLogical(shopClientX, shopClientY, rect);
    expect(logical).not.toBeNull();
    expect(hitTestHudPoint(logical!.x, logical!.y)).toBe("shop");
    expect(clientPointToCanvasLogical(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it("activates only on matching primary click and rejects drags, cancellations, and non-primary buttons", () => {
    const ctrl = createHudClickController();

    // Direct programmatic click (no prior pointerdown) activates cleanly
    expect(ctrl.onClick("shop")).toBe("shop");

    // Pressing down on shop arms it; releasing & clicking on shop activates shop
    ctrl.onPointerDown("shop", 0);
    expect(ctrl.onClick("shop")).toBe("shop");

    // Pressing down on status card arms inventory; clicking on status activates inventory
    ctrl.onPointerDown("inventory", 0);
    expect(ctrl.onClick("inventory")).toBe("inventory");

    // Pressing outside and releasing inside shop must NOT open shop
    ctrl.onPointerDown(null, 0);
    expect(ctrl.onClick("shop")).toBeNull();

    // Pressing on shop and dragging to inventory must NOT open either
    ctrl.onPointerDown("shop", 0);
    expect(ctrl.onClick("inventory")).toBeNull();

    // Cancelled pointer gesture rejects the trailing click, then a fresh click works
    ctrl.onPointerDown("shop", 0);
    ctrl.onPointerCancel();
    expect(ctrl.onClick("shop")).toBeNull();
    expect(ctrl.onClick("shop")).toBe("shop");

    // Non-primary mouse button rejects activation rather than clearing the guard
    ctrl.onPointerDown("shop", 2);
    expect(ctrl.onClick("shop")).toBeNull();
  });

  it("computes bottom-center weapon slot hitboxes and resolves direct touch/click targets", () => {
    const unlocked = ["wooden_sword", "leaf_blade", "star_wand", "golden_hammer"];
    const { barRect, slots } = computeWeaponSlotHitboxes(unlocked);

    expect(slots).toHaveLength(4);
    expect(barRect.y).toBe(518);
    expect(barRect.h).toBe(48);

    // Every slot center hits its exact weaponId without overlapping neighbors
    for (const slot of slots) {
      expect(
        hitTestWeaponSlotPoint(slot.rect.x + slot.rect.w / 2, slot.rect.y + slot.rect.h / 2, unlocked)
      ).toBe(slot.weaponId);
    }

    // Outside weapon bar returns null
    expect(hitTestWeaponSlotPoint(480, 200, unlocked)).toBeNull();
    expect(hitTestWeaponSlotPoint(barRect.x - 20, barRect.y + 20, unlocked)).toBeNull();

    // More than 6 unlocked weapons displays only the latest 6 slots (matching renderer)
    const eight = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"];
    const capped = computeWeaponSlotHitboxes(eight);
    expect(capped.slots.map((s) => s.weaponId)).toEqual(["w3", "w4", "w5", "w6", "w7", "w8"]);
  });
});

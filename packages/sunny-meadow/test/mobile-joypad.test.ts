import { describe, expect, it } from "vitest";
import {
  createMobileJoypadController,
  DEFAULT_JOYPAD_CONFIG,
  evaluateJoypadVector
} from "../src/mobile-joypad";

describe("@bighouse/sunny-meadow mobile floating joypad", () => {
  it("stays neutral within the deadzone and resolves left, right, up, down, and diagonals cleanly", () => {
    // Inside deadzone -> no direction active, knob still follows finger smoothly
    const dead = evaluateJoypadVector(8, -5);
    expect(dead.knobX).toBeCloseTo(8, 5);
    expect(dead.knobY).toBeCloseTo(-5, 5);
    expect(dead.directions).toEqual({ left: false, right: false, up: false, down: false });

    // Running right with slight upward thumb drift -> strictly right (no accidental portal/ladder up)
    const slightDriftRight = evaluateJoypadVector(36, -12);
    expect(slightDriftRight.directions).toEqual({ left: false, right: true, up: false, down: false });

    // Running left with slight downward thumb drift -> strictly left (no accidental drop-through)
    const slightDriftLeft = evaluateJoypadVector(-36, 12);
    expect(slightDriftLeft.directions).toEqual({ left: true, right: false, up: false, down: false });

    // Pure up & pure down
    expect(evaluateJoypadVector(0, -32).directions).toEqual({ left: false, right: false, up: true, down: false });
    expect(evaluateJoypadVector(4, 32).directions).toEqual({ left: false, right: false, up: false, down: true });

    // Intentional 45-degree diagonal -> both axes active (supports running drop-through & ladder jump-off)
    expect(evaluateJoypadVector(30, 30).directions).toEqual({ left: false, right: true, up: false, down: true });
    expect(evaluateJoypadVector(-30, -30).directions).toEqual({ left: true, right: false, up: true, down: false });
  });

  it("clamps the inner knob circle to maxRadius while tracking finger travel arbitrarily far past maxRadius", () => {
    const maxR = DEFAULT_JOYPAD_CONFIG.maxRadius;
    const farRight = evaluateJoypadVector(220, 0);
    expect(farRight.knobX).toBeCloseTo(maxR, 5);
    expect(farRight.knobY).toBeCloseTo(0, 5);
    expect(Math.hypot(farRight.knobX, farRight.knobY)).toBeCloseTo(maxR, 5);
    expect(farRight.directions).toEqual({ left: false, right: true, up: false, down: false });

    const farDiagonal = evaluateJoypadVector(-180, -180);
    expect(Math.hypot(farDiagonal.knobX, farDiagonal.knobY)).toBeCloseTo(maxR, 5);
    expect(farDiagonal.knobX).toBeLessThan(0);
    expect(farDiagonal.knobY).toBeLessThan(0);
    expect(farDiagonal.directions).toEqual({ left: true, right: false, up: true, down: false });
  });

  it("anchors at the thumb touch-down point, ignores secondary pointers, and resets cleanly on end/reset", () => {
    const joypad = createMobileJoypadController({ maxRadius: 40, deadzone: 10 });
    const zoneRect = { left: 20, top: 100, width: 300, height: 260 };

    // 1. Thumb touches down at (110, 250) -> origin is (90, 150) inside the zone, neutral direction
    const started = joypad.begin(7, 110, 250, zoneRect);
    expect(started.active).toBe(true);
    expect(started.pointerId).toBe(7);
    expect(started.originX).toBe(90);
    expect(started.originY).toBe(150);
    expect(started.knobX).toBe(0);
    expect(started.knobY).toBe(0);
    expect(started.directions).toEqual({ left: false, right: false, up: false, down: false });

    // 2. A second finger touching the left zone does not hijack the active joypad
    const ignoredBegin = joypad.begin(9, 60, 200, zoneRect);
    expect(ignoredBegin.pointerId).toBe(7);
    expect(ignoredBegin.originX).toBe(90);
    expect(joypad.move(9, 200, 250)).toBeNull();

    // 3. Primary finger drags far beyond maxRadius (dx = +160) -> knob clamps at +40, origin stays fixed, direction = right
    const draggedRight = joypad.move(7, 270, 250)!;
    expect(draggedRight.originX).toBe(90);
    expect(draggedRight.originY).toBe(150);
    expect(draggedRight.rawDx).toBe(160);
    expect(draggedRight.knobX).toBeCloseTo(40, 5);
    expect(draggedRight.knobY).toBeCloseTo(0, 5);
    expect(draggedRight.directions).toEqual({ left: false, right: true, up: false, down: false });

    // 4. Finger slides upward past origin (dx = +5, dy = -120) -> knob clamps at (approx 0, -40), direction switches to up
    const draggedUp = joypad.move(7, 115, 130)!;
    expect(Math.hypot(draggedUp.knobX, draggedUp.knobY)).toBeCloseTo(40, 5);
    expect(draggedUp.knobY).toBeLessThan(-39);
    expect(draggedUp.directions).toEqual({ left: false, right: false, up: true, down: false });

    // 5. Releasing a different pointer does nothing; releasing pointer 7 clears everything
    expect(joypad.end(9)).toBeNull();
    const ended = joypad.end(7)!;
    expect(ended.active).toBe(false);
    expect(ended.pointerId).toBeNull();
    expect(ended.knobX).toBe(0);
    expect(ended.knobY).toBe(0);
    expect(ended.directions).toEqual({ left: false, right: false, up: false, down: false });
  });
});

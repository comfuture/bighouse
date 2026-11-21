import { describe, expect, it } from "vitest";
import { createWeaponSwitchSequence } from "../src/weapon-switch-sequence";

describe("weapon switch sequencing", () => {
  it("does not treat the first switch's acknowledgement as acknowledging a later rapid switch after a remount", () => {
    const remounted = createWeaponSwitchSequence();
    remounted.observe(10);

    const firstSwitch = remounted.next();
    const secondSwitch = remounted.next();
    expect(firstSwitch).toBe(11);
    expect(secondSwitch).toBe(12);

    // The server keeps the previous seat's high-water mark.
    const firstAck = remounted.observe(Math.max(10, firstSwitch));
    expect(firstAck).toBeLessThan(secondSwitch);
    const secondAck = remounted.observe(Math.max(firstAck, secondSwitch));
    expect(secondAck).toBe(secondSwitch);
  });

  it("does not rewind issued sequences on older or missing snapshots", () => {
    const sequence = createWeaponSwitchSequence();
    expect(sequence.observe(undefined)).toBe(0);
    expect(sequence.next()).toBe(1);
    expect(sequence.next()).toBe(2);
    expect(sequence.observe(1)).toBe(1);
    expect(sequence.observe(undefined)).toBe(0);
    expect(sequence.next()).toBe(3);
  });
});

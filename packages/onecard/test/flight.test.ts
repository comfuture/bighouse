import { describe, expect, it } from "vitest";
import { clampFlightCenter, clampFlightPosition, fitFlightCardSize } from "../src/flight";

describe("fitFlightCardSize", () => {
  it("keeps the rendered portrait card size on a narrow phone", () => {
    const size = fitFlightCardSize({ width: 56, height: 78 }, 320);

    expect(size.width).toBe(56);
    expect(size.height).toBe(78);
  });

  it("keeps a rendered mobile hand card size when it fits the viewport", () => {
    const size = fitFlightCardSize({ width: 64, height: 92 }, 390);

    expect(size.width).toBe(64);
    expect(size.height).toBe(92);
  });

  it("caps oversized seat measurements relative to the current viewport", () => {
    const size = fitFlightCardSize({ width: 180, height: 248.4 }, 320);

    expect(size.width).toBeCloseTo(57.6);
    expect(size.height).toBeCloseTo(79.488);
  });

  it("preserves a normal desktop card measurement", () => {
    const size = fitFlightCardSize({ width: 85, height: 120 }, 1280);

    expect(size.width).toBe(85);
    expect(size.height).toBeCloseTo(120);
  });

  it("falls back safely and clamps unusual card ratios", () => {
    const fallback = fitFlightCardSize({ width: 0, height: 0 }, 0);
    expect(fallback.width).toBeCloseTo(57.6);
    expect(fallback.height).toBeCloseTo(79.488);
    expect(fitFlightCardSize({ width: 60, height: 300 }, 390)).toEqual({ width: 60, height: 93 });
    expect(fitFlightCardSize({ width: 60, height: 20 }, 390)).toEqual({ width: 60, height: 75 });
  });

  it("keeps cards and notices inside an offset visual viewport", () => {
    expect(clampFlightCenter(-20, 30, 100, 320)).toBe(130);
    expect(clampFlightCenter(500, 30, 100, 320)).toBe(390);
    expect(clampFlightPosition(80, 56, 100, 320)).toBe(108);
    expect(clampFlightPosition(500, 56, 100, 320)).toBe(356);
    expect(clampFlightCenter(200, 200, 100, 320)).toBe(260);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  lockMobileLandscapeCcwBestEffort,
  unlockScreenOrientationBestEffort
} from "../src/utils/screenOrientation";

describe("mobile fullscreen CCW landscape orientation lock", () => {
  it("requests landscape-primary (CCW 90 deg on portrait-native phones) first", async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const outcome = await lockMobileLandscapeCcwBestEffort({ lock });

    expect(outcome).toBe("landscape-primary");
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith("landscape-primary");
  });

  it("falls back to generic landscape when landscape-primary is rejected", async () => {
    const lock = vi
      .fn()
      .mockRejectedValueOnce(new Error("landscape-primary unsupported"))
      .mockResolvedValueOnce(undefined);

    const outcome = await lockMobileLandscapeCcwBestEffort({ lock });

    expect(outcome).toBe("landscape");
    expect(lock).toHaveBeenNthCalledWith(1, "landscape-primary");
    expect(lock).toHaveBeenNthCalledWith(2, "landscape");
  });

  it("returns unsupported or rejected gracefully without throwing on iOS/desktop browsers", async () => {
    expect(await lockMobileLandscapeCcwBestEffort(undefined)).toBe("unsupported");
    expect(await lockMobileLandscapeCcwBestEffort({})).toBe("unsupported");

    const lock = vi.fn().mockRejectedValue(new Error("NotSupportedError"));
    expect(await lockMobileLandscapeCcwBestEffort({ lock })).toBe("rejected");
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it("unlocks safely even when unlock throws or is absent", () => {
    const unlock = vi.fn();
    unlockScreenOrientationBestEffort({ unlock });
    expect(unlock).toHaveBeenCalledTimes(1);

    expect(() => unlockScreenOrientationBestEffort(undefined)).not.toThrow();
    expect(() =>
      unlockScreenOrientationBestEffort({
        unlock() {
          throw new Error("unsupported");
        }
      })
    ).not.toThrow();
  });
});

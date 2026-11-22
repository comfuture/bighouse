export type LandscapeLockMode = "landscape-primary" | "landscape";

export type LockableOrientation = {
  lock?: (orientation: LandscapeLockMode) => Promise<void>;
  unlock?: () => void;
};

export type LandscapeLockOutcome = "landscape-primary" | "landscape" | "unsupported" | "rejected";

/**
 * Best-effort mobile fullscreen landscape lock.
 *
 * Per the W3C Screen Orientation specification, orientation angles are measured
 * counter-clockwise from natural orientation, so `"landscape-primary"` corresponds
 * to 90° counter-clockwise (CCW) rotation on portrait-native mobile phones.
 * Falls back to `"landscape"` if `"landscape-primary"` is rejected, and never throws.
 */
export async function lockMobileLandscapeCcwBestEffort(
  orientation: LockableOrientation | undefined = typeof screen !== "undefined"
    ? (screen.orientation as LockableOrientation | undefined)
    : undefined
): Promise<LandscapeLockOutcome> {
  if (typeof orientation?.lock !== "function") {
    return "unsupported";
  }

  try {
    await orientation.lock("landscape-primary");
    return "landscape-primary";
  } catch {
    // Some devices or WebViews only allow generic "landscape" lock.
  }

  try {
    await orientation.lock("landscape");
    return "landscape";
  } catch {
    return "rejected";
  }
}

export function unlockScreenOrientationBestEffort(
  orientation: LockableOrientation | undefined = typeof screen !== "undefined"
    ? (screen.orientation as LockableOrientation | undefined)
    : undefined
): void {
  try {
    orientation?.unlock?.();
  } catch {
    // Orientation unlocking is optional and may throw on unsupported browsers.
  }
}

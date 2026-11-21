// A mounted client may resume a seat whose previous client already switched weapons.
// Start new switches above the server's last sequence without rewinding in-flight switches.
export function createWeaponSwitchSequence() {
  let lastSequence = 0;
  return {
    next: () => ++lastSequence,
    observe(snapshotSequence: number | undefined): number {
      const serverSequence = typeof snapshotSequence === "number" ? snapshotSequence : 0;
      lastSequence = Math.max(lastSequence, serverSequence);
      return serverSequence;
    }
  };
}

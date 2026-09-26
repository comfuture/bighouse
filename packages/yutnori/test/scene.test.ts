import { describe, expect, it } from "vitest";
import { throwPose } from "../src/scene";
import type { YutThrow } from "../src/types";
const roll: YutThrow = { matchId: "m1", rollId: "r1", turnId: 1, playerId: "p1", faces: [true, false, true, false], outcome: "gae", steps: 2, startedAt: 100, durationMs: 1800, visualSeed: 9876543 };
describe("shared three.js throw trajectory", () => {
  it("settles all 16 canonical face arrangements without random client adjudication", () => {
    for (let bits = 0; bits < 16; bits++) {
      const faces = [0, 1, 2, 3].map((index) => !!(bits & 1 << index)) as YutThrow["faces"];
      for (let index = 0; index < 4; index++) {
        const pose = throwPose({ ...roll, faces }, index, 1);
        expect(pose.rotation[0]).toBe(0);
        expect(pose.rotation[2]).toBe(faces[index] ? Math.PI : 0);
        expect(pose.position[1]).toBeCloseTo(faces[index] ? .29 : .06);
      }
    }
  });
  it("lands each stick exactly at its matching wood-impact time", () => {
    [.53, .67, .79, .88].forEach((landing, index) => {
      const pose = throwPose(roll, index, landing);
      expect(pose.position[1]).toBeCloseTo(roll.faces[index] ? .29 : .06);
      expect(pose.rotation[0]).toBe(0);
      expect(pose.rotation[2]).toBeCloseTo(roll.faces[index] ? Math.PI : 0);
      expect(throwPose(roll, index, landing - .1).position[1]).toBeGreaterThan(pose.position[1]);
    });
  });
  it("converges late snapshots to the final pose and produces the same seeded flight on every client", () => {
    expect(throwPose(roll, 0, 7)).toEqual(throwPose(roll, 0, 1));
    expect(throwPose(roll, 2, .42)).toEqual(throwPose(structuredClone(roll), 2, .42));
    expect(throwPose(roll, 0, .5).position[1]).toBeGreaterThan(throwPose(roll, 0, 1).position[1]);
    expect(throwPose(roll, 0, .42)).not.toEqual(throwPose({ ...roll, visualSeed: 123 }, 0, .42));
  });
});

import { describe, it, expect } from "vitest";
import {
  bodyControls,
  bodyGeometry,
  newBody,
  validBodies,
} from "../src/body/model";
import { newStory } from "../src/types";
import { importProject, exportProject } from "../src/storage/transfer";
describe("body profiles", () => {
  it("preserves independent profiles through compact export and rejects invalid geometry inputs", () => {
    const s = newStory();
    s.bodies = [newBody("one"), newBody("two")];
    s.bodies[0].measurements.waist = 0.3;
    s.bodies[0].measurements.hips = 2.5;
    s.bodies[1].material = "skin";
    expect(importProject(exportProject(s)).bodies).toEqual(s.bodies);
    s.bodies[0].measurements.hips = Infinity;
    expect(() => importProject(exportProject(s))).toThrow("Invalid body");
    expect(validBodies([newBody("one"), newBody("one")])).toBe(false);
  });
  it("keeps all extreme slider combinations finite and inside the preview", () => {
    for (let mask = 0; mask < 2 ** bodyControls.length; mask++) {
      const m = newBody("test").measurements;
      bodyControls.forEach(
        (c, i) => (m[c.key] = mask & (1 << i) ? c.max : c.min),
      );
      const g = bodyGeometry(m);
      expect(g.torso + g.leg + g.arm).not.toMatch(/NaN|Infinity/);
      expect(g.end).toBeGreaterThan(g.knee);
      expect(g.width / 2).toBeGreaterThan(g.hip);
    }
  });
});

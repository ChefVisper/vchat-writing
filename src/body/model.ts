export const bodyControls = [
  { key: "height", label: "Height", min: 140, max: 220, step: 1, unit: "cm" },
  { key: "shoulders", label: "Shoulders", min: 0.55, max: 1.8, step: 0.01 },
  { key: "chest", label: "Chest", min: 0.35, max: 2.3, step: 0.01 },
  { key: "waist", label: "Waist", min: 0.3, max: 1.6, step: 0.01 },
  { key: "hips", label: "Hips", min: 0.5, max: 2.5, step: 0.01 },
  { key: "armLength", label: "Arm length", min: 0.65, max: 1.45, step: 0.01 },
  { key: "arms", label: "Arm width", min: 0.5, max: 1.8, step: 0.01 },
  { key: "legLength", label: "Leg length", min: 0.65, max: 1.5, step: 0.01 },
  { key: "legs", label: "Leg width", min: 0.5, max: 1.9, step: 0.01 },
] as const;
export type BodyMeasurements = Record<
  (typeof bodyControls)[number]["key"],
  number
>;
export interface BodyProfile {
  id: string;
  name: string;
  version: 1;
  material: "mesh" | "skin";
  measurements: BodyMeasurements;
}
export const defaultMeasurements: BodyMeasurements = {
  height: 170,
  shoulders: 1,
  chest: 1,
  waist: 1,
  hips: 1,
  armLength: 1,
  arms: 1,
  legLength: 1,
  legs: 1,
};
export function newBody(id: string, name = "Character 1"): BodyProfile {
  return {
    id,
    name,
    version: 1,
    material: "mesh",
    measurements: { ...defaultMeasurements },
  };
}
export function validBodies(value: unknown): value is BodyProfile[] {
  return (
    Array.isArray(value) &&
    new Set(value.map((p) => p?.id)).size === value.length &&
    value.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        p.version === 1 &&
        ["mesh", "skin"].includes(p.material) &&
        bodyControls.every(
          (c) =>
            Number.isFinite(p.measurements?.[c.key]) &&
            p.measurements[c.key] >= c.min &&
            p.measurements[c.key] <= c.max,
        ),
    )
  );
}

// Geometry is independent of materials and UI. Future shape families can replace
// torso/chest/hip paths without changing saved measurements or the renderer.
export function bodyGeometry(m: BodyMeasurements) {
  const scale = m.height / 170,
    shoulder = 53 * m.shoulders,
    chest = 43 + 22 * m.chest,
    waist = 38 * m.waist,
    hip = 60 * m.hips,
    top = 135,
    waistY = 245,
    hipY = 300,
    pelvis = 350,
    knee = pelvis + 125 * m.legLength,
    ankle = pelvis + 260 * m.legLength,
    end = ankle + 25,
    thigh = Math.min(hip * 0.57, 29 * m.legs + hip * 0.12),
    legX = hip * 0.47,
    armX = Math.max(shoulder + 26, hip + 24),
    elbow = top + 102 * m.armLength,
    wrist = top + 205 * m.armLength,
    armWidth = 16 * m.arms;
  const torso = `M -17 109 Q -19 126 ${-shoulder} ${top} Q ${-chest - 8} 167 ${-chest} 192 C ${-chest} 212 ${-waist} 225 ${-waist} ${waistY} C ${-waist} 265 ${-hip} 263 ${-hip} ${hipY} Q ${-hip} 337 ${-hip * 0.55} 354 Q -17 362 0 ${pelvis} Q 17 362 ${hip * 0.55} 354 Q ${hip} 337 ${hip} ${hipY} C ${hip} 263 ${waist} 265 ${waist} ${waistY} C ${waist} 225 ${chest} 212 ${chest} 192 Q ${chest + 8} 167 ${shoulder} ${top} Q 19 126 17 109 Z`;
  const leg = `M ${legX - thigh} 320 C ${legX - thigh - 3} 372 ${legX - 21 * m.legs} ${knee - 35} ${legX - 18 * m.legs} ${knee} C ${legX - 25 * m.legs} ${knee + 45} ${legX - 10} ${ankle - 32} ${legX - 10} ${ankle} Q ${legX - 15} ${end} ${legX + 3} ${end} L ${legX + 28} ${end} Q ${legX + 36} ${end - 8} ${legX + 11} ${ankle - 6} C ${legX + 14} ${ankle - 45} ${legX + 29 * m.legs} ${knee + 35} ${legX + 19 * m.legs} ${knee} C ${legX + 17 * m.legs} ${knee - 25} ${legX + thigh + 12} 375 ${legX + thigh} 320 Z`;
  const arm = `M ${shoulder - 9} ${top + 2} Q ${shoulder + 22} ${top - 3} ${shoulder + 28} ${top + 31} L ${armX + armWidth} ${elbow} Q ${armX + armWidth + 8} ${elbow + 45} ${armX + 12} ${wrist} Q ${armX + 24} ${wrist + 38} ${armX + 7} ${wrist + 39} Q ${armX - 3} ${wrist + 39} ${armX - 7} ${wrist + 18} L ${armX - 12} ${wrist + 24} Q ${armX - 19} ${wrist + 22} ${armX - 12} ${wrist + 3} L ${armX - armWidth} ${elbow} L ${shoulder - 10} ${top + 45} Z`;
  return {
    torso,
    leg,
    arm,
    scale,
    shoulder,
    chest,
    waist,
    hip,
    legX,
    knee,
    ankle,
    end,
    width: Math.max(235, armX + armWidth + 30) * 2,
  };
}

export interface YokeAreaLightConfig {
  name: string;
  position: readonly [number, number, number];
  quaternionXYZW: readonly [
    number,
    number,
    number,
    number,
  ];
  directionMinusZ: readonly [number, number, number];
  energyWatts: number;
  colorLinearRGB: readonly [number, number, number];
}

/**
 * Source:
 * blender/PowerBox_MASTER.blend
 * collection: Yoke_Area_Lights
 *
 * Blender Area settings:
 * - type: AREA / RECTANGLE
 * - energy: 10 W
 * - data size: 1.0 × 0.25 m
 * - object scale in Blender: approximately 0.16 × 2.14 × 1
 *
 * Effective web rectangle:
 * width  = 1.0 × 0.16 = 0.16 m
 * height = 0.25 × 2.14 = 0.535 m
 *
 * Positions and quaternions are already converted to Three.js/glTF axes.
 */
export const YOKE_AREA_LIGHTS: readonly YokeAreaLightConfig[] = [
  {
    name: "Area",
    position: [2, 0.931847, 0],
    quaternionXYZW: [
      -0.353553206,
      -0.612372458,
      -0.353553146,
      0.612372637,
    ],
    directionMinusZ: [0.500001, -0.866025, 0],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.001",
    position: [-2, 0.931847, 0],
    quaternionXYZW: [
      -0.353553206,
      0.612372458,
      0.353553146,
      0.612372637,
    ],
    directionMinusZ: [-0.500001, -0.866025, 0],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.002",
    position: [0, 0.931847, 2],
    quaternionXYZW: [
      -0.000000097,
      -0.866025627,
      -0.499999702,
      0.000000169,
    ],
    directionMinusZ: [0, -0.866025, 0.500001],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.003",
    position: [0, 0.931847, -2],
    quaternionXYZW: [
      -0.499999702,
      0,
      0,
      0.866025567,
    ],
    directionMinusZ: [0, -0.866025, -0.500001],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.004",
    position: [-1.414214, 0.931847, 1.414214],
    quaternionXYZW: [
      -0.191341624,
      0.800103247,
      0.461939573,
      0.331413627,
    ],
    directionMinusZ: [
      -0.353554,
      -0.866025,
      0.353554,
    ],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.005",
    position: [1.414214, 0.931847, -1.414214],
    quaternionXYZW: [
      -0.461939573,
      -0.331413716,
      -0.191341609,
      0.800103247,
    ],
    directionMinusZ: [
      0.353554,
      -0.866025,
      -0.353554,
    ],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.006",
    position: [-1.414214, 0.931847, -1.414213],
    quaternionXYZW: [
      -0.461939514,
      0.331413597,
      0.191341594,
      0.800103307,
    ],
    directionMinusZ: [
      -0.353554,
      -0.866025,
      -0.353554,
    ],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
  {
    name: "Area.007",
    position: [1.414214, 0.931847, 1.414213],
    quaternionXYZW: [
      -0.191341639,
      -0.800103247,
      -0.461939514,
      0.331413746,
    ],
    directionMinusZ: [
      0.353554,
      -0.866025,
      0.353554,
    ],
    energyWatts: 10,
    colorLinearRGB: [1, 1, 1],
  },
] as const;

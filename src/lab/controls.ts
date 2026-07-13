export interface CameraPreset {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface PostprocessingPreset {
  bloomIntensity: number;
  bloomThreshold: number;
  focusDistance: number;
  bokehScale: number;
  exposure: number;
}

export interface CollectionEntry {
  name: string;
  slug: string;
  file: string;
  parent: string | null;
  children: string[];
  defaultVisible: boolean;
  objectCount: number;
  objectTypes: Record<string, number>;
  objects: string[];
  fileSizeBytes: number;
}

export interface LightEntry {
  name: string;
  type: "POINT" | "SUN" | "SPOT" | "AREA";
  color: [number, number, number];
  energy: number;
  matrix: number[];
  enabled: boolean;
  useShadow: boolean;
  distance: number;
  spotSize?: number;
  spotBlend?: number;
  shape?: string;
  size?: number;
  sizeY?: number;
}

export interface CameraEntry {
  name: string;
  matrix: number[];
  fovYDegrees: number;
  near: number;
  far: number;
  dof: {
    enabled: boolean;
    focusObject: string | null;
    focusDistance: number;
    fStop: number;
  };
}

export interface Manifest {
  version: number;
  generatedAt: string;
  sourceBlend: string;
  scene: {
    name: string;
    worldColor: [number, number, number];
    exposureStops: number;
    renderEngine: string;
  };
  activeCamera: string | null;
  collections: CollectionEntry[];
  lights: LightEntry[];
  cameras: CameraEntry[];
  failures: Array<{
    collection: string;
    error: string;
  }>;
  summary: {
    collectionCount: number;
    lightCount: number;
    cameraCount: number;
    totalGlbBytes: number;
  };
}

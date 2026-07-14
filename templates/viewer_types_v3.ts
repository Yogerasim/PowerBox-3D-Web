export interface CollectionEntry {
  name: string;
  slug: string;
  file: string | null;
  parent: string | null;
  children: string[];
  defaultVisible: boolean;
  objectCount: number;
  objects: string[];
  fileSizeBytes: number;
  instanceCount: number;
}

export interface PrototypeEntry {
  asset: string;
  file: string;
  fileSizeBytes: number;
  objectCount: number;
}

export interface InstanceEntry {
  name: string;
  asset: string;
  group: string;
  matrix: number[];
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
  type: "PERSP" | "ORTHO" | "PANO";
  matrix: number[];
  fovYDegrees: number;
  orthoScale: number;
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
    cameraMode: "orthographic";
  };

  activeCamera: string | null;
  collections: CollectionEntry[];
  prototypes: PrototypeEntry[];
  instances: InstanceEntry[];
  lights: LightEntry[];
  cameras: CameraEntry[];

  optimization: {
    textures: Array<{
      name: string;
      before: [number, number];
      after: [number, number];
      packed: boolean;
    }>;

    instanceFamilies: Array<{
      collection?: string;
      asset: string;
      instanceCount: number;
      prototypeCollection: string;
      prototypePartCount?: number;
      mode: string;
      groups?: string[];
    }>;
  };

  failures: Array<{
    collection: string;
    error: string;
  }>;

  summary: {
    collectionCount: number;
    prototypeCount: number;
    instanceCount: number;
    lightCount: number;
    cameraCount: number;
    collectionGlbBytes: number;
    prototypeGlbBytes: number;
    totalGlbBytes: number;
  };
}

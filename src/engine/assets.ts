const baseURL = import.meta.env.BASE_URL;

export const POWERBOX_ASSETS = {
  scene: `${baseURL}assets/models/powerbox-scene-web.glb`,
  environment: `${baseURL}assets/hdri/powerbox-studio.hdr`,
  heroPoster: `${baseURL}assets/posters/powerbox-hero.webp`,
} as const;

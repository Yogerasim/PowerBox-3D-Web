import type { Object3D } from "three";

export interface PowerBoxChannel {
  id: number;
  enabled: boolean;
  lampObjectName: string;
  cableObjectName: string;
}

export const powerBoxChannels: PowerBoxChannel[] = Array.from(
  { length: 8 },
  (_, index) => {
    const channelNumber = index + 1;
    const suffix = String(channelNumber).padStart(2, "0");

    return {
      id: channelNumber,
      enabled: false,
      lampObjectName: `LED_LIGHT_${suffix}`,
      cableObjectName: `CABLE_EXT_${suffix}`,
    };
  },
);

export function setChannelState(
  sceneRoot: Object3D,
  channelId: number,
  enabled: boolean,
): void {
  const channel = powerBoxChannels.find((item) => item.id === channelId);

  if (!channel) {
    throw new Error(`PowerBox channel ${channelId} does not exist.`);
  }

  channel.enabled = enabled;

  const lamp = sceneRoot.getObjectByName(channel.lampObjectName);
  if (lamp) {
    lamp.visible = true;
    lamp.userData.enabled = enabled;
  }
}

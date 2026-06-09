export const TABLE_STAGE_HEIGHT = 720;
export const TABLE_STAGE_WIDTH = 1280;

export function getTableDevicePixelRatio(): number {
  if (typeof window === "undefined") {
    return 1;
  }

  return Math.min(window.devicePixelRatio || 1, 2);
}

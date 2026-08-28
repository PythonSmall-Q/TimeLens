export type SkinTextureId = "linen" | "paper" | "grid";

export interface SkinTexture {
  id: SkinTextureId;
  css: string;
}

export const NEUTRAL_TEXTURE_CATALOG: SkinTexture[] = [
  {
    id: "linen",
    css: "repeating-linear-gradient(135deg, rgba(255,255,255,.025) 0 1px, transparent 1px 7px)",
  },
  {
    id: "paper",
    css: "radial-gradient(rgba(255,255,255,.035) .7px, transparent .7px)",
  },
  {
    id: "grid",
    css: "linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)",
  },
];

export function getNeutralTexture(id: SkinTextureId = "linen"): SkinTexture {
  return NEUTRAL_TEXTURE_CATALOG.find((texture) => texture.id === id)
    ?? NEUTRAL_TEXTURE_CATALOG[0];
}
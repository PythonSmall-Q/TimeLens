export type SkinTextureId = "linen" | "paper" | "grid" | "aurora";

export interface SkinTexture {
  id: SkinTextureId;
  css: string;
}

export const NEUTRAL_TEXTURE_CATALOG: SkinTexture[] = [
  {
    id: "aurora",
    css: "radial-gradient(circle at 20% 20%, rgba(120, 169, 181, 0.32), transparent 26%), radial-gradient(circle at 80% 24%, rgba(170, 159, 190, 0.28), transparent 28%), radial-gradient(circle at 55% 72%, rgba(113, 181, 161, 0.26), transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015) 42%, rgba(255,255,255,0.03) 100%)",
  },
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

export function getNeutralTexture(id: SkinTextureId = "aurora"): SkinTexture {
  return NEUTRAL_TEXTURE_CATALOG.find((texture) => texture.id === id)
    ?? NEUTRAL_TEXTURE_CATALOG[0];
}
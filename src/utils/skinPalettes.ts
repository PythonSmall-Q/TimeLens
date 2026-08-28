export type SkinPaletteId = "default" | "ocean" | "forest" | "sunset" | "monochrome";

export interface SkinPalette {
  id: SkinPaletteId;
  appBg: string;
  surface: string;
  surfaceLight: string;
  surfaceCard: string;
  surfaceHover: string;
  surfaceBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentBlue: string;
  accentPurple: string;
  accentTeal: string;
  accentGreen: string;
  accentRed: string;
  accentOrange: string;
}

export const SKIN_PALETTES: SkinPalette[] = [
  {
    id: "default", appBg: "#141824", surface: "#1e2433", surfaceLight: "#262d3d", surfaceCard: "#283043", surfaceHover: "#323b52", surfaceBorder: "#3a445c", textPrimary: "#e8edf7", textSecondary: "#aeb8ca", textMuted: "#7e8aa1", accentBlue: "#6c8ebf", accentPurple: "#8b6cbf", accentTeal: "#4ea5a0", accentGreen: "#4caf7d", accentRed: "#e05555", accentOrange: "#e09050",
  },
  {
    id: "ocean", appBg: "#0c1d2a", surface: "#123047", surfaceLight: "#17415b", surfaceCard: "#1b4b66", surfaceHover: "#23617d", surfaceBorder: "#327b96", textPrimary: "#e5f7ff", textSecondary: "#a8d6e5", textMuted: "#78aabd", accentBlue: "#43b7d8", accentPurple: "#8b9de9", accentTeal: "#35c3b0", accentGreen: "#65d69a", accentRed: "#ef7777", accentOrange: "#e9a15c",
  },
  {
    id: "forest", appBg: "#132019", surface: "#1c3026", surfaceLight: "#294235", surfaceCard: "#31513f", surfaceHover: "#3c624b", surfaceBorder: "#527963", textPrimary: "#edf8ed", textSecondary: "#b9d3bd", textMuted: "#89a78f", accentBlue: "#70b8c5", accentPurple: "#b29ad2", accentTeal: "#55c39c", accentGreen: "#8bd05f", accentRed: "#e87575", accentOrange: "#e4a65f",
  },
  {
    id: "sunset", appBg: "#261a20", surface: "#39232b", surfaceLight: "#4b2b35", surfaceCard: "#5a3540", surfaceHover: "#6e414c", surfaceBorder: "#8a5960", textPrimary: "#fff1e8", textSecondary: "#e2bdaf", textMuted: "#bb8f86", accentBlue: "#79b6d5", accentPurple: "#c494d6", accentTeal: "#65c3b0", accentGreen: "#9ace76", accentRed: "#f07b72", accentOrange: "#f2a45c",
  },
  {
    id: "monochrome", appBg: "#151515", surface: "#232323", surfaceLight: "#303030", surfaceCard: "#3b3b3b", surfaceHover: "#4a4a4a", surfaceBorder: "#626262", textPrimary: "#f4f4f4", textSecondary: "#c7c7c7", textMuted: "#999999", accentBlue: "#d1d1d1", accentPurple: "#b8b8b8", accentTeal: "#ababab", accentGreen: "#c8c8c8", accentRed: "#ef8c8c", accentOrange: "#e0b27f",
  },
];

export function getSkinPalette(id: SkinPaletteId): SkinPalette {
  return SKIN_PALETTES.find((palette) => palette.id === id) ?? SKIN_PALETTES[0];
}

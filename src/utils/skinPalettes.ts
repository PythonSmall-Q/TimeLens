export type SkinPaletteId = "default" | "ocean" | "forest" | "sunset" | "monochrome" | "neutral-texture";

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
  glassBg: string;
  glassLightBg: string;
  fieldHoverBorder: string;
  fieldFocusRing: string;
  sliderBorder: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
}

export const SKIN_PALETTES: SkinPalette[] = [
  {
    id: "default", appBg: "#141824", surface: "#1e2433", surfaceLight: "#262d3d", surfaceCard: "#283043", surfaceHover: "#323b52", surfaceBorder: "#3a445c", textPrimary: "#e8edf7", textSecondary: "#aeb8ca", textMuted: "#7e8aa1", accentBlue: "#6c8ebf", accentPurple: "#8b6cbf", accentTeal: "#4ea5a0", accentGreen: "#4caf7d", accentRed: "#e05555", accentOrange: "#e09050", glassBg: "rgba(30, 36, 51, 0.78)", glassLightBg: "rgba(36, 43, 60, 0.76)", fieldHoverBorder: "#5a6b8f", fieldFocusRing: "rgba(108, 142, 191, 0.24)", sliderBorder: "rgba(58, 68, 92, 0.9)", scrollbarThumb: "rgba(174, 184, 202, 0.30)", scrollbarThumbHover: "rgba(174, 184, 202, 0.45)",
  },
  {
    id: "ocean", appBg: "#0c1d2a", surface: "#123047", surfaceLight: "#17415b", surfaceCard: "#1b4b66", surfaceHover: "#23617d", surfaceBorder: "#327b96", textPrimary: "#e5f7ff", textSecondary: "#a8d6e5", textMuted: "#78aabd", accentBlue: "#43b7d8", accentPurple: "#8b9de9", accentTeal: "#35c3b0", accentGreen: "#65d69a", accentRed: "#ef7777", accentOrange: "#e9a15c", glassBg: "rgba(27, 75, 102, 0.72)", glassLightBg: "rgba(23, 65, 91, 0.74)", fieldHoverBorder: "#67b4d2", fieldFocusRing: "rgba(67, 183, 216, 0.22)", sliderBorder: "rgba(50, 123, 150, 0.9)", scrollbarThumb: "rgba(168, 214, 229, 0.26)", scrollbarThumbHover: "rgba(168, 214, 229, 0.42)",
  },
  {
    id: "forest", appBg: "#132019", surface: "#1c3026", surfaceLight: "#294235", surfaceCard: "#31513f", surfaceHover: "#3c624b", surfaceBorder: "#527963", textPrimary: "#edf8ed", textSecondary: "#b9d3bd", textMuted: "#89a78f", accentBlue: "#70b8c5", accentPurple: "#b29ad2", accentTeal: "#55c39c", accentGreen: "#8bd05f", accentRed: "#e87575", accentOrange: "#e4a65f", glassBg: "rgba(49, 81, 63, 0.72)", glassLightBg: "rgba(41, 66, 53, 0.76)", fieldHoverBorder: "#88b58c", fieldFocusRing: "rgba(112, 184, 197, 0.2)", sliderBorder: "rgba(82, 121, 99, 0.9)", scrollbarThumb: "rgba(185, 211, 189, 0.24)", scrollbarThumbHover: "rgba(185, 211, 189, 0.4)",
  },
  {
    id: "sunset", appBg: "#261a20", surface: "#39232b", surfaceLight: "#4b2b35", surfaceCard: "#5a3540", surfaceHover: "#6e414c", surfaceBorder: "#8a5960", textPrimary: "#fff1e8", textSecondary: "#e2bdaf", textMuted: "#bb8f86", accentBlue: "#79b6d5", accentPurple: "#c494d6", accentTeal: "#65c3b0", accentGreen: "#9ace76", accentRed: "#f07b72", accentOrange: "#f2a45c", glassBg: "rgba(90, 53, 64, 0.74)", glassLightBg: "rgba(75, 43, 53, 0.77)", fieldHoverBorder: "#c88c7b", fieldFocusRing: "rgba(242, 164, 92, 0.22)", sliderBorder: "rgba(138, 89, 96, 0.9)", scrollbarThumb: "rgba(226, 189, 175, 0.24)", scrollbarThumbHover: "rgba(226, 189, 175, 0.4)",
  },
  {
    id: "monochrome", appBg: "#151515", surface: "#232323", surfaceLight: "#303030", surfaceCard: "#3b3b3b", surfaceHover: "#4a4a4a", surfaceBorder: "#626262", textPrimary: "#f4f4f4", textSecondary: "#c7c7c7", textMuted: "#999999", accentBlue: "#d1d1d1", accentPurple: "#b8b8b8", accentTeal: "#ababab", accentGreen: "#c8c8c8", accentRed: "#ef8c8c", accentOrange: "#e0b27f", glassBg: "rgba(59, 59, 59, 0.78)", glassLightBg: "rgba(48, 48, 48, 0.8)", fieldHoverBorder: "#b8b8b8", fieldFocusRing: "rgba(209, 209, 209, 0.2)", sliderBorder: "rgba(98, 98, 98, 0.9)", scrollbarThumb: "rgba(199, 199, 199, 0.22)", scrollbarThumbHover: "rgba(199, 199, 199, 0.38)",
  },
  {
    id: "neutral-texture", appBg: "#202522", surface: "#29302c", surfaceLight: "#343c37", surfaceCard: "#3b4540", surfaceHover: "#46514b", surfaceBorder: "#5d6a62", textPrimary: "#eef2ee", textSecondary: "#c2ccc4", textMuted: "#91a097", accentBlue: "#78a9b5", accentPurple: "#aa9fbe", accentTeal: "#71b5a1", accentGreen: "#9ac27c", accentRed: "#d98282", accentOrange: "#d7a36f", glassBg: "rgba(59, 69, 64, 0.78)", glassLightBg: "rgba(52, 60, 55, 0.78)", fieldHoverBorder: "#8ea59d", fieldFocusRing: "rgba(120, 169, 181, 0.22)", sliderBorder: "rgba(93, 106, 98, 0.9)", scrollbarThumb: "rgba(194, 204, 196, 0.23)", scrollbarThumbHover: "rgba(194, 204, 196, 0.38)",
  },
];

export function getSkinPalette(id: SkinPaletteId): SkinPalette {
  return SKIN_PALETTES.find((palette) => palette.id === id) ?? SKIN_PALETTES[0];
}

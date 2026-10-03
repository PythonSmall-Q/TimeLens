import { describe, expect, it } from "vitest";
import {
  SKIN_PALETTES,
  getSkinPalette,
  type SkinPalette,
  type SkinPaletteId,
} from "./skinPalettes";

const PALETTE_IDS: SkinPaletteId[] = ["default", "ocean", "forest", "sunset", "monochrome", "neutral-texture"];

const PALETTE_KEYS: (keyof SkinPalette)[] = [
  "id",
  "appBg",
  "surface",
  "surfaceLight",
  "surfaceCard",
  "surfaceHover",
  "surfaceBorder",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "accentBlue",
  "accentPurple",
  "accentTeal",
  "accentGreen",
  "accentRed",
  "accentOrange",
  "glassBg",
  "glassLightBg",
  "fieldHoverBorder",
  "fieldFocusRing",
  "sliderBorder",
  "scrollbarThumb",
  "scrollbarThumbHover",
];

describe("SKIN_PALETTES catalog", () => {
  it("covers every SkinPaletteId exactly once", () => {
    const ids = SKIN_PALETTES.map((palette) => palette.id);
    expect(ids).toHaveLength(PALETTE_IDS.length);
    expect([...ids].sort()).toEqual([...PALETTE_IDS].sort());
  });
});

describe("getSkinPalette", () => {
  it.each(PALETTE_IDS)("returns the palette for id %s with every promised CSS variable", (id) => {
    const palette = getSkinPalette(id);

    expect(palette.id).toBe(id);
    expect(Object.keys(palette).sort()).toEqual([...PALETTE_KEYS].sort());
    for (const key of PALETTE_KEYS) {
      expect(typeof palette[key]).toBe("string");
      expect(palette[key].length).toBeGreaterThan(0);
    }
  });

  it.each(PALETTE_IDS)("defines usable color values for palette %s", (id) => {
    const palette = getSkinPalette(id);

    expect(palette.appBg).toMatch(/^#/);
    expect(palette.surface).toMatch(/^#/);
    expect(palette.glassBg.startsWith("rgba(") || palette.glassBg.startsWith("hsla(")).toBe(true);
    expect(palette.fieldFocusRing.startsWith("rgba(") || palette.fieldFocusRing.startsWith("hsla(")).toBe(true);
  });

  it("returns the first catalog entry for the default palette", () => {
    expect(getSkinPalette("default")).toBe(SKIN_PALETTES[0]);
  });

  it("falls back to the default palette for unknown ids", () => {
    const palette = getSkinPalette("no-such-palette" as SkinPaletteId);

    expect(palette).toBe(SKIN_PALETTES[0]);
    expect(palette.id).toBe("default");
  });
});

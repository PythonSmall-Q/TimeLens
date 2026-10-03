import { describe, expect, it } from "vitest";
import {
  NEUTRAL_TEXTURE_CATALOG,
  getNeutralTexture,
  type SkinTextureId,
} from "./skinTextures";

const TEXTURE_IDS: SkinTextureId[] = ["aurora", "linen", "paper", "grid"];

describe("NEUTRAL_TEXTURE_CATALOG", () => {
  it("covers every SkinTextureId exactly once", () => {
    const ids = NEUTRAL_TEXTURE_CATALOG.map((texture) => texture.id);
    expect(ids).toHaveLength(TEXTURE_IDS.length);
    expect([...ids].sort()).toEqual([...TEXTURE_IDS].sort());
  });
});

describe("getNeutralTexture", () => {
  it.each(TEXTURE_IDS)("returns a css texture for id %s", (id) => {
    const texture = getNeutralTexture(id);

    expect(texture.id).toBe(id);
    expect(typeof texture.css).toBe("string");
    expect(texture.css.length).toBeGreaterThan(0);
    expect(texture.css).toContain("gradient");
  });

  it("defaults to the first catalog texture (aurora) when no id is given", () => {
    expect(getNeutralTexture()).toBe(NEUTRAL_TEXTURE_CATALOG[0]);
    expect(getNeutralTexture().id).toBe("aurora");
  });

  it("falls back to the first catalog texture for unknown ids", () => {
    const texture = getNeutralTexture("no-such-texture" as SkinTextureId);

    expect(texture).toBe(NEUTRAL_TEXTURE_CATALOG[0]);
    expect(texture.id).toBe("aurora");
  });
});

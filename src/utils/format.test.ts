import {
  appColor,
  clamp,
  formatDuration,
  getProjectDisplayName,
  pad2,
} from "./format";

describe("formatDuration", () => {
  it("returns seconds for values under 60", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns minutes for values under 1 hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(119)).toBe("1m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("returns hours and minutes for values over 1 hour", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(7200)).toBe("2h 0m");
  });
});

describe("clamp", () => {
  it("clamps values within the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("pad2", () => {
  it("pads single digit numbers with a leading zero", () => {
    expect(pad2(1)).toBe("01");
    expect(pad2(9)).toBe("09");
  });

  it("does not pad two digit numbers", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(99)).toBe("99");
  });
});

describe("getProjectDisplayName", () => {
  const t = (key: string) => (key === "dashboard:unknownProject" ? "Unknown project" : key);

  it("prefers the explicit project name", () => {
    expect(getProjectDisplayName("MyProject", "/home/user/Other", t)).toBe("MyProject");
  });

  it("falls back to the basename of the project path", () => {
    expect(getProjectDisplayName("", "/home/user/MyProject", t)).toBe("MyProject");
    expect(getProjectDisplayName(undefined, "C:\\\\Users\\\\me\\\\MyProject", t)).toBe("MyProject");
    expect(getProjectDisplayName("   ", "/home/user/MyProject/", t)).toBe("MyProject");
  });

  it("returns the localized unknown label when nothing is available", () => {
    expect(getProjectDisplayName("", "", t)).toBe("Unknown project");
    expect(getProjectDisplayName(undefined, undefined, t)).toBe("Unknown project");
  });
});

describe("appColor", () => {
  it("returns a color from the palette for any app name", () => {
    const color = appColor("TestApp");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns deterministic colors for the same app name", () => {
    expect(appColor("Chrome")).toBe(appColor("Chrome"));
  });
});

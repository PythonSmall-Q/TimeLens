import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisRange, ChatMessage, LlmDataSharing } from "@/types/llm";
import {
  buildScreenTimeContext,
  getRangeDates,
  stripHiddenFlag,
  type CustomRange,
  type ScreenTimeContextOptions,
} from "./llmApi";

const makeDataSharing = (overrides: Partial<LlmDataSharing> = {}): LlmDataSharing => ({
  total_time: true,
  top_apps: true,
  categories: true,
  focus_time: true,
  goals: true,
  interruptions: true,
  ...overrides,
});

const makeOptions = (overrides: Partial<ScreenTimeContextOptions> = {}): ScreenTimeContextOptions => ({
  todaySeconds: 125,
  topApps: [{ name: "Code", seconds: 3600 }],
  categories: [{ name: "Development", seconds: 5400 }],
  focusMinutes: 45.6,
  goals: [{ name: "Meditation", progress: 0.5 }],
  interruptions: 7,
  language: "en",
  dataSharing: makeDataSharing(),
  rangeLabel: "today",
  ...overrides,
});

describe("buildScreenTimeContext", () => {
  it("returns a hidden system message followed by a hidden user message", () => {
    const messages = buildScreenTimeContext(makeOptions());
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "system", hidden: true });
    expect(messages[1]).toMatchObject({ role: "user", hidden: true });
    expect(typeof messages[0].content).toBe("string");
    expect(typeof messages[1].content).toBe("string");
  });

  it.each([
    ["en", "the user's language"],
    [undefined, "the user's language"],
    ["zh-CN", "zh-CN"],
  ] as const)("uses %s language in the system prompt", (language, expected) => {
    const messages = buildScreenTimeContext(makeOptions({ language }));
    expect(messages[0].content).toContain(`Respond in ${expected}.`);
  });

  it("opens the user message with the range label and ends with the analysis request", () => {
    const messages = buildScreenTimeContext(makeOptions({ rangeLabel: "the last 7 days" }));
    expect(messages[1].content).toContain("Here is my screen-time summary for the last 7 days:");
    expect(messages[1].content).toContain(
      "Please analyze my screen time and suggest 2-3 ways I could improve my focus or balance."
    );
  });

  const SECTION_MARKERS: Record<keyof LlmDataSharing, string> = {
    total_time: "- Total active time:",
    focus_time: "- Focus time:",
    interruptions: "- Interruptions:",
    top_apps: "Top apps:",
    categories: "Categories:",
    goals: "Goals:",
  };

  it.each(Object.entries(SECTION_MARKERS))(
    "omits the %s section when its dataSharing flag is off",
    (flag, marker) => {
      const options = makeOptions({
        dataSharing: makeDataSharing({ [flag as keyof LlmDataSharing]: false }),
      });
      const content = buildScreenTimeContext(options)[1].content;
      expect(content).not.toContain(marker);
      // Every other section stays visible.
      for (const [otherFlag, otherMarker] of Object.entries(SECTION_MARKERS)) {
        if (otherFlag !== flag) expect(content).toContain(otherMarker);
      }
    }
  );

  it("suppresses list sections when the flag is on but the list is empty", () => {
    const content = buildScreenTimeContext(
      makeOptions({ topApps: [], categories: [], goals: [] })
    )[1].content;
    expect(content).not.toContain("Top apps:");
    expect(content).not.toContain("Categories:");
    expect(content).not.toContain("Goals:");
  });

  it("renders goals as name and whole-percent progress", () => {
    const content = buildScreenTimeContext(
      makeOptions({ goals: [{ name: "Meditation", progress: 0.5 }, { name: "Coding", progress: 0.756 }] })
    )[1].content;
    expect(content).toContain("Meditation: 50%");
    expect(content).toContain("Coding: 76%");
  });

  it("caps top apps at five entries and rounds seconds to minutes", () => {
    const topApps = Array.from({ length: 7 }, (_, i) => ({
      name: `App ${i + 1}`,
      seconds: 125, // 2 minutes after rounding
    }));
    const content = buildScreenTimeContext(makeOptions({ topApps }))[1].content;
    expect(content).toContain("App 1: 2m");
    expect(content).toContain("App 5: 2m");
    expect(content).not.toContain("App 6");
    expect(content).not.toContain("App 7");
  });
});

describe("getRangeDates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const pinTo = (y: number, m: number, d: number) =>
    vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0));

  const parseLocal = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const spanDays = (start: string, end: string) =>
    (parseLocal(end).getTime() - parseLocal(start).getTime()) / 86_400_000;

  it("returns today for both bounds on the today range", () => {
    pinTo(2025, 6, 11); // Wednesday
    expect(getRangeDates("today")).toEqual({ start: "2025-06-11", end: "2025-06-11", label: "today" });
  });

  it("shifts both bounds back one day for yesterday", () => {
    pinTo(2025, 6, 11);
    expect(getRangeDates("yesterday")).toEqual({
      start: "2025-06-10",
      end: "2025-06-10",
      label: "yesterday",
    });
  });

  it("spans six days before today for last_7_days", () => {
    pinTo(2025, 6, 11);
    const range = getRangeDates("last_7_days");
    expect(range).toEqual({ start: "2025-06-05", end: "2025-06-11", label: "the last 7 days" });
    expect(spanDays(range.start, range.end)).toBe(6);
  });

  it("spans 29 days before today for last_30_days", () => {
    pinTo(2025, 6, 11);
    const range = getRangeDates("last_30_days");
    expect(range).toEqual({ start: "2025-05-13", end: "2025-06-11", label: "the last 30 days" });
    expect(spanDays(range.start, range.end)).toBe(29);
  });

  it("starts this_week on the current week's Monday", () => {
    pinTo(2025, 6, 11); // Wednesday
    const range = getRangeDates("this_week");
    expect(range).toEqual({ start: "2025-06-09", end: "2025-06-11", label: "this week" });
    expect(parseLocal(range.start).getDay()).toBe(1);
  });

  it("covers Monday through Sunday for last_week", () => {
    pinTo(2025, 6, 11); // Wednesday
    const range = getRangeDates("last_week");
    expect(range).toEqual({ start: "2025-06-02", end: "2025-06-08", label: "last week" });
    expect(parseLocal(range.start).getDay()).toBe(1);
    expect(parseLocal(range.end).getDay()).toBe(0);
    expect(spanDays(range.start, range.end)).toBe(6);
  });

  it("starts this_week on today when today is Monday", () => {
    pinTo(2025, 6, 9); // Monday
    expect(getRangeDates("this_week")).toEqual({
      start: "2025-06-09",
      end: "2025-06-09",
      label: "this week",
    });
  });

  it("uses the previous Monday through Sunday for last_week when today is Monday", () => {
    pinTo(2025, 6, 9); // Monday
    expect(getRangeDates("last_week")).toEqual({
      start: "2025-06-02",
      end: "2025-06-08",
      label: "last week",
    });
  });

  it("treats Sunday as the last day of this_week, not the first", () => {
    pinTo(2025, 6, 8); // Sunday
    expect(getRangeDates("this_week")).toEqual({
      start: "2025-06-02",
      end: "2025-06-08",
      label: "this week",
    });
    expect(getRangeDates("last_week")).toEqual({
      start: "2025-05-26",
      end: "2025-06-01",
      label: "last week",
    });
  });

  it("passes custom start and end through with a combined label", () => {
    pinTo(2025, 6, 11);
    const custom: CustomRange = { start: "2025-01-05", end: "2025-01-10" };
    expect(getRangeDates("custom", custom)).toEqual({
      start: "2025-01-05",
      end: "2025-01-10",
      label: "2025-01-05 to 2025-01-10",
    });
  });

  it.each([
    ["missing custom bounds", undefined],
    ["empty custom bounds", { start: "", end: "" }],
    ["partial custom bounds", { start: "2025-01-05", end: "" }],
  ])("falls back to today for %s", (_label, custom) => {
    pinTo(2025, 6, 11);
    expect(getRangeDates("custom", custom)).toEqual({
      start: "2025-06-11",
      end: "2025-06-11",
      label: "today",
    });
  });

  it("falls back to today for an unrecognized range", () => {
    pinTo(2025, 6, 11);
    expect(getRangeDates("nonsense" as AnalysisRange)).toEqual({
      start: "2025-06-11",
      end: "2025-06-11",
      label: "today",
    });
  });
});

describe("stripHiddenFlag", () => {
  it("drops the hidden field and keeps role and content", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys", hidden: true },
      { role: "user", content: "hello", hidden: false },
      { role: "assistant", content: "hi there" },
    ];
    const stripped = stripHiddenFlag(messages);
    expect(stripped).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    for (const message of stripped) {
      expect(message).not.toHaveProperty("hidden");
    }
  });

  it("does not mutate the original messages", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hello", hidden: true }];
    stripHiddenFlag(messages);
    expect(messages[0]).toEqual({ role: "user", content: "hello", hidden: true });
  });
});

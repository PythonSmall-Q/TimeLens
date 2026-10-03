import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "@/i18n/locales/en/common.json";
import enLlm from "@/i18n/locales/en/llm.json";
import type { LlmConfig, LlmConversation, LlmConversationSummary } from "@/types/llm";
import LlmInsights from "./index";

// Lightweight i18n instance with the real en resources the page renders.
const testI18n = i18n.createInstance();
testI18n.use(initReactI18next).init({
  resources: { en: { common: enCommon, llm: enLlm } },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "llm"],
  interpolation: { escapeValue: false },
});

// Hoisted delegation mocks: vi.mock factories delegate to these so mutable
// state and call assertions are shared reliably across the mocked module.
const mocks = vi.hoisted(() => ({
  holder: {
    config: null as LlmConfig | null,
    conversations: [] as LlmConversationSummary[],
    activeConversationId: null as string | null,
    conversationsLoading: false,
    sidebarTodaySeconds: 0,
  },
  setActiveProvider: vi.fn(),
  loadConversations: vi.fn(),
  createConversation: vi.fn(),
  saveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  archiveConversation: vi.fn(),
  pinConversation: vi.fn(),
  setActiveConversation: vi.fn(),
  appendMessages: vi.fn(),
  summarizeConversation: vi.fn(),
  streamChatCompletion: vi.fn(),
  buildScreenTimeContext: vi.fn(),
  getLlmConversation: vi.fn(),
}));

vi.mock("@/stores/llmStore", () => ({
  useLlmStore: () => ({
    config: mocks.holder.config,
    setActiveProvider: mocks.setActiveProvider,
  }),
}));

vi.mock("@/stores/llmConversationStore", () => ({
  useLlmConversationStore: () => ({
    conversations: mocks.holder.conversations,
    activeConversationId: mocks.holder.activeConversationId,
    loading: mocks.holder.conversationsLoading,
    loadConversations: mocks.loadConversations,
    createConversation: mocks.createConversation,
    saveConversation: mocks.saveConversation,
    deleteConversation: mocks.deleteConversation,
    archiveConversation: mocks.archiveConversation,
    pinConversation: mocks.pinConversation,
    setActiveConversation: mocks.setActiveConversation,
    appendMessages: mocks.appendMessages,
    summarizeConversation: mocks.summarizeConversation,
  }),
}));

vi.mock("@/stores/statsStore", () => ({
  useStatsStore: () => ({
    sidebarTodaySeconds: mocks.holder.sidebarTodaySeconds,
  }),
}));

vi.mock("@/services/llmApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/llmApi")>();
  return {
    ...actual,
    streamChatCompletion: (...args: unknown[]) => mocks.streamChatCompletion(...args),
    buildScreenTimeContext: (...args: unknown[]) => mocks.buildScreenTimeContext(...args),
    getLlmConversation: (...args: unknown[]) => mocks.getLlmConversation(...args),
  };
});

vi.mock("@/services/tauriApi", () => ({
  getAppTotalsInRange: vi.fn().mockResolvedValue([]),
  getCategoryTotalsInRange: vi.fn().mockResolvedValue([]),
  listFocusSessions: vi.fn().mockResolvedValue([]),
  getInterruptionPeriods: vi.fn().mockResolvedValue([]),
  getUsageGoals: vi.fn().mockResolvedValue([]),
  getGoalProgress: vi.fn().mockResolvedValue([]),
}));

const makeSummary = (overrides: Partial<LlmConversationSummary> = {}): LlmConversationSummary => ({
  id: "conv-1",
  title: "Conversation",
  created_at: "2025-01-01T09:00:00",
  updated_at: "2025-01-01T10:00:00",
  archived: false,
  pinned: false,
  message_count: 0,
  ...overrides,
});

const makeConversation = (overrides: Partial<LlmConversation> = {}): LlmConversation => ({
  id: "conv-1",
  title: "Conversation",
  created_at: "2025-01-01T09:00:00",
  updated_at: "2025-01-01T10:00:00",
  archived: false,
  pinned: false,
  messages: [],
  ...overrides,
});

const makeConfig = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  active_provider_id: "orcarouter",
  providers: {
    orcarouter: {
      name: "OrcaRouter",
      nickname: "OrcaRouter",
      base_url: "https://api.orcarouter.ai/v1",
      model: "orcarouter/auto",
      api_key: "test-key",
      builtin: true,
    },
    openai: {
      name: "OpenAI",
      nickname: "OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      api_key: "test-key",
      builtin: true,
    },
    groq: {
      name: "Groq",
      nickname: "Groq",
      base_url: "https://api.groq.com/openai/v1",
      model: "llama-3.1-70b-versatile",
      api_key: "test-key",
      builtin: true,
    },
  },
  data_sharing: {
    total_time: true,
    top_apps: true,
    categories: true,
    focus_time: true,
    goals: true,
    interruptions: true,
  },
  default_range: "today",
  ...overrides,
});

function renderWithProviders(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

describe("LlmInsights page", () => {
  beforeAll(() => {
    // jsdom does not implement scrollTo; the page scrolls the chat on updates.
    Element.prototype.scrollTo = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.holder.config = makeConfig();
    mocks.holder.conversations = [];
    mocks.holder.activeConversationId = null;
    mocks.holder.conversationsLoading = false;
    mocks.holder.sidebarTodaySeconds = 3600;

    mocks.loadConversations.mockResolvedValue(undefined);
    mocks.createConversation.mockResolvedValue(makeConversation());
    mocks.saveConversation.mockResolvedValue(undefined);
    mocks.deleteConversation.mockResolvedValue(undefined);
    mocks.archiveConversation.mockResolvedValue(undefined);
    mocks.pinConversation.mockResolvedValue(undefined);
    mocks.setActiveConversation.mockImplementation((id: string | null) => {
      mocks.holder.activeConversationId = id;
    });
    mocks.appendMessages.mockResolvedValue(null);
    mocks.summarizeConversation.mockResolvedValue(null);
    mocks.streamChatCompletion.mockImplementation(
      async (options: { onDone?: () => void }) => {
        options.onDone?.();
      }
    );
    mocks.buildScreenTimeContext.mockReturnValue([
      { role: "system", content: "Screen-time context", hidden: true },
    ]);
    mocks.getLlmConversation.mockResolvedValue(null);
  });

  it("renders the page title, subtitle, and empty state when the active conversation has no messages", async () => {
    mocks.holder.conversations = [makeSummary({ id: "conv-1", title: "Morning analysis" })];
    mocks.holder.activeConversationId = "conv-1";
    mocks.getLlmConversation.mockResolvedValue(
      makeConversation({ id: "conv-1", messages: [] })
    );

    renderWithProviders(<LlmInsights />);

    expect(screen.getByRole("heading", { name: "AI Insights" })).toBeInTheDocument();
    expect(
      screen.getByText("Ask AI to analyze your screen time and productivity habits.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Click the button above to get a personalized screen-time analysis."
      )
    ).toBeInTheDocument();
  });

  it("hides archived conversations under the Active tab", () => {
    mocks.holder.conversations = [
      makeSummary({ id: "a1", title: "Alpha chat", archived: false }),
      makeSummary({ id: "a2", title: "Beta chat", archived: false }),
      makeSummary({ id: "r1", title: "Gamma chat", archived: true }),
      makeSummary({ id: "r2", title: "Delta chat", archived: true }),
    ];
    mocks.holder.activeConversationId = "a1";

    renderWithProviders(<LlmInsights />);

    expect(screen.getByText("Alpha chat")).toBeInTheDocument();
    expect(screen.getByText("Beta chat")).toBeInTheDocument();
    expect(screen.queryByText("Gamma chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Delta chat")).not.toBeInTheDocument();
  });

  it("surfaces archived conversations under the Archived tab", async () => {
    mocks.holder.conversations = [
      makeSummary({ id: "a1", title: "Alpha chat", archived: false }),
      makeSummary({ id: "r1", title: "Gamma chat", archived: true }),
      makeSummary({ id: "r2", title: "Delta chat", archived: true }),
    ];
    mocks.holder.activeConversationId = "a1";

    renderWithProviders(<LlmInsights />);
    await userEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(screen.getByText("Gamma chat")).toBeInTheDocument();
    expect(screen.getByText("Delta chat")).toBeInTheDocument();
    // The Archived tab must list archived conversations only; active ones
    // stay under the Active tab.
    expect(screen.queryByText("Alpha chat")).not.toBeInTheDocument();
  });

  it("calls setActiveConversation with the clicked conversation id", async () => {
    mocks.holder.conversations = [
      makeSummary({ id: "conv-1", title: "First chat" }),
      makeSummary({ id: "conv-2", title: "Second chat" }),
    ];
    mocks.holder.activeConversationId = "conv-1";

    renderWithProviders(<LlmInsights />);
    await userEvent.click(screen.getByText("Second chat"));

    expect(mocks.setActiveConversation).toHaveBeenCalledWith("conv-2");
  });

  it("calls createConversation when the new-conversation button is clicked", async () => {
    mocks.holder.conversations = [makeSummary({ id: "conv-1", title: "Existing chat" })];
    mocks.holder.activeConversationId = "conv-1";

    renderWithProviders(<LlmInsights />);
    mocks.createConversation.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
  });

  it("lists configured providers with OrcaRouter first regardless of alphabetical order", async () => {
    // Insertion order is deliberately not the expected display order.
    mocks.holder.config = makeConfig({
      active_provider_id: "orcarouter",
      providers: {
        openai: {
          name: "OpenAI",
          nickname: "OpenAI",
          base_url: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          builtin: true,
        },
        groq: {
          name: "Groq",
          nickname: "Groq",
          base_url: "https://api.groq.com/openai/v1",
          model: "llama-3.1-70b-versatile",
          builtin: true,
        },
        orcarouter: {
          name: "OrcaRouter",
          nickname: "OrcaRouter",
          base_url: "https://api.orcarouter.ai/v1",
          model: "orcarouter/auto",
          builtin: true,
        },
      },
    });
    mocks.holder.conversations = [makeSummary({ id: "conv-1", title: "Chat" })];
    mocks.holder.activeConversationId = "conv-1";

    renderWithProviders(<LlmInsights />);

    const selector = screen.getByRole("button", { name: /OrcaRouter/ });
    expect(selector).toBeInTheDocument();

    await userEvent.click(selector);

    const menu = screen.getByText("Select model").parentElement as HTMLElement;
    const options = within(menu).getAllByRole("button").map((button) => button.textContent);
    // Alphabetical order would be Groq, OpenAI, OrcaRouter; OrcaRouter must lead.
    expect(options).toEqual(["OrcaRouter", "OpenAI", "Groq"]);
  });

  it("renders the assistant reply but keeps a hidden system message out of the DOM", async () => {
    mocks.holder.conversations = [
      makeSummary({ id: "conv-1", title: "Chat", message_count: 2 }),
    ];
    mocks.holder.activeConversationId = "conv-1";
    mocks.getLlmConversation.mockResolvedValue(
      makeConversation({
        id: "conv-1",
        messages: [
          { role: "system", content: "HIDDEN SYSTEM PROMPT", hidden: true },
          { role: "assistant", content: "Visible assistant reply" },
        ],
      })
    );

    renderWithProviders(<LlmInsights />);

    expect(await screen.findByText("Visible assistant reply")).toBeInTheDocument();
    expect(screen.queryByText("HIDDEN SYSTEM PROMPT")).not.toBeInTheDocument();
    // With a visible assistant reply the analysis counts as done, unlocking follow-ups.
    expect(
      screen.getByPlaceholderText("Ask a follow-up question…")
    ).toBeInTheDocument();
  });
});

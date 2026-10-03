import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatMessage,
  LlmConversation,
  LlmConversationSummary,
} from "@/types/llm";

// In-memory backend standing in for the SQLite persistence layer.
const conversations = new Map<string, LlmConversation>();

const toSummary = (c: LlmConversation): LlmConversationSummary => ({
  id: c.id,
  title: c.title,
  created_at: c.created_at,
  updated_at: c.updated_at,
  archived: c.archived,
  pinned: c.pinned,
  message_count: c.messages.length,
});

const mockGetLlmConversations = vi.fn();
const mockGetLlmConversation = vi.fn();
const mockSaveLlmConversation = vi.fn();
const mockDeleteLlmConversation = vi.fn();
const mockArchiveLlmConversation = vi.fn();
const mockPinLlmConversation = vi.fn();

vi.mock("@/services/llmApi", () => ({
  getLlmConversations: (...args: unknown[]) => mockGetLlmConversations(...args),
  getLlmConversation: (...args: unknown[]) => mockGetLlmConversation(...args),
  saveLlmConversation: (...args: unknown[]) => mockSaveLlmConversation(...args),
  deleteLlmConversation: (...args: unknown[]) => mockDeleteLlmConversation(...args),
  archiveLlmConversation: (...args: unknown[]) => mockArchiveLlmConversation(...args),
  pinLlmConversation: (...args: unknown[]) => mockPinLlmConversation(...args),
}));

import { useLlmConversationStore } from "./llmConversationStore";

const initialState = useLlmConversationStore.getState();

const userMessage: ChatMessage = { role: "user", content: "How did I spend today?" };
const assistantMessage: ChatMessage = { role: "assistant", content: "Mostly coding." };

const seedConversation = (overrides: Partial<LlmConversation> = {}): LlmConversation => {
  const conversation: LlmConversation = {
    id: "conv-1",
    title: "Seeded",
    created_at: "2025-01-01T08:00:00.000Z",
    updated_at: "2025-01-01T08:00:00.000Z",
    archived: false,
    pinned: false,
    messages: [userMessage],
    ...overrides,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
};

beforeEach(() => {
  conversations.clear();
  window.localStorage.clear();
  useLlmConversationStore.setState(initialState, false);
  vi.clearAllMocks();

  mockGetLlmConversations.mockImplementation(async (includeArchived = false) =>
    [...conversations.values()]
      .filter((c) => includeArchived || !c.archived)
      .map(toSummary)
  );
  mockGetLlmConversation.mockImplementation(async (id: string) => conversations.get(id) ?? null);
  mockSaveLlmConversation.mockImplementation(async (conversation: LlmConversation) => {
    conversations.set(conversation.id, conversation);
  });
  mockDeleteLlmConversation.mockImplementation(async (id: string) => {
    conversations.delete(id);
  });
  mockArchiveLlmConversation.mockImplementation(async (id: string, archived: boolean) => {
    const existing = conversations.get(id);
    if (existing) conversations.set(id, { ...existing, archived });
  });
  mockPinLlmConversation.mockImplementation(async (id: string, pinned: boolean) => {
    const existing = conversations.get(id);
    if (existing) conversations.set(id, { ...existing, pinned });
  });
});

describe("createConversation", () => {
  it("saves the conversation, makes it active, and lists it", async () => {
    const conversation = await useLlmConversationStore
      .getState()
      .createConversation([userMessage], "My chat");

    expect(conversation.id).toBeTruthy();
    expect(conversation.title).toBe("My chat");
    expect(conversation.messages).toEqual([userMessage]);
    expect(conversation.archived).toBe(false);
    expect(conversation.pinned).toBe(false);
    expect(mockSaveLlmConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: conversation.id, title: "My chat" })
    );

    const state = useLlmConversationStore.getState();
    expect(state.activeConversationId).toBe(conversation.id);
    expect(state.conversations).toEqual([
      expect.objectContaining({ id: conversation.id, title: "My chat", message_count: 1 }),
    ]);
  });

  it("defaults to an empty message list and the fallback title", async () => {
    const conversation = await useLlmConversationStore.getState().createConversation();

    expect(conversation.title).toBe("New conversation");
    expect(conversation.messages).toEqual([]);
    expect(conversations.get(conversation.id)?.messages).toEqual([]);
  });
});

describe("appendMessages", () => {
  it("appends to the fetched conversation and saves it", async () => {
    seedConversation();

    const updated = await useLlmConversationStore
      .getState()
      .appendMessages("conv-1", [assistantMessage, userMessage]);

    expect(updated?.messages).toEqual([userMessage, assistantMessage, userMessage]);
    expect(conversations.get("conv-1")?.messages).toHaveLength(3);
    expect(mockSaveLlmConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conv-1" })
    );
  });

  it("returns null without saving when the conversation does not exist", async () => {
    const updated = await useLlmConversationStore
      .getState()
      .appendMessages("missing", [userMessage]);

    expect(updated).toBeNull();
    expect(mockSaveLlmConversation).not.toHaveBeenCalled();
  });
});

describe("summarizeConversation", () => {
  it("replaces the conversation messages with the summary", async () => {
    seedConversation({ messages: [userMessage, assistantMessage, userMessage, assistantMessage] });
    const summary: ChatMessage[] = [
      { role: "assistant", content: "Summary of the chat so far." },
      { role: "user", content: "Follow-up" },
    ];

    const updated = await useLlmConversationStore
      .getState()
      .summarizeConversation("conv-1", summary);

    expect(updated?.messages).toEqual(summary);
    expect(conversations.get("conv-1")?.messages).toEqual(summary);
    expect(mockSaveLlmConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conv-1", messages: summary })
    );
  });

  it("returns null for an unknown conversation", async () => {
    const updated = await useLlmConversationStore
      .getState()
      .summarizeConversation("missing", [assistantMessage]);

    expect(updated).toBeNull();
    expect(mockSaveLlmConversation).not.toHaveBeenCalled();
  });
});

describe("archiveConversation and pinConversation", () => {
  it("archives through the api and reloads the list", async () => {
    seedConversation();

    await useLlmConversationStore.getState().archiveConversation("conv-1", true);

    expect(mockArchiveLlmConversation).toHaveBeenCalledWith("conv-1", true);
    const state = useLlmConversationStore.getState();
    expect(state.conversations).toEqual([
      expect.objectContaining({ id: "conv-1", archived: true }),
    ]);
  });

  it("pins through the api and reloads the list", async () => {
    seedConversation();

    await useLlmConversationStore.getState().pinConversation("conv-1", true);

    expect(mockPinLlmConversation).toHaveBeenCalledWith("conv-1", true);
    const state = useLlmConversationStore.getState();
    expect(state.conversations).toEqual([expect.objectContaining({ id: "conv-1", pinned: true })]);
  });
});

describe("deleteConversation", () => {
  it("clears activeConversationId when the active conversation is deleted", async () => {
    seedConversation();
    useLlmConversationStore.getState().setActiveConversation("conv-1");

    await useLlmConversationStore.getState().deleteConversation("conv-1");

    expect(mockDeleteLlmConversation).toHaveBeenCalledWith("conv-1");
    expect(conversations.has("conv-1")).toBe(false);
    const state = useLlmConversationStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.activeConversationId).toBeNull();
  });

  it("keeps activeConversationId when a different conversation is deleted", async () => {
    seedConversation();
    seedConversation({ id: "conv-2", title: "Other" });
    useLlmConversationStore.getState().setActiveConversation("conv-1");

    await useLlmConversationStore.getState().deleteConversation("conv-2");

    expect(useLlmConversationStore.getState().activeConversationId).toBe("conv-1");
  });
});

describe("setActiveConversation", () => {
  it("sets and clears the active conversation id", () => {
    useLlmConversationStore.getState().setActiveConversation("conv-1");
    expect(useLlmConversationStore.getState().activeConversationId).toBe("conv-1");

    useLlmConversationStore.getState().setActiveConversation(null);
    expect(useLlmConversationStore.getState().activeConversationId).toBeNull();
  });
});

describe("saveConversation", () => {
  it("bumps updated_at, persists, and reloads the list", async () => {
    const seeded = seedConversation();
    const edited: LlmConversation = { ...seeded, title: "Renamed" };

    await useLlmConversationStore.getState().saveConversation(edited);

    const stored = conversations.get("conv-1");
    expect(stored?.title).toBe("Renamed");
    expect(stored?.updated_at).not.toBe("2025-01-01T08:00:00.000Z");
    expect(useLlmConversationStore.getState().conversations).toEqual([
      expect.objectContaining({ id: "conv-1", title: "Renamed" }),
    ]);
  });
});

describe("loadConversations", () => {
  it("records the error message when the backend call fails", async () => {
    mockGetLlmConversations.mockRejectedValue(new Error("database locked"));

    await useLlmConversationStore.getState().loadConversations();

    const state = useLlmConversationStore.getState();
    expect(state.error).toBe("database locked");
    expect(state.loading).toBe(false);
  });
});

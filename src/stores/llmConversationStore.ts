import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as api from "@/services/llmApi";
import type { LlmConversation, LlmConversationSummary, ChatMessage } from "@/types/llm";

interface LlmConversationState {
  conversations: LlmConversationSummary[];
  activeConversationId: string | null;
  loading: boolean;
  error: string | null;

  loadConversations: () => Promise<void>;
  createConversation: (initialMessages?: ChatMessage[], title?: string) => Promise<LlmConversation>;
  saveConversation: (conversation: LlmConversation) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  archiveConversation: (id: string, archived: boolean) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  appendMessages: (id: string, messages: ChatMessage[]) => Promise<LlmConversation | null>;
  summarizeConversation: (id: string, summaryMessages: ChatMessage[]) => Promise<LlmConversation | null>;
}

const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    localStorage.removeItem(name);
  },
}));

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useLlmConversationStore = create<LlmConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      loading: false,
      error: null,

      loadConversations: async () => {
        set({ loading: true, error: null });
        try {
          const conversations = await api.getLlmConversations(true);
          set({ conversations, loading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        }
      },

      createConversation: async (initialMessages = [], title) => {
        const id = generateId();
        const conversation: LlmConversation = {
          id,
          title: title || "New conversation",
          created_at: nowIso(),
          updated_at: nowIso(),
          archived: false,
          pinned: false,
          messages: initialMessages,
        };
        await api.saveLlmConversation(conversation);
        await get().loadConversations();
        set({ activeConversationId: id });
        return conversation;
      },

      saveConversation: async (conversation) => {
        const updated = { ...conversation, updated_at: nowIso() };
        await api.saveLlmConversation(updated);
        await get().loadConversations();
      },

      deleteConversation: async (id) => {
        await api.deleteLlmConversation(id);
        await get().loadConversations();
        const { activeConversationId } = get();
        if (activeConversationId === id) {
          set({ activeConversationId: null });
        }
      },

      archiveConversation: async (id, archived) => {
        await api.archiveLlmConversation(id, archived);
        await get().loadConversations();
      },

      pinConversation: async (id, pinned) => {
        await api.pinLlmConversation(id, pinned);
        await get().loadConversations();
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      appendMessages: async (id, messages) => {
        const full = await api.getLlmConversation(id);
        if (!full) return null;
        const updated: LlmConversation = {
          ...full,
          messages: [...full.messages, ...messages],
          updated_at: nowIso(),
        };
        await api.saveLlmConversation(updated);
        await get().loadConversations();
        return updated;
      },

      summarizeConversation: async (id, summaryMessages) => {
        const full = await api.getLlmConversation(id);
        if (!full) return null;
        const updated: LlmConversation = {
          ...full,
          messages: summaryMessages,
          updated_at: nowIso(),
        };
        await api.saveLlmConversation(updated);
        await get().loadConversations();
        return updated;
      },
    }),
    {
      name: "timelens-llm-conversations",
      storage: safeStorage,
      partialize: (state) => ({ activeConversationId: state.activeConversationId }),
    }
  )
);

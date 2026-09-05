import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  Bot,
  User,
  Check,
  ChevronDown,
  Plus,
  Trash2,
  Archive,
  Pin,
  MessageSquare,
  MoreVertical,
  Clock,
  FoldVertical,
} from "lucide-react";
import { useLlmStore } from "@/stores/llmStore";
import { useLlmConversationStore } from "@/stores/llmConversationStore";
import { useStatsStore } from "@/stores/statsStore";
import {
  streamChatCompletion,
  buildScreenTimeContext,
  getRangeDates,
  providerRank,
} from "@/services/llmApi";
import {
  getAppTotalsInRange,
  getCategoryTotalsInRange,
  listFocusSessions,
  getInterruptionPeriods,
  getUsageGoals,
  getGoalProgress,
} from "@/services/tauriApi";
import clsx from "clsx";
import type { ChatMessage, LlmConversation, LlmProvider, AnalysisRange } from "@/types/llm";
import type { AppUsageSummary, CategoryUsageSummary } from "@/types";

function providerDisplayLabel(provider: LlmProvider): string {
  return provider.nickname?.trim() || provider.name;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function generateTitle(): string {
  const d = new Date();
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export default function LlmInsights() {
  const { t, i18n } = useTranslation(["llm", "common"]);
  const currentLanguage = i18n.language;
  const { config, setActiveProvider } = useLlmStore();
  const { sidebarTodaySeconds } = useStatsStore();
  const {
    conversations,
    activeConversationId,
    loading: conversationsLoading,
    loadConversations,
    createConversation,
    saveConversation,
    deleteConversation,
    archiveConversation,
    pinConversation,
    setActiveConversation,
    appendMessages,
    summarizeConversation,
  } = useLlmConversationStore();

  const [conversation, setConversation] = useState<LlmConversation | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<AnalysisRange>(config.default_range || "today");
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>(() => {
    const today = new Date().toISOString().split("T")[0];
    return { start: today, end: today };
  });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const menuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeProvider = config.active_provider_id
    ? config.providers[config.active_provider_id]
    : undefined;
  const providerIds = useMemo(() => {
    const ids = Object.keys(config.providers);
    ids.sort((a, b) => {
      const ra = providerRank(config.providers[a]);
      const rb = providerRank(config.providers[b]);
      if (ra !== rb) return ra - rb;
      const la = providerDisplayLabel(config.providers[a]).toLowerCase();
      const lb = providerDisplayLabel(config.providers[b]).toLowerCase();
      return la.localeCompare(lb);
    });
    return ids;
  }, [config.providers]);

  // Load conversations and config on mount.
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Sync local range with config default when it loads.
  useEffect(() => {
    if (config.default_range) {
      setRange(config.default_range);
    }
  }, [config.default_range]);

  // Load active conversation details.
  useEffect(() => {
    if (!activeConversationId) {
      setConversation(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { getLlmConversation } = await import("@/services/llmApi");
        const conv = await getLlmConversation(activeConversationId);
        if (!cancelled) setConversation(conv);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  // Auto-create a conversation if none exists and none is active.
  useEffect(() => {
    if (conversationsLoading) return;
    if (!activeConversationId && conversations.length > 0) {
      const first = conversations.find((c) => !c.archived) || conversations[0];
      setActiveConversation(first.id);
    } else if (!activeConversationId && conversations.length === 0) {
      void createConversation([], `${generateTitle()} ${t("llm:analysisSuffix")}`);
    }
  }, [conversationsLoading, activeConversationId, conversations, createConversation, setActiveConversation, t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages, loading]);

  useEffect(() => {
    if (!selectorOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!selectorRef.current?.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [selectorOpen]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      const node = menuRefs.current[menuOpenId];
      if (node && !node.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpenId]);

  const gatherContext = useCallback(async (): Promise<ChatMessage[]> => {
    const { start, end, label } = getRangeDates(range, range === "custom" ? customRange : undefined);
    const startAt = `${start}T00:00:00`;
    const endAt = `${end}T23:59:59`;

    const [apps, categories, sessions, interruptions, goals, progress] = await Promise.all([
      getAppTotalsInRange(start, end),
      getCategoryTotalsInRange(start, end),
      listFocusSessions(startAt, endAt),
      getInterruptionPeriods(end),
      getUsageGoals(),
      getGoalProgress(1),
    ]);

    const focusSeconds = sessions.reduce((sum, s) => {
      const startTime = new Date(s.started_at).getTime();
      const endTime = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
      return sum + Math.max(0, endTime - startTime) / 1000;
    }, 0);

    const interruptionCount = (interruptions ?? []).reduce((sum, i) => sum + i.switch_count, 0);

    const topApps = (apps as AppUsageSummary[])
      .map((a) => ({ name: a.app_name, seconds: a.total_seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 5);

    const categoryList = (categories as CategoryUsageSummary[])
      .map((c) => ({ name: c.category, seconds: c.total_seconds }))
      .sort((a, b) => b.seconds - a.seconds);

    const activeGoals = (goals ?? [])
      .filter((g) => g.enabled)
      .slice(0, 5)
      .map((g) => {
        const p = (progress ?? []).find((item) => item.goal.id === g.id);
        return { name: `${g.scope_value} (${g.period})`, progress: p?.progress_ratio ?? 0 };
      });

    return buildScreenTimeContext({
      todaySeconds: sidebarTodaySeconds,
      topApps,
      categories: categoryList,
      focusMinutes: focusSeconds / 60,
      goals: activeGoals,
      interruptions: interruptionCount,
      language: currentLanguage,
      dataSharing: config.data_sharing,
      rangeLabel: label,
    });
  }, [range, customRange, sidebarTodaySeconds, currentLanguage, config.data_sharing]);

  const ensureConversation = async (): Promise<LlmConversation> => {
    if (conversation) return conversation;
    const conv = await createConversation([], `${generateTitle()} ${t("llm:analysisSuffix")}`);
    setConversation(conv);
    return conv;
  };

  const runAnalysis = async () => {
    if (!activeProvider?.base_url || !activeProvider.api_key || !activeProvider.model) {
      setError(t("llm:missingConfigError"));
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const context = await gatherContext();
      const conv = await ensureConversation();

      const updated: LlmConversation = {
        ...conv,
        messages: context,
        title: conv.title || `${generateTitle()} ${t("llm:analysisSuffix")}`,
        updated_at: new Date().toISOString(),
      };
      await saveConversation(updated);
      setConversation(updated);

      let currentContent = "";
      await streamChatCompletion({
        baseUrl: activeProvider.base_url,
        apiKey: activeProvider.api_key,
        model: activeProvider.model,
        messages: context,
        onChunk: (chunk) => {
          currentContent += chunk;
          setConversation((prev) =>
            prev
              ? { ...prev, messages: [...context, { role: "assistant", content: currentContent }] }
              : prev
          );
        },
        onDone: async () => {
          setLoading(false);
          const finalMessages: ChatMessage[] = [
            ...context,
            { role: "assistant", content: currentContent },
          ];
          const finalConv: LlmConversation = {
            ...updated,
            messages: finalMessages,
            updated_at: new Date().toISOString(),
          };
          await saveConversation(finalConv);
          setConversation(finalConv);
        },
        onError: (err) => {
          setLoading(false);
          setError(err.message);
        },
      });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendFollowUp = async () => {
    if (!input.trim() || !activeProvider?.base_url || !activeProvider.api_key || !activeProvider.model || loading) return;
    if (!conversation) return;

    const userText = input.trim();
    setInput("");
    setError(null);
    setLoading(true);

    const userMessage: ChatMessage = { role: "user", content: userText };
    const messagesWithUser: ChatMessage[] = [...conversation.messages, userMessage];
    setConversation((prev) => (prev ? { ...prev, messages: messagesWithUser } : prev));

    try {
      await appendMessages(conversation.id, [userMessage]);

      let currentContent = "";
      await streamChatCompletion({
        baseUrl: activeProvider.base_url,
        apiKey: activeProvider.api_key,
        model: activeProvider.model,
        messages: messagesWithUser,
        onChunk: (chunk) => {
          currentContent += chunk;
          setConversation((prev) =>
            prev
              ? { ...prev, messages: [...messagesWithUser, { role: "assistant", content: currentContent }] }
              : prev
          );
        },
        onDone: async () => {
          setLoading(false);
          const finalMessages: ChatMessage[] = [
            ...messagesWithUser,
            { role: "assistant", content: currentContent },
          ];
          const finalConv: LlmConversation = {
            ...conversation,
            messages: finalMessages,
            updated_at: new Date().toISOString(),
          };
          await saveConversation(finalConv);
          setConversation(finalConv);
        },
        onError: (err) => {
          setLoading(false);
          setError(err.message);
        },
      });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSummarize = async () => {
    if (!conversation || conversation.messages.length === 0 || !activeProvider) return;
    if (!activeProvider.base_url || !activeProvider.api_key || !activeProvider.model) {
      setError(t("llm:missingConfigError"));
      return;
    }
    setLoading(true);
    setError(null);

    const summarizePrompt: ChatMessage[] = [
      {
        role: "system",
        content:
          "Summarize the following conversation into a concise system context that preserves the key facts, data, and user intent. The summary will replace the conversation history to save tokens. Keep it under 300 words.",
      },
      ...conversation.messages,
    ];

    let summary = "";
    await streamChatCompletion({
      baseUrl: activeProvider.base_url,
      apiKey: activeProvider.api_key,
      model: activeProvider.model,
      messages: summarizePrompt,
      onChunk: (chunk) => {
        summary += chunk;
      },
      onDone: () => {
        setLoading(false);
      },
      onError: (err) => {
        setLoading(false);
        setError(err.message);
      },
    });

    if (!summary) return;

    const summaryMessages: ChatMessage[] = [
      {
        role: "system",
        content: `Earlier context summary: ${summary}`,
        hidden: true,
      },
    ];
    const updated = await summarizeConversation(conversation.id, summaryMessages);
    if (updated) setConversation(updated);
  };

  const handleNewConversation = () => {
    void createConversation([], `${generateTitle()} ${t("llm:analysisSuffix")}`);
  };

  const visibleConversations = useMemo(() => {
    const list = conversations.filter((c) => showArchived || c.archived === showArchived);
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [conversations, showArchived]);

  const visibleMessages = useMemo(
    () => conversation?.messages.filter((m) => !m.hidden) ?? [],
    [conversation?.messages]
  );

  const analysisDone =
    visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1].role === "assistant";

  return (
    <div className="h-full flex animate-fade-in">
      {/* Sidebar */}
      <div className="w-60 border-r border-surface-border bg-surface-light flex flex-col">
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <MessageSquare size={16} />
            {t("llm:conversations")}
          </h2>
          <button
            onClick={handleNewConversation}
            className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
            title={t("llm:newConversation")}
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-3 py-2">
          <button
            onClick={() => setShowArchived(false)}
            className={clsx(
              "text-xs px-2 py-1 rounded-lg transition-colors",
              !showArchived ? "bg-accent-blue/20 text-accent-blue" : "text-text-secondary hover:bg-surface-hover"
            )}
          >
            {t("llm:tabActive")}
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className={clsx(
              "text-xs px-2 py-1 rounded-lg transition-colors",
              showArchived ? "bg-accent-blue/20 text-accent-blue" : "text-text-secondary hover:bg-surface-hover"
            )}
          >
            {t("llm:tabArchived")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {visibleConversations.map((conv) => {
            const isActive = activeConversationId === conv.id;
            return (
              <div
                key={conv.id}
                className={clsx(
                  "group relative rounded-xl px-3 py-2 cursor-pointer transition-colors",
                  isActive
                    ? "bg-accent-blue/10 border border-accent-blue/30"
                    : "border border-transparent hover:bg-surface-hover"
                )}
                onClick={() => setActiveConversation(conv.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-primary truncate flex items-center gap-1">
                      {conv.pinned && <Pin size={11} className="text-accent-blue flex-shrink-0" />}
                      {conv.title || t("llm:untitledConversation")}
                    </div>
                    <div className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5">
                      <Clock size={10} />
                      {formatDateTime(conv.updated_at)}
                      <span className="ml-1">· {conv.message_count} msgs</span>
                    </div>
                  </div>
                  <div
                    ref={(el) => {
                      menuRefs.current[conv.id] = el;
                    }}
                    className="relative"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === conv.id ? null : conv.id);
                      }}
                      className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {menuOpenId === conv.id && (
                      <div className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-surface-border bg-surface-card shadow-lg z-20 py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void pinConversation(conv.id, !conv.pinned);
                            setMenuOpenId(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover flex items-center gap-2"
                        >
                          <Pin size={12} />
                          {conv.pinned ? t("llm:unpin") : t("llm:pin")}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void archiveConversation(conv.id, !conv.archived);
                            setMenuOpenId(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover flex items-center gap-2"
                        >
                          <Archive size={12} />
                          {conv.archived ? t("llm:unarchive") : t("llm:archive")}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteConversation(conv.id);
                            setMenuOpenId(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-accent-red hover:bg-accent-red/10 flex items-center gap-2"
                        >
                          <Trash2 size={12} />
                          {t("common:delete")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-surface-border">
          <div className="min-w-0 flex-shrink-0">
            <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
              <Sparkles size={20} className="text-accent-blue flex-shrink-0" />
              {t("llm:pageTitle")}
            </h1>
            <p className="text-text-muted text-xs mt-0.5">{t("llm:pageSubtitle")}</p>
          </div>
          <div className="flex items-center flex-wrap justify-end gap-2">
            <div className="flex items-center gap-2">
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as AnalysisRange)}
                className="ui-field text-xs h-9 min-h-9 py-0 leading-5 pr-7"
                disabled={loading}
              >
                {(
                  [
                    ["today", t("llm:rangeToday")],
                    ["yesterday", t("llm:rangeYesterday")],
                    ["last_7_days", t("llm:rangeLast7Days")],
                    ["last_30_days", t("llm:rangeLast30Days")],
                    ["this_week", t("llm:rangeThisWeek")],
                    ["last_week", t("llm:rangeLastWeek")],
                    ["custom", t("llm:rangeCustom")],
                  ] as [AnalysisRange, string][]
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              {range === "custom" && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customRange.start}
                    max={customRange.end}
                    onChange={(e) =>
                      setCustomRange((prev) => ({ ...prev, start: e.target.value }))
                    }
                    disabled={loading}
                    className="ui-field text-xs h-8 py-0 px-2"
                    title={t("llm:startDate")}
                  />
                  <span className="text-text-muted text-xs">-</span>
                  <input
                    type="date"
                    value={customRange.end}
                    min={customRange.start}
                    onChange={(e) =>
                      setCustomRange((prev) => ({ ...prev, end: e.target.value }))
                    }
                    disabled={loading}
                    className="ui-field text-xs h-8 py-0 px-2"
                    title={t("llm:endDate")}
                  />
                </div>
              )}
            </div>

            <div ref={selectorRef} className="relative">
              <button
                onClick={() => setSelectorOpen((v) => !v)}
                disabled={providerIds.length === 0}
                className="inline-flex items-center gap-1.5 text-xs h-8 px-2.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover hover:border-surface-border/80 transition-colors disabled:opacity-50"
              >
                <span className="truncate max-w-[120px]">
                  {activeProvider ? providerDisplayLabel(activeProvider) : t("llm:noProvider")}
                </span>
                <ChevronDown size={13} className={clsx("flex-shrink-0 transition-transform", selectorOpen && "rotate-180")} />
              </button>

              {selectorOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-surface-border bg-surface-card shadow-lg shadow-black/10 py-1.5 z-50">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-medium">
                    {t("llm:selectModel")}
                  </div>
                  {providerIds.map((id) => {
                    const provider = config.providers[id];
                    const isActive = config.active_provider_id === id;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          void setActiveProvider(id);
                          setSelectorOpen(false);
                        }}
                        className={clsx(
                          "w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors",
                          isActive
                            ? "bg-accent-blue/10 text-accent-blue"
                            : "text-text-primary hover:bg-surface-hover"
                        )}
                      >
                        <span className="truncate">{providerDisplayLabel(provider)}</span>
                        {isActive && <Check size={14} className="flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {analysisDone && (
              <button
                onClick={() => void handleSummarize()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50 whitespace-nowrap"
                title={t("llm:summarizeTitle")}
              >
                <FoldVertical size={13} />
                {t("llm:summarize")}
              </button>
            )}

            <button
              onClick={() => void runAnalysis()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium
                         bg-gradient-to-r from-accent-blue to-accent-purple text-white
                         hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed
                         transition-opacity whitespace-nowrap"
            >
              {loading && !visibleMessages.some((m) => m.role === "assistant") ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {t("llm:analyzeButton")}
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-surface-border bg-surface-card/25 p-4 space-y-4 m-4 mb-0"
        >
          {visibleMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
              <Bot size={40} className="opacity-40" />
              <p className="text-sm">{t("llm:emptyState")}</p>
              <button
                onClick={() => void runAnalysis()}
                className="text-xs px-3 py-1.5 rounded-xl font-medium
                           bg-gradient-to-r from-accent-blue to-accent-purple text-white
                           shadow-[0_3px_10px_rgba(108,142,191,0.32)]
                           hover:shadow-[0_5px_16px_rgba(108,142,191,0.45)] hover:-translate-y-0.5
                           active:translate-y-0 transition-all duration-200"
              >
                {t("llm:analyzeButton")}
              </button>
            </div>
          ) : (
            visibleMessages.map((message, idx) => (
              <div
                key={idx}
                className={clsx(
                  "flex gap-3",
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div
                  className={clsx(
                    "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
                    message.role === "user" ? "bg-accent-blue/20 text-accent-blue" : "bg-accent-purple/20 text-accent-purple"
                  )}
                >
                  {message.role === "user" ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div
                  className={clsx(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-accent-blue/20 text-text-primary rounded-tr-sm whitespace-pre-wrap"
                      : "bg-surface-hover border border-surface-border text-text-primary rounded-tl-sm"
                  )}
                >
                  {message.role === "user" ? (
                    message.content
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        code: ({ children }) => <code className="px-1 py-0.5 rounded bg-surface-card text-xs font-mono">{children}</code>,
                        pre: ({ children }) => <pre className="p-2 rounded-lg bg-surface-card overflow-x-auto text-xs font-mono my-2">{children}</pre>,
                        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">{children}</a>,
                        h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 border-accent-blue/40 pl-3 italic text-text-secondary my-2">{children}</blockquote>,
                        hr: () => <hr className="border-surface-border my-2" />,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1].role === "user" && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-accent-purple/20 text-accent-purple flex items-center justify-center flex-shrink-0">
                <Bot size={14} />
              </div>
              <div className="bg-surface-hover border border-surface-border rounded-2xl rounded-tl-sm px-4 py-2.5">
                <Loader2 size={14} className="animate-spin text-text-muted" />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 flex items-start gap-2 text-xs text-accent-red">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <div className="p-4 flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
            placeholder={
              analysisDone
                ? t("llm:followUpPlaceholder")
                : t("llm:emptyInputPlaceholder")
            }
            disabled={loading || !analysisDone}
            className="ui-field flex-1"
          />
          <button
            onClick={() => void sendFollowUp()}
            disabled={loading || !input.trim() || !analysisDone}
            className="bg-accent-blue hover:bg-accent-glow disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2 transition-colors"
            aria-label={t("llm:send")}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

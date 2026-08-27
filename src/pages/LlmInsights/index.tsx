import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Send, Loader2, RotateCcw, AlertCircle, Bot, User, Check, ChevronDown } from "lucide-react";
import { useLlmStore } from "@/stores/llmStore";
import { useStatsStore } from "@/stores/statsStore";
import { streamChatCompletion, buildScreenTimeContext } from "@/services/llmApi";
import { todayString } from "@/utils/format";
import { getTodayAppTotals, getCategoryTotalsInRange, listFocusSessions, getInterruptionPeriods, getUsageGoals, getGoalProgress } from "@/services/tauriApi";
import clsx from "clsx";
import type { ChatMessage, LlmProvider } from "@/types/llm";
import type { AppUsageSummary, CategoryUsageSummary } from "@/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function providerDisplayLabel(provider: LlmProvider): string {
  return provider.nickname?.trim() || provider.name;
}

export default function LlmInsights() {
  const { t, i18n } = useTranslation(["llm", "common"]);
  const currentLanguage = i18n.language;
  const { config, setActiveProvider } = useLlmStore();
  const { sidebarTodaySeconds } = useStatsStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);

  const activeProvider = config.active_provider_id
    ? config.providers[config.active_provider_id]
    : undefined;
  const providerIds = Object.keys(config.providers);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!selectorOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!selectorRef.current?.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectorOpen]);

  const gatherContext = useCallback(async (): Promise<ChatMessage[]> => {
    const today = todayString();
    const [apps, categories, sessions, interruptions, goals, progress] = await Promise.all([
      getTodayAppTotals(),
      getCategoryTotalsInRange(today, today),
      listFocusSessions(`${today}T00:00:00`, `${today}T23:59:59`),
      getInterruptionPeriods(today),
      getUsageGoals(),
      getGoalProgress(1),
    ]);

    const focusSeconds = sessions.reduce((sum, s) => {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
      return sum + Math.max(0, end - start) / 1000;
    }, 0);

    const interruptionCount = interruptions.reduce((sum, i) => sum + i.switch_count, 0);

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
    });
  }, [sidebarTodaySeconds, currentLanguage]);

  const runAnalysis = async () => {
    if (!activeProvider?.base_url || !activeProvider.api_key || !activeProvider.model) {
      setError(t("llm:missingConfigError"));
      return;
    }
    setLoading(true);
    setError(null);
    setMessages([]);
    setAnalysisDone(false);

    try {
      const context = await gatherContext();
      const initialMessages: Message[] = [];
      setMessages(initialMessages);

      let currentContent = "";
      await streamChatCompletion({
        baseUrl: activeProvider.base_url,
        apiKey: activeProvider.api_key,
        model: activeProvider.model,
        messages: context,
        onChunk: (chunk) => {
          currentContent += chunk;
          setMessages([{ role: "assistant", content: currentContent }]);
        },
        onDone: () => {
          setLoading(false);
          setAnalysisDone(true);
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

    const userText = input.trim();
    setInput("");
    setError(null);
    setLoading(true);

    const updatedMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(updatedMessages);

    try {
      const chatMessages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a productivity assistant inside TimeLens. Answer follow-up questions based on the earlier screen-time analysis. Be concise and actionable.",
        },
        ...updatedMessages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      ];

      let currentContent = "";
      await streamChatCompletion({
        baseUrl: activeProvider.base_url,
        apiKey: activeProvider.api_key,
        model: activeProvider.model,
        messages: chatMessages,
        onChunk: (chunk) => {
          currentContent += chunk;
          setMessages([...updatedMessages, { role: "assistant", content: currentContent }]);
        },
        onDone: () => {
          setLoading(false);
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

  return (
    <div className="p-6 h-full flex flex-col animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Sparkles size={20} className="text-accent-blue" />
            {t("llm:pageTitle")}
          </h1>
          <p className="text-text-muted text-xs mt-0.5">{t("llm:pageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div ref={selectorRef} className="relative">
            <button
              onClick={() => setSelectorOpen((v) => !v)}
              disabled={providerIds.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover hover:border-surface-border/80 transition-colors disabled:opacity-50"
            >
              {activeProvider ? providerDisplayLabel(activeProvider) : t("llm:noProvider")}
              <ChevronDown size={13} className={clsx("transition-transform", selectorOpen && "rotate-180")} />
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
          <button
            onClick={() => void runAnalysis()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-accent-blue to-accent-purple text-white
                       shadow-[0_4px_14px_rgba(108,142,191,0.35)]
                       hover:shadow-[0_6px_20px_rgba(108,142,191,0.48)] hover:-translate-y-0.5
                       active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed
                       transition-all duration-200"
          >
            {loading && messages.length === 0 ? (
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
        className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-surface-border bg-surface-card/25 p-4 space-y-4"
      >
        {messages.length === 0 && !error && (
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
        )}

        {messages.map((message, idx) => (
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
        ))}

        {loading && messages.length > 0 && messages[messages.length - 1].role === "user" && (
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

      <div className="mt-4 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
          placeholder={analysisDone ? t("llm:followUpPlaceholder") : t("llm:emptyInputPlaceholder")}
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
        <button
          onClick={() => {
            setMessages([]);
            setAnalysisDone(false);
            setError(null);
          }}
          disabled={loading || messages.length === 0}
          className="p-2 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
          title={t("llm:newAnalysis")}
          aria-label={t("llm:newAnalysis")}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}

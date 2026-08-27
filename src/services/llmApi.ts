import { invoke } from "@tauri-apps/api/core";
import type {
  LlmConfig,
  StreamChatOptions,
  ChatMessage,
  LlmDataSharing,
  AnalysisRange,
  LlmConversation,
  LlmConversationSummary,
} from "@/types/llm";

export async function getLlmConfig(): Promise<LlmConfig> {
  return invoke<LlmConfig>("get_llm_config");
}

export async function setLlmConfig(config: LlmConfig): Promise<void> {
  return invoke("set_llm_config", { config });
}

export async function getLlmConfigPath(): Promise<string> {
  return invoke<string>("get_llm_config_path");
}

export async function openLlmConfigFile(): Promise<void> {
  return invoke("open_llm_config_file");
}

export async function openLlmConfigDir(): Promise<void> {
  return invoke("open_llm_config_dir");
}

export async function getLlmConversations(
  includeArchived = false
): Promise<LlmConversationSummary[]> {
  return invoke<LlmConversationSummary[]>("list_llm_conversations", { includeArchived });
}

export async function getLlmConversation(id: string): Promise<LlmConversation | null> {
  return invoke<LlmConversation | null>("get_llm_conversation", { id });
}

export async function saveLlmConversation(conversation: LlmConversation): Promise<void> {
  return invoke("save_llm_conversation", { conversation });
}

export async function deleteLlmConversation(id: string): Promise<void> {
  return invoke("delete_llm_conversation", { id });
}

export async function archiveLlmConversation(id: string, archived: boolean): Promise<void> {
  return invoke("archive_llm_conversation", { id, archived });
}

export async function pinLlmConversation(id: string, pinned: boolean): Promise<void> {
  return invoke("pin_llm_conversation", { id, pinned });
}

export async function streamChatCompletion(options: StreamChatOptions): Promise<void> {
  const { baseUrl, apiKey, model, messages, onChunk, onDone, onError } = options;

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`LLM request failed (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("LLM response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (!value) continue;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim().startsWith("data:"));

      for (const line of lines) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            onChunk(delta);
          }
        } catch {
          // Ignore malformed SSE lines.
        }
      }
    }

    onDone();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeDates(range: AnalysisRange): { start: string; end: string; label: string } {
  const now = new Date();
  const today = formatDate(now);

  switch (range) {
    case "today":
      return { start: today, end: today, label: "today" };
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const y = formatDate(d);
      return { start: y, end: y, label: "yesterday" };
    }
    case "last_7_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { start: formatDate(d), end: today, label: "the last 7 days" };
    }
    case "last_30_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { start: formatDate(d), end: today, label: "the last 30 days" };
    }
    case "this_week": {
      const d = new Date(now);
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      d.setDate(diff);
      return { start: formatDate(d), end: today, label: "this week" };
    }
    case "last_week": {
      const end = new Date(now);
      const dayOfWeek = end.getDay();
      const mondayDiff = end.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      end.setDate(mondayDiff - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start: formatDate(start), end: formatDate(end), label: "last week" };
    }
    case "custom":
    default:
      return { start: today, end: today, label: "today" };
  }
}

export interface ScreenTimeContextOptions {
  todaySeconds: number;
  topApps: { name: string; seconds: number }[];
  categories: { name: string; seconds: number }[];
  focusMinutes: number;
  goals: { name: string; progress: number }[];
  interruptions: number;
  language?: string;
  dataSharing: LlmDataSharing;
  rangeLabel: string;
}

export function buildScreenTimeContext(options: ScreenTimeContextOptions): ChatMessage[] {
  const {
    dataSharing,
    rangeLabel,
    language,
    todaySeconds,
    topApps,
    categories,
    focusMinutes,
    goals,
    interruptions,
  } = options;

  const lang = language && language !== "en" ? language : "the user's language";

  const systemContent = `You are a productivity assistant inside TimeLens, a local screen-time tracker. Analyze the user's screen-time data and provide concise, actionable insights. Be helpful, non-judgmental, and focus on one or two concrete suggestions. When the user asks follow-up questions, answer based on the data provided or ask for clarification. Respond in ${lang}. You may use Markdown formatting (lists, bold, code blocks) to make the answer readable.`;

  const parts: string[] = [];
  parts.push(`Here is my screen-time summary for ${rangeLabel}:`);

  if (dataSharing.total_time) {
    parts.push(`- Total active time: ${Math.round(todaySeconds / 60)} minutes`);
  }
  if (dataSharing.focus_time) {
    parts.push(`- Focus time: ${Math.round(focusMinutes)} minutes`);
  }
  if (dataSharing.interruptions) {
    parts.push(`- Interruptions: ${interruptions}`);
  }

  if (dataSharing.top_apps && topApps.length > 0) {
    const text = topApps
      .slice(0, 5)
      .map((a) => `${a.name}: ${Math.round(a.seconds / 60)}m`)
      .join("\n");
    parts.push(`\nTop apps:\n${text}`);
  }

  if (dataSharing.categories && categories.length > 0) {
    const text = categories
      .map((c) => `${c.name}: ${Math.round(c.seconds / 60)}m`)
      .join("\n");
    parts.push(`\nCategories:\n${text}`);
  }

  if (dataSharing.goals && goals.length > 0) {
    const text = goals
      .map((g) => `${g.name}: ${Math.round(g.progress * 100)}%`)
      .join("\n");
    parts.push(`\nGoals:\n${text}`);
  }

  parts.push("\nPlease analyze my screen time and suggest 2-3 ways I could improve my focus or balance.");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: parts.join("\n") },
  ];
}

export { getRangeDates };

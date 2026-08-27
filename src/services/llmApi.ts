import { invoke } from "@tauri-apps/api/core";
import type { LlmConfig, StreamChatOptions, ChatMessage } from "@/types/llm";

export async function getLlmConfig(): Promise<LlmConfig> {
  return invoke<LlmConfig>("get_llm_config");
}

export async function setLlmConfig(config: LlmConfig): Promise<void> {
  return invoke("set_llm_config", { config });
}

export async function getLlmConfigPath(): Promise<string> {
  return invoke<string>("get_llm_config_path");
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

export function buildScreenTimeContext(options: {
  todaySeconds: number;
  topApps: { name: string; seconds: number }[];
  categories: { name: string; seconds: number }[];
  focusMinutes: number;
  goals: { name: string; progress: number }[];
  interruptions: number;
  language?: string;
}): ChatMessage[] {
  const topAppsText = options.topApps
    .slice(0, 5)
    .map((a) => `${a.name}: ${Math.round(a.seconds / 60)}m`)
    .join("\n") || "No app data";

  const categoriesText = options.categories
    .map((c) => `${c.name}: ${Math.round(c.seconds / 60)}m`)
    .join("\n") || "No category data";

  const goalsText = options.goals
    .map((g) => `${g.name}: ${Math.round(g.progress * 100)}%`)
    .join("\n") || "No goals";

  const language = options.language && options.language !== "en" ? options.language : "the user's language";
  const systemContent = `You are a productivity assistant inside TimeLens, a local screen-time tracker. Analyze the user's screen-time data and provide concise, actionable insights. Be helpful, non-judgmental, and focus on one or two concrete suggestions. When the user asks follow-up questions, answer based on the data provided or ask for clarification. Respond in ${language}. You may use Markdown formatting (lists, bold, code blocks) to make the answer readable.`;

  const userContent = `Here is my screen-time summary for today:

- Total active time: ${Math.round(options.todaySeconds / 60)} minutes
- Focus time: ${Math.round(options.focusMinutes)} minutes
- Interruptions: ${options.interruptions}

Top apps:
${topAppsText}

Categories:
${categoriesText}

Goals:
${goalsText}

Please analyze my day and suggest 2-3 ways I could improve my focus or balance.`;

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

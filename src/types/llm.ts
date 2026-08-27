export interface LlmProvider {
  name: string;
  nickname?: string;
  base_url: string;
  model: string;
  api_key?: string;
  builtin?: boolean;
  referral_url?: string;
}

export interface LlmConfig {
  active_provider_id: string | null;
  providers: Record<string, LlmProvider>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

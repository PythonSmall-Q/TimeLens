export interface LlmProvider {
  name: string;
  nickname?: string;
  base_url: string;
  model: string;
  api_key?: string;
  builtin?: boolean;
  referral_url?: string;
}

export interface LlmDataSharing {
  total_time: boolean;
  top_apps: boolean;
  categories: boolean;
  focus_time: boolean;
  goals: boolean;
  interruptions: boolean;
}

export type AnalysisRange =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "custom";

export interface LlmConfig {
  active_provider_id: string | null;
  providers: Record<string, LlmProvider>;
  data_sharing: LlmDataSharing;
  default_range: AnalysisRange;
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

export interface LlmConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  messages: ChatMessage[];
  summary?: string;
}

export interface LlmConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  pinned: boolean;
  message_count: number;
}

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Check, AlertCircle, Loader2, Plus, Trash2, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useLlmStore } from "@/stores/llmStore";
import { streamChatCompletion } from "@/services/llmApi";
import type { LlmProvider, LlmDataSharing, AnalysisRange } from "@/types/llm";
import clsx from "clsx";

interface ProviderFormData {
  nickname: string;
  name: string;
  model: string;
  api_key: string;
  base_url: string;
}

function emptyForm(): ProviderFormData {
  return {
    nickname: "",
    name: "Custom",
    model: "",
    api_key: "",
    base_url: "",
  };
}

function providerDisplayLabel(provider: LlmProvider): string {
  return provider.nickname?.trim() || provider.name;
}

export default function LlmSettings() {
  const { t } = useTranslation(["llm", "common"]);
  const {
    config,
    updateProvider,
    addProvider,
    removeProvider,
    setActiveProvider,
    saveConfig,
    setDataSharing,
    setDefaultRange,
    loading,
  } = useLlmStore();

  const [editingId, setEditingId] = useState<string | "__new__" | null>(null);
  const [form, setForm] = useState<ProviderFormData>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "testing" | "ok" | "error">>({});
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});

  const activeId = config.active_provider_id;
  const providerIds = useMemo(() => Object.keys(config.providers), [config.providers]);

  const nicknameExists = (nickname: string, excludeId?: string) => {
    const trimmed = nickname.trim();
    if (!trimmed) return false;
    return providerIds.some(
      (id) =>
        id !== excludeId &&
        providerDisplayLabel(config.providers[id]).toLowerCase() === trimmed.toLowerCase()
    );
  };

  const startEdit = (id: string) => {
    const p = config.providers[id];
    if (!p) return;
    setForm({
      nickname: p.nickname ?? "",
      name: p.name,
      model: p.model,
      api_key: p.api_key ?? "",
      base_url: p.base_url,
    });
    setFormError(null);
    setEditingId(id);
  };

  const startNew = () => {
    setForm(emptyForm());
    setFormError(null);
    setEditingId("__new__");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const validateForm = (data: ProviderFormData, excludeId?: string): string | null => {
    const nickname = data.nickname.trim();
    if (!nickname) return t("llm:modelNicknameRequired");
    if (nicknameExists(nickname, excludeId)) return t("llm:nicknameDuplicate");
    if (!data.model.trim()) return t("llm:modelRequired");
    if (!data.base_url.trim()) return t("llm:baseUrlRequired");
    return null;
  };

  const handleSave = async () => {
    const error = validateForm(form, editingId === "__new__" ? undefined : editingId ?? undefined);
    if (error) {
      setFormError(error);
      return;
    }

    const patch: Partial<LlmProvider> = {
      nickname: form.nickname.trim(),
      model: form.model.trim(),
      api_key: form.api_key.trim() || undefined,
      base_url: form.base_url.trim(),
    };

    if (editingId === "__new__") {
      await addProvider({
        name: form.name.trim() || form.nickname.trim(),
        nickname: form.nickname.trim(),
        model: form.model.trim(),
        api_key: form.api_key.trim() || undefined,
        base_url: form.base_url.trim(),
        builtin: false,
      });
    } else if (editingId) {
      await updateProvider(editingId, patch);
    }

    cancelEdit();
  };

  const handleDelete = async (id: string) => {
    const provider = config.providers[id];
    if (!provider || provider.builtin) return;
    const label = providerDisplayLabel(provider);
    const confirmed = window.confirm(t("llm:deleteModelConfirm", { name: label }));
    if (!confirmed) return;
    await removeProvider(id);
  };

  const handleTest = async (id: string) => {
    const provider = config.providers[id];
    if (!provider?.base_url || !provider.api_key || !provider.model) {
      setTestStatus((prev) => ({ ...prev, [id]: "error" }));
      setTestMessage((prev) => ({ ...prev, [id]: t("llm:testMissingFields") }));
      return;
    }
    setTestStatus((prev) => ({ ...prev, [id]: "testing" }));
    setTestMessage((prev) => ({ ...prev, [id]: "" }));
    await streamChatCompletion({
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      model: provider.model,
      messages: [{ role: "user", content: "Say 'TimeLens LLM connection OK' and nothing else." }],
      onChunk: () => {},
      onDone: () => {
        setTestStatus((prev) => ({ ...prev, [id]: "ok" }));
        setTestMessage((prev) => ({ ...prev, [id]: t("llm:testSuccess") }));
      },
      onError: (err) => {
        setTestStatus((prev) => ({ ...prev, [id]: "error" }));
        setTestMessage((prev) => ({ ...prev, [id]: err.message }));
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <label className="block text-sm text-text-secondary">{t("llm:configuredModels")}</label>
        <button
          onClick={startNew}
          disabled={loading || editingId === "__new__"}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          <Plus size={13} />
          {t("llm:addModel")}
        </button>
      </div>

      <div className="space-y-3">
        {providerIds.map((id) => {
          const provider = config.providers[id];
          const isActive = activeId === id;
          const isEditing = editingId === id;
          const status = testStatus[id] ?? "idle";
          const message = testMessage[id] ?? "";

          return (
            <div
              key={id}
              className={clsx(
                "rounded-2xl border transition-colors overflow-hidden",
                isActive
                  ? "border-accent-blue/40 bg-accent-blue/5"
                  : "border-surface-border bg-surface-hover/40"
              )}
            >
              <div className="flex items-center justify-between px-4 py-3 gap-3">
                <button
                  onClick={() => startEdit(id)}
                  className="flex-1 text-left flex items-center gap-3 min-w-0"
                >
                  <div
                    className={clsx(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      isActive ? "bg-accent-blue/20 text-accent-blue" : "bg-surface-card text-text-muted"
                    )}
                  >
                    <Sparkles size={15} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {providerDisplayLabel(provider)}
                      {provider.builtin && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-md bg-surface-card text-text-muted border border-surface-border">
                          {t("llm:builtin")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {provider.model || t("llm:noModel")} · {provider.base_url || t("llm:noBaseUrl")}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {isActive ? (
                    <span className="text-[10px] px-2 py-1 rounded-full bg-accent-blue/20 text-accent-blue font-medium">
                      {t("llm:active")}
                    </span>
                  ) : (
                    <button
                      onClick={() => void setActiveProvider(id)}
                      disabled={loading}
                      className="text-xs px-2 py-1 rounded-full border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {t("llm:setActive")}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(id)}
                    className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors"
                    title={t("common:edit")}
                  >
                    {isEditing ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {!provider.builtin && (
                    <button
                      onClick={() => void handleDelete(id)}
                      disabled={loading}
                      className="p-1.5 rounded-lg text-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-50"
                      title={t("common:delete")}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="px-4 pb-4 space-y-4 border-t border-surface-border/60 pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-secondary">{t("llm:nickname")}</label>
                      <input
                        type="text"
                        value={form.nickname}
                        onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                        placeholder={t("llm:nicknamePlaceholder")}
                        className="ui-field w-full"
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-secondary">{t("llm:model")}</label>
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}
                        placeholder={t("llm:modelPlaceholder")}
                        className="ui-field w-full"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-secondary">{t("llm:apiKey")}</label>
                    <input
                      type="password"
                      value={form.api_key}
                      onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                      placeholder={t("llm:apiKeyPlaceholder")}
                      className="ui-field w-full"
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-secondary">{t("llm:baseUrl")}</label>
                    <input
                      type="text"
                      value={form.base_url}
                      onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      className="ui-field w-full"
                      disabled={loading}
                    />
                  </div>

                  {provider.referral_url && (
                    <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/10 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <ExternalLink size={16} className="text-accent-blue mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm text-text-primary font-medium">{t("llm:referralTitle")}</div>
                          <p className="text-xs text-text-secondary mt-1">{t("llm:referralBody")}</p>
                          <a
                            href={provider.referral_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline mt-2"
                          >
                            {provider.referral_url}
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {formError && (
                    <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-2 flex items-start gap-2 text-xs text-accent-red">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {status !== "idle" && status !== "testing" && (
                    <div
                      className={clsx(
                        "rounded-xl border px-4 py-2 flex items-start gap-2 text-xs",
                        status === "ok"
                          ? "border-accent-green/30 bg-accent-green/10 text-accent-green"
                          : "border-accent-red/30 bg-accent-red/10 text-accent-red"
                      )}
                    >
                      {status === "ok" ? <Check size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
                      <span className="break-all">{message}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => void handleSave()}
                      disabled={loading}
                      className="btn-primary"
                    >
                      {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {t("common:save")}
                    </button>
                    <button
                      onClick={() => void handleTest(id)}
                      disabled={loading || status === "testing"}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {status === "testing" && <Loader2 size={13} className="animate-spin" />}
                      {t("llm:testConnection")}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={loading}
                      className="text-xs px-3 py-1.5 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    >
                      {t("common:cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {editingId === "__new__" && (
          <div className="rounded-2xl border border-accent-blue/40 bg-accent-blue/5 overflow-hidden">
            <div className="px-4 py-3 border-b border-accent-blue/20 flex items-center gap-2">
              <Sparkles size={15} className="text-accent-blue" />
              <span className="text-sm font-medium text-text-primary">{t("llm:addModel")}</span>
            </div>
            <div className="px-4 pb-4 space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs text-text-secondary">{t("llm:nickname")}</label>
                  <input
                    type="text"
                    value={form.nickname}
                    onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                    placeholder={t("llm:nicknamePlaceholder")}
                    className="ui-field w-full"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-text-secondary">{t("llm:model")}</label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder={t("llm:modelPlaceholder")}
                    className="ui-field w-full"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-text-secondary">{t("llm:apiKey")}</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={t("llm:apiKeyPlaceholder")}
                  className="ui-field w-full"
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-text-secondary">{t("llm:baseUrl")}</label>
                <input
                  type="text"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="ui-field w-full"
                  disabled={loading}
                />
              </div>

              {formError && (
                <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-2 flex items-start gap-2 text-xs text-accent-red">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleSave()}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t("common:save")}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  {t("common:cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted">{t("llm:apiKeyWarning")}</p>

      <div className="rounded-2xl border border-surface-border bg-surface-hover/40 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{t("llm:dataSharingTitle")}</h3>
          <p className="text-xs text-text-muted mt-0.5">{t("llm:dataSharingSubtitle")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              ["total_time", t("llm:shareTotalTime")],
              ["top_apps", t("llm:shareTopApps")],
              ["categories", t("llm:shareCategories")],
              ["focus_time", t("llm:shareFocusTime")],
              ["goals", t("llm:shareGoals")],
              ["interruptions", t("llm:shareInterruptions")],
            ] as [keyof LlmDataSharing, string][]
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2.5 p-2.5 rounded-xl border border-surface-border bg-surface-card/40 cursor-pointer hover:bg-surface-hover transition-colors"
            >
              <input
                type="checkbox"
                checked={config.data_sharing[key]}
                onChange={(e) =>
                  void setDataSharing({ ...config.data_sharing, [key]: e.target.checked })
                }
                disabled={loading}
                className="ui-checkbox"
              />
              <span className="text-sm text-text-secondary">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-hover/40 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{t("llm:defaultRangeTitle")}</h3>
          <p className="text-xs text-text-muted mt-0.5">{t("llm:defaultRangeSubtitle")}</p>
        </div>
        <select
          value={config.default_range}
          onChange={(e) => void setDefaultRange(e.target.value as AnalysisRange)}
          disabled={loading}
          className="ui-field w-full"
        >
          {(
            [
              ["today", t("llm:rangeToday")],
              ["yesterday", t("llm:rangeYesterday")],
              ["last_7_days", t("llm:rangeLast7Days")],
              ["last_30_days", t("llm:rangeLast30Days")],
              ["this_week", t("llm:rangeThisWeek")],
              ["last_week", t("llm:rangeLastWeek")],
            ] as [AnalysisRange, string][]
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => void saveConfig(config)}
          disabled={loading}
          className="btn-primary"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("common:save")}
        </button>
      </div>
    </div>
  );
}

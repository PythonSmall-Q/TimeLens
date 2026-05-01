import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Target, Trash2, Plus, Edit2, Check, X } from "lucide-react";
import * as api from "@/services/tauriApi";
import ExePickerInput from "@/components/ExePickerInput";
import type { AppCategoryRule, ExecutableOption, UsageGoal } from "@/types";
import clsx from "clsx";

const PERIOD_OPTIONS = ["daily", "weekly"] as const;
const OPERATOR_OPTIONS = ["at_most", "at_least"] as const;
const PRESET_CATEGORIES = [
  "Work", "Social", "Entertainment", "Development", "Productivity",
  "Education", "Gaming", "Browsing", "Communication", "System",
] as const;

function categoryLabel(t: (key: string, options?: Record<string, unknown>) => string, cat: string) {
  return t(`categories:presets.${cat}`, { defaultValue: cat } as Record<string, unknown>);
}

function goalScopeLabel(
  tGoals: (key: string, options?: Record<string, unknown>) => string,
  tCategories: (key: string, options?: Record<string, unknown>) => string,
  goal: UsageGoal
) {
  if (!goal.scope_value) {
    return tGoals("goals:allApps");
  }
  if (goal.scope_type === "category") {
    return categoryLabel(tCategories, goal.scope_value);
  }
  return goal.scope_value;
}

function GoalScopeField({
  goal,
  onChange,
  executableOptions,
  categoryOptions,
}: {
  goal: UsageGoal;
  onChange: (goal: UsageGoal) => void;
  executableOptions: ExecutableOption[];
  categoryOptions: string[];
}) {
  const { t } = useTranslation(["goals", "categories"]);
  const [appInputValue, setAppInputValue] = useState(goal.scope_type === "app" ? goal.scope_value : "");

  useEffect(() => {
    setAppInputValue(goal.scope_type === "app" ? goal.scope_value : "");
  }, [goal.scope_type, goal.scope_value]);

  return (
    <div className="flex gap-2">
      <select
        className="bg-surface-hover border border-surface-border rounded-lg px-2 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
        value={goal.scope_type}
        onChange={(e) => {
          const scopeType = e.target.value as UsageGoal["scope_type"];
          onChange({
            ...goal,
            scope_type: scopeType,
            scope_value: scopeType === "category" ? (categoryOptions[0] ?? "") : "",
          });
        }}
        title={t("goals:scopeTypeLabel")}
        aria-label={t("goals:scopeTypeLabel")}
      >
        <option value="app">{t("goals:scopeType_app")}</option>
        <option value="category">{t("goals:scopeType_category")}</option>
      </select>

      <div className="flex-1 min-w-0">
        {goal.scope_type === "category" ? (
          <select
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            value={goal.scope_value}
            onChange={(e) => onChange({ ...goal, scope_value: e.target.value })}
            title={t("goals:scopeValueLabel")}
            aria-label={t("goals:scopeValueLabel")}
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{categoryLabel(t, category)}</option>
            ))}
          </select>
        ) : (
          <ExePickerInput
            options={executableOptions}
            placeholder={t("goals:searchAppPlaceholder")}
            value={appInputValue}
            onChange={(appName, exePath) => {
              setAppInputValue(appName);
              onChange({
                ...goal,
                scope_value: exePath ? appName : "",
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

function GoalRow({
  goal,
  onDelete,
  onSave,
  executableOptions,
  categoryOptions,
}: {
  goal: UsageGoal;
  onDelete: (id: number) => void;
  onSave: (g: UsageGoal) => void;
  executableOptions: ExecutableOption[];
  categoryOptions: string[];
}) {
  const { t } = useTranslation(["goals", "categories", "common"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UsageGoal>(goal);

  useEffect(() => {
    setDraft(goal);
  }, [goal]);

  const commit = async () => {
    await onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(goal);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary font-medium">
            {goalScopeLabel(t, t, goal)}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {t(`goals:scopeType_${goal.scope_type}`)} · {t(`goals:period_${goal.period}`)} · {t(`goals:op_${goal.operator}`)}{" "}
            <span className="text-text-secondary">{Math.floor(goal.target_seconds / 60)} {t("goals:minutes")}</span>
          </p>
        </div>
        <button
          className="text-text-muted hover:text-accent-blue transition-colors"
          onClick={() => setEditing(true)}
          title={t("common:edit")}
          aria-label={t("common:edit")}
        >
          <Edit2 size={14} />
        </button>
        <button
          className="text-text-muted hover:text-accent-red transition-colors"
          onClick={() => goal.id != null && onDelete(goal.id)}
          title={t("common:delete")}
          aria-label={t("common:delete")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2 bg-surface-hover/40">
      <div className="flex gap-2">
        <GoalScopeField
          goal={draft}
          onChange={setDraft}
          executableOptions={executableOptions}
          categoryOptions={categoryOptions}
        />
        <select
          className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
          value={draft.period}
          onChange={(e) => setDraft({ ...draft, period: e.target.value as UsageGoal["period"] })}
          title={t("goals:periodLabel")}
          aria-label={t("goals:periodLabel")}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p} value={p}>{t(`goals:period_${p}`)}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 items-center">
        <select
          className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
          value={draft.operator}
          onChange={(e) => setDraft({ ...draft, operator: e.target.value as UsageGoal["operator"] })}
          title={t("goals:operatorLabel")}
          aria-label={t("goals:operatorLabel")}
        >
          {OPERATOR_OPTIONS.map((op) => (
            <option key={op} value={op}>{t(`goals:op_${op}`)}</option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          className="w-24 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue"
          value={Math.floor(draft.target_seconds / 60)}
          onChange={(e) => setDraft({ ...draft, target_seconds: Number(e.target.value) * 60 })}
          title={t("goals:minutesLabel")}
          aria-label={t("goals:minutesLabel")}
        />
        <span className="text-sm text-text-muted">{t("goals:minutes")}</span>
        <div className="flex gap-1 ml-auto">
          <button
            className="text-accent-green hover:text-accent-green/80"
            onClick={commit}
            title={t("common:save")}
            aria-label={t("common:save")}
          >
            <Check size={16} />
          </button>
          <button
            className="text-text-muted hover:text-accent-red"
            onClick={cancel}
            title={t("common:cancel")}
            aria-label={t("common:cancel")}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

const BLANK_GOAL = (): UsageGoal => ({
  id: undefined,
  scope_type: "app",
  scope_value: "",
  period: "daily",
  operator: "at_most",
  target_seconds: 3600,
  enabled: true,
});

export default function GoalsPage() {
  const { t } = useTranslation(["goals", "common"]);
  const [goals, setGoals] = useState<UsageGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newGoal, setNewGoal] = useState<UsageGoal>(BLANK_GOAL());
  const [saving, setSaving] = useState(false);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [appCategories, setAppCategories] = useState<AppCategoryRule[]>([]);

  const categoryOptions = Array.from(
    new Set([
      ...PRESET_CATEGORIES,
      ...appCategories.map((rule) => rule.category),
      ...goals.filter((goal) => goal.scope_type === "category").map((goal) => goal.scope_value),
    ].filter(Boolean))
  );

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const [data, apps, categories] = await Promise.all([
        api.getUsageGoals(),
        api.getRecentExecutables(100),
        api.getAppCategories(),
      ]);
      setGoals(data);
      setExecutableOptions(apps);
      setAppCategories(categories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handleDelete = async (id: number) => {
    await api.removeUsageGoal(id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleSave = async (g: UsageGoal) => {
    await api.saveUsageGoal(g);
    await loadGoals();
  };

  const handleAddNew = async () => {
    if (!newGoal.scope_value.trim()) return;
    setSaving(true);
    try {
      await api.saveUsageGoal(newGoal);
      setNewGoal(BLANK_GOAL());
      setAdding(false);
      await loadGoals();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Target size={22} className="text-accent-green" />
            {t("goals:title")}
          </h1>
          <p className="text-text-secondary text-sm mt-1">{t("goals:subtitle")}</p>
        </div>
        <button
          className={clsx("btn-primary flex items-center gap-1.5 px-4 py-2 text-sm", adding && "opacity-50")}
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <Plus size={14} />
          {t("goals:addGoal")}
        </button>
      </div>

      {adding && (
        <div className="glass-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">{t("goals:newGoal")}</h2>
          <div className="flex gap-2">
            <GoalScopeField
              goal={newGoal}
              onChange={setNewGoal}
              executableOptions={executableOptions}
              categoryOptions={categoryOptions}
            />
            <select
              className="bg-surface-hover border border-surface-border rounded-lg px-2 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
              value={newGoal.period}
              onChange={(e) => setNewGoal({ ...newGoal, period: e.target.value as UsageGoal["period"] })}
              title={t("goals:periodLabel")}
              aria-label={t("goals:periodLabel")}
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p} value={p}>{t(`goals:period_${p}`)}</option>
              ))}
            </select>
            <select
              className="bg-surface-hover border border-surface-border rounded-lg px-2 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
              value={newGoal.operator}
              onChange={(e) => setNewGoal({ ...newGoal, operator: e.target.value as UsageGoal["operator"] })}
              title={t("goals:operatorLabel")}
              aria-label={t("goals:operatorLabel")}
            >
              {OPERATOR_OPTIONS.map((op) => (
                <option key={op} value={op}>{t(`goals:op_${op}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="w-24 bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
              value={Math.floor(newGoal.target_seconds / 60)}
              onChange={(e) => setNewGoal({ ...newGoal, target_seconds: Number(e.target.value) * 60 })}
              title={t("goals:minutesLabel")}
              aria-label={t("goals:minutesLabel")}
            />
            <span className="text-sm text-text-muted">{t("goals:minutes")}</span>
            <div className="flex gap-2 ml-auto">
              <button
                className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm"
                onClick={handleAddNew}
                disabled={saving || !newGoal.scope_value.trim()}
              >
                {t("common:add")}
              </button>
              <button
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                onClick={() => { setAdding(false); setNewGoal(BLANK_GOAL()); }}
              >
                {t("common:cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card divide-y divide-surface-border">
        {loading ? (
          <div className="p-6 text-center text-text-muted text-sm">{t("common:loading")}</div>
        ) : goals.length === 0 ? (
          <div className="p-6 text-center text-text-muted text-sm">{t("goals:noGoals")}</div>
        ) : (
          goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              onDelete={handleDelete}
              onSave={handleSave}
              executableOptions={executableOptions}
              categoryOptions={categoryOptions}
            />
          ))
        )}
      </div>
    </div>
  );
}

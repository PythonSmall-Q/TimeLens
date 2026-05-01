import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Trash2, Wand2, Plus } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { AppCategoryRule, CategorySuggestion, ExecutableOption } from "@/types";
import clsx from "clsx";
import ExePickerInput from "@/components/ExePickerInput";

const PRESET_CATEGORIES = [
  "Work", "Social", "Entertainment", "Development", "Productivity",
  "Education", "Gaming", "Browsing", "Communication", "System",
];

const CATEGORY_COLORS: Record<string, string> = {
  Work: "bg-accent-blue/20 text-accent-blue",
  Social: "bg-accent-purple/20 text-accent-purple",
  Entertainment: "bg-accent-red/20 text-accent-red",
  Development: "bg-accent-green/20 text-accent-green",
  Productivity: "bg-accent-yellow/20 text-accent-yellow",
  Education: "bg-cyan-500/20 text-cyan-400",
  Gaming: "bg-orange-500/20 text-orange-400",
  Browsing: "bg-indigo-500/20 text-indigo-400",
  Communication: "bg-teal-500/20 text-teal-400",
  System: "bg-gray-500/20 text-gray-400",
};

function categoryBadgeClass(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-surface-hover text-text-secondary";
}

function categoryLabel(t: (key: string, options?: Record<string, unknown>) => string, cat: string) {
  return t(`categories:presets.${cat}`, { defaultValue: cat } as Record<string, unknown>);
}

interface RuleWithSuggestion extends AppCategoryRule {
  suggested?: string;
}

export default function CategoriesPage() {
  const { t } = useTranslation(["categories", "common"]);
  const [rules, setRules] = useState<RuleWithSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentApps, setRecentApps] = useState<ExecutableOption[]>([]);
  const [newApp, setNewApp] = useState<ExecutableOption | null>(null);
  const [newAppInputValue, setNewAppInputValue] = useState("");
  const [newCategory, setNewCategory] = useState(PRESET_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, CategorySuggestion>>({});

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const [data, apps] = await Promise.all([
        api.getAppCategories(),
        api.getRecentExecutables(100),
      ]);
      setRules(data);
      setRecentApps(apps);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const fetchSuggestion = async (appName: string, exePath: string) => {
    if (suggestions[exePath]) return;
    try {
      const s = await api.suggestCategoryForApp(appName, exePath);
      if (s) setSuggestions((prev) => ({ ...prev, [exePath]: s }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    rules.forEach((r) => fetchSuggestion(r.app_name, r.exe_path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  const handleAdd = async () => {
    if (!newApp) return;
    setSaving(true);
    try {
      await api.upsertAppCategory(newApp.app_name, newApp.exe_path, newCategory);
      setNewApp(null);
      setNewAppInputValue("");
      await loadRules();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (exePath: string) => {
    await api.removeAppCategory(exePath);
    await loadRules();
  };

  const handleCategoryChange = async (rule: AppCategoryRule, category: string) => {
    await api.upsertAppCategory(rule.app_name, rule.exe_path, category);
    setRules((prev) =>
      prev.map((r) => (r.exe_path === rule.exe_path ? { ...r, category } : r))
    );
  };

  const handleApplySuggestion = async (rule: AppCategoryRule) => {
    const s = suggestions[rule.exe_path];
    if (!s) return;
    await handleCategoryChange(rule, s.category);
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Tag size={22} className="text-accent-blue" />
          {t("categories:title")}
        </h1>
        <p className="text-text-secondary text-sm mt-1">{t("categories:subtitle")}</p>
      </div>

      {/* Add rule */}
      <div className="glass-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">{t("categories:addRule")}</h2>
        <div className="flex gap-2">
          <ExePickerInput
            options={recentApps}
            placeholder={t("categories:exePlaceholder")}
            value={newAppInputValue}
            excludePaths={new Set(rules.map((r) => r.exe_path))}
            onChange={(appName, exePath) => {
              setNewAppInputValue(appName);
              if (exePath) setNewApp({ app_name: appName, exe_path: exePath });
              else setNewApp(null);
            }}
            className="flex-1"
          />
          <select
            className="bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            title={t("categories:categoryLabel")}
            aria-label={t("categories:categoryLabel")}
          >
            {PRESET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(t, c)}</option>
            ))}
          </select>
          <button
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm"
            onClick={handleAdd}
            disabled={saving || !newApp}
          >
            <Plus size={14} />
            {t("common:add")}
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="glass-card divide-y divide-surface-border">
        {loading ? (
          <div className="p-6 text-center text-text-muted text-sm">{t("common:loading")}</div>
        ) : rules.length === 0 ? (
          <div className="p-6 text-center text-text-muted text-sm">{t("categories:noRules")}</div>
        ) : (
          rules.map((rule) => {
            const suggestion = suggestions[rule.exe_path];
            const showSuggest = suggestion && suggestion.category !== rule.category;
            return (
              <div key={rule.exe_path} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{rule.app_name}</p>
                  <p className="text-xs text-text-muted truncate font-mono">{rule.exe_path}</p>
                  {showSuggest && (
                    <button
                      className="mt-0.5 flex items-center gap-1 text-xs text-accent-yellow hover:text-accent-yellow/80"
                      onClick={() => handleApplySuggestion(rule)}
                      title={t("categories:applySuggestion")}
                    >
                      <Wand2 size={11} />
                      {t("categories:suggestedCategory", {
                        cat: categoryLabel(t, suggestion.category),
                      })}
                    </button>
                  )}
                </div>
                <select
                  className={clsx(
                    "text-xs rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer",
                    categoryBadgeClass(rule.category)
                  )}
                  value={rule.category}
                  onChange={(e) => handleCategoryChange(rule, e.target.value)}
                  title={t("categories:categoryLabel")}
                  aria-label={t("categories:categoryLabel")}
                >
                  {PRESET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryLabel(t, c)}</option>
                  ))}
                </select>
                <button
                  className="text-text-muted hover:text-accent-red transition-colors ml-1"
                  onClick={() => handleDelete(rule.exe_path)}
                  title={t("common:delete")}
                  aria-label={t("common:delete")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

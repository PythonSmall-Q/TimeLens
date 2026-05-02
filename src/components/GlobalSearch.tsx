import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import clsx from "clsx";
import { NAV_ITEMS } from "@/components/layout/navItems";
import AppDetailModal from "@/components/AppDetailModal";
import * as api from "@/services/tauriApi";
import { formatDuration } from "@/utils/format";
import type { AppUsageSummary, AppCategoryRule, TodoItem, UsageGoal } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface SearchResult {
  id: string;
  type: "page" | "app" | "category" | "todo" | "goal";
  title: string;
  subtitle?: string;
  todaySeconds?: number;
  weekSeconds?: number;
  action: () => void;
}

const GROUP_ORDER: SearchResult["type"][] = ["page", "app", "category", "todo", "goal"];

export default function GlobalSearch({ open, onClose }: Props) {
  const { t } = useTranslation(["common", "dashboard", "widgets", "categories", "goals", "focus", "limits", "browserUsage", "settings"]);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailApp, setDetailApp] = useState<AppUsageSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Data loaded once when panel opens
  const [apps, setApps] = useState<AppUsageSummary[]>([]);
  const [todayApps, setTodayApps] = useState<AppUsageSummary[]>([]);
  const [categories, setCategories] = useState<AppCategoryRule[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [goals, setGoals] = useState<UsageGoal[]>([]);

  useEffect(() => {
    if (!open) {
      setDetailApp(null);
      return;
    }
    setQuery("");
    setSelectedIndex(0);
    setDetailApp(null);
    inputRef.current?.focus();

    const today = new Date().toISOString().slice(0, 10);
    const week = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

    Promise.all([
      api.getAppTotalsInRange(week, today).catch(() => []),
      api.getTodayAppTotals().catch(() => []),
      api.getAppCategories().catch(() => []),
      api.getTodos().catch(() => []),
      api.getUsageGoals().catch(() => []),
    ]).then(([a, ta, c, td, g]) => {
      setApps(a);
      setTodayApps(ta);
      setCategories(c);
      setTodos(td);
      setGoals(g);
    });
  }, [open]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim();
    const list: SearchResult[] = [];

    const add = (items: SearchResult[]) => {
      const filtered = q
        ? items.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle?.toLowerCase().includes(q))
        : items;
      list.push(...filtered.slice(0, 5));
    };

    // Build today usage map
    const todayMap = new Map<string, number>();
    for (const a of todayApps) todayMap.set(a.app_name, a.total_seconds);

    // Pages
    add(
      NAV_ITEMS.map((item) => ({
        id: `page:${item.to}`,
        type: "page" as const,
        title: t(item.labelKey as string),
        action: () => { navigate(item.to); onClose(); },
      }))
    );

    // Apps
    add(
      apps.map((app) => ({
        id: `app:${app.exe_path}`,
        type: "app" as const,
        title: app.app_name,
        subtitle: app.exe_path,
        todaySeconds: todayMap.get(app.app_name),
        weekSeconds: app.total_seconds,
        action: () => { setDetailApp(app); },
      }))
    );

    // Categories
    const uniqCats = Array.from(new Set(categories.map((c) => c.category)));
    add(
      uniqCats.map((cat) => ({
        id: `cat:${cat}`,
        type: "category" as const,
        title: cat,
        action: () => { navigate("/categories"); onClose(); },
      }))
    );

    // Todos
    add(
      todos.map((td) => ({
        id: `todo:${td.id}`,
        type: "todo" as const,
        title: td.content,
        subtitle: td.done ? "✓" : undefined,
        action: () => { navigate("/widgets"); onClose(); },
      }))
    );

    // Goals
    add(
      goals.map((g) => ({
        id: `goal:${g.id}`,
        type: "goal" as const,
        title: `${g.scope_value} (${g.period})`,
        action: () => { navigate("/goals"); onClose(); },
      }))
    );

    return list;
  }, [query, apps, todayApps, categories, todos, goals, navigate, onClose, t]);

  // Group results by type maintaining GROUP_ORDER
  const grouped = useMemo(() => {
    const map = new Map<SearchResult["type"], SearchResult[]>();
    for (const r of results) {
      if (!map.has(r.type)) map.set(r.type, []);
      map.get(r.type)!.push(r);
    }
    const groups: { type: SearchResult["type"]; items: SearchResult[] }[] = [];
    for (const type of GROUP_ORDER) {
      if (map.has(type)) groups.push({ type, items: map.get(type)! });
    }
    return groups;
  }, [results]);

  // Flat index for keyboard nav
  const flat = results;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      flat[selectedIndex]?.action();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Close on Escape via window listener too
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // ── App detail view ──────────────────────────────────────
  if (detailApp) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-xl rounded-2xl bg-surface-light shadow-2xl overflow-hidden border border-surface-border max-h-[70vh] flex flex-col">
          <AppDetailModal
            app={detailApp}
            onBack={() => { setDetailApp(null); setTimeout(() => inputRef.current?.focus(), 50); }}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }

  const GROUP_LABELS: Record<SearchResult["type"], string> = {
    page: t("common:searchPages"),
    app: t("common:searchApps"),
    category: t("common:searchCategories"),
    todo: t("common:searchTodos"),
    goal: t("common:searchGoals"),
  };

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-surface-light shadow-2xl overflow-hidden border border-surface-border">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border bg-surface-light">
          <Search size={16} className="text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKey}
            placeholder={t("common:searchPlaceholder")}
            className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
          />
          {query && (
            <button onClick={() => setQuery("")} title="Clear" className="text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          )}
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[26rem] overflow-y-auto py-2 bg-surface-light">
          {results.length === 0 && (
            <p className="text-center py-6 text-xs text-text-muted">
              {query ? t("common:searchNoResult") : t("common:searchHint")}
            </p>
          )}
          {grouped.map(({ type, items }) => (
            <div key={type}>
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {GROUP_LABELS[type]}
              </p>
              {items.map((item) => {
                const idx = flatIdx++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={clsx(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      isSelected ? "bg-accent-blue/15" : "hover:bg-surface-hover"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className={clsx("block text-sm font-medium", isSelected ? "text-accent-blue" : "text-text-primary")}>
                        {item.title}
                      </span>
                      {item.subtitle && item.type !== "app" && (
                        <span className="block text-xs text-text-muted truncate">{item.subtitle}</span>
                      )}
                      {item.type === "app" && item.subtitle && (
                        <span className="block text-[11px] text-text-muted truncate font-mono">{item.subtitle}</span>
                      )}
                    </div>
                    {item.type === "app" && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.todaySeconds != null && item.todaySeconds > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue font-medium">
                            {t("common:today")}&nbsp;{formatDuration(item.todaySeconds)}
                          </span>
                        )}
                        {item.weekSeconds != null && item.weekSeconds > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-hover text-text-secondary font-medium">
                            {t("dashboard:appDetailWeekChart")}&nbsp;{formatDuration(item.weekSeconds)}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import type { ExecutableOption } from "@/types";
import clsx from "clsx";

interface ExePickerInputProps {
  /** Already-loaded list of recent/running apps to search through */
  options: ExecutableOption[];
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Current value (display text) */
  value: string;
  /** Called with the chosen app name + exe path */
  onChange: (appName: string, exePath: string) => void;
  /** Extra class for the outer wrapper */
  className?: string;
  /** Paths to exclude from dropdown (already added) */
  excludePaths?: Set<string>;
}

export default function ExePickerInput({
  options,
  placeholder,
  value,
  onChange,
  className,
  excludePaths,
}: ExePickerInputProps) {
  const { t } = useTranslation("common");
  const resolvedPlaceholder = placeholder || t("searchAppPlaceholder");
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((x) => {
    if (excludePaths?.has(x.exe_path)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return x.app_name.toLowerCase().includes(q) || x.exe_path.toLowerCase().includes(q);
  });

  const pick = (app: ExecutableOption) => {
    setQuery(app.app_name);
    onChange(app.app_name, app.exe_path);
    setOpen(false);
  };

  const browseFile = async () => {
    try {
      const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog");
      const selected = await dialogOpen({
        filters: [{ name: t("executableFilter"), extensions: ["exe", "app", ""] }],
        multiple: false,
      });
      if (typeof selected === "string" && selected) {
        const appName = selected.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? selected;
        setQuery(appName);
        onChange(appName, selected);
        setOpen(false);
      }
    } catch { /* user cancelled */ }
  };

  return (
    <div ref={wrapRef} className={clsx("relative z-[100]", className)}>
      <div className="flex gap-1.5">
        <input
          type="text"
          className="ui-field flex-1"
          placeholder={resolvedPlaceholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange("", ""); }}
          onFocus={() => setOpen(true)}
          title={resolvedPlaceholder}
          aria-label={resolvedPlaceholder}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={browseFile}
          title={t("browseExecutable")}
          aria-label={t("browseExecutable")}
          className="px-3 rounded-xl border border-surface-border text-text-muted hover:text-text-primary hover:bg-accent-blue/10 hover:border-accent-blue/40 transition-colors flex-shrink-0 flex items-center justify-center"
        >
          <FolderOpen size={15} />
        </button>
      </div>

      {open && query && filtered.length > 0 && (
        <div className="absolute z-[110] left-0 right-0 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-surface-border/80 bg-surface-card/95 backdrop-blur-md shadow-2xl divide-y divide-surface-border/40">
          {filtered.slice(0, 25).map((row) => (
            <button
              key={row.exe_path}
              type="button"
              onMouseDown={() => pick(row)}
              className={clsx(
                "w-full flex flex-col items-start px-3.5 py-2 text-xs hover:bg-surface-hover/80 active:bg-accent-blue/15 transition-colors text-left"
              )}
            >
              <span className="text-text-primary font-medium">{row.app_name}</span>
              <span className="text-text-muted truncate max-w-full text-[11px]" title={row.exe_path}>
                {row.exe_path}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query && filtered.length === 0 && (
        <div className="absolute z-[110] left-0 right-0 mt-1.5 rounded-xl border border-surface-border/80 bg-surface-card/95 backdrop-blur-md shadow-2xl">
          <p className="px-3.5 py-3 text-xs text-text-muted">{t("noAppsFoundBrowse")}</p>
        </div>
      )}
    </div>
  );
}

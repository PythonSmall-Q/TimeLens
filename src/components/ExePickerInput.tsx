import { useState, useEffect, useRef } from "react";
import { FolderOpen } from "lucide-react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
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
  placeholder = "Search app…",
  value,
  onChange,
  className,
  excludePaths,
}: ExePickerInputProps) {
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
      const selected = await dialogOpen({
        filters: [{ name: "Executable", extensions: ["exe", "app", ""] }],
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
    <div ref={wrapRef} className={clsx("relative", className)}>
      <div className="flex gap-1">
        <input
          type="text"
          className="ui-field flex-1"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange("", ""); }}
          onFocus={() => setOpen(true)}
          title={placeholder}
          aria-label={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={browseFile}
          title="Browse for executable"
          aria-label="Browse for executable"
          className="px-2.5 rounded-lg border border-surface-border text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
        >
          <FolderOpen size={15} />
        </button>
      </div>

      {open && query && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-surface-border bg-surface-card shadow-lg divide-y divide-surface-border">
          {filtered.slice(0, 25).map((row) => (
            <button
              key={row.exe_path}
              type="button"
              onMouseDown={() => pick(row)}
              className={clsx(
                "w-full flex flex-col items-start px-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left"
              )}
            >
              <span className="text-text-primary font-medium">{row.app_name}</span>
              <span className="text-text-muted truncate max-w-full" title={row.exe_path}>
                {row.exe_path}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query && filtered.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-surface-border bg-surface-card shadow-lg">
          <p className="px-3 py-3 text-xs text-text-muted">No apps found — use the folder button to browse</p>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  widgetType: string;
  requestedPermissions: string[];
  onConfirm: (granted: string[]) => void;
}

const PERMISSION_KEYS: Record<string, string> = {
  "screen-time:read": "permissionScreenTime",
  "active-window:subscribe": "permissionActiveWindow",
  "todo:read": "permissionTodoRead",
  "todo:write": "permissionTodoWrite",
  "settings:write": "permissionSettingsWrite",
};

export default function WidgetPermissionDialog({
  open,
  onClose,
  widgetType,
  requestedPermissions,
  onConfirm,
}: Props) {
  const { t } = useTranslation("widgets");
  const [checked, setChecked] = useState<Set<string>>(
    new Set(requestedPermissions)
  );

  if (!open) return null;

  const toggle = (perm: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-[var(--surface-raised)] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-500" />
            <span className="font-semibold text-sm">
              {t("permissionDialogTitle", { widget: widgetType })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-xs text-[var(--text-muted)]">
          {t("permissionDialogDesc")}
        </p>

        {/* Permission list */}
        <ul className="mb-6 space-y-2">
          {requestedPermissions.map((perm) => (
            <li key={perm} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`perm-${perm}`}
                checked={checked.has(perm)}
                onChange={() => toggle(perm)}
                className="h-4 w-4 rounded border-gray-400 accent-blue-500"
              />
              <label
                htmlFor={`perm-${perm}`}
                className="cursor-pointer text-sm select-none"
              >
                {t(PERMISSION_KEYS[perm] ?? perm)}
              </label>
            </li>
          ))}
        </ul>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
          >
            {t("permissionCancel")}
          </button>
          <button
            onClick={() => onConfirm(Array.from(checked))}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            {t("permissionGrant")}
          </button>
        </div>
      </div>
    </div>
  );
}

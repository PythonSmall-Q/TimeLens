import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";

interface Props {
  open: boolean;
  widgetName: string;
  scope: string;
  message?: string;
  onAccept: (remember: boolean) => void;
  onDeny: (remember: boolean) => void;
  onClose?: () => void;
}

export default function WidgetConsentPrompt({
  open,
  widgetName,
  scope,
  message,
  onAccept,
  onDeny,
  onClose,
}: Props) {
  const { t } = useTranslation("widgets");
  const [remember, setRemember] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-[var(--surface-raised)] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-500" />
            <span className="font-semibold text-sm">
              {t("consentPrompt.title", { widget: widgetName })}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <p className="mb-2 text-xs text-[var(--text-muted)]">
          {t("consentPrompt.description", { widget: widgetName })}
        </p>

        <div className="mb-4 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs">
          <div className="font-medium text-[var(--text-primary)]">
            {t("consentPrompt.scopeLabel")}
          </div>
          <div className="mt-0.5 break-all font-mono text-[var(--text-secondary)]">
            {scope}
          </div>
          {message && (
            <div className="mt-2 text-[var(--text-muted)]">{message}</div>
          )}
        </div>

        <label className="mb-6 flex items-start gap-3">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-400 accent-blue-500 flex-shrink-0"
          />
          <span className="cursor-pointer select-none text-xs text-[var(--text-muted)]">
            {t("consentPrompt.remember")}
          </span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onDeny(remember)}
            className="rounded-lg px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
          >
            {t("consentPrompt.deny")}
          </button>
          <button
            onClick={() => onAccept(remember)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            {t("consentPrompt.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}

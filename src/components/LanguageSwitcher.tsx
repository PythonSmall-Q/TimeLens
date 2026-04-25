import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { SUPPORTED_LANGUAGES } from "@/i18n/config";
import { Globe } from "lucide-react";

export default function LanguageSwitcher() {
  const { t } = useTranslation("common");
  const { language, setLanguage } = useSettingsStore();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Globe size={12} />
        <span>{t("language")}</span>
      </div>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="ui-select"
        title={t("language")}
        aria-label={t("language")}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

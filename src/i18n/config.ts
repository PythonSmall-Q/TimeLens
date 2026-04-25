import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// EN
import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enWidgets from "./locales/en/widgets.json";
import enSettings from "./locales/en/settings.json";

// ZH-CN
import zhCommon from "./locales/zh-CN/common.json";
import zhDashboard from "./locales/zh-CN/dashboard.json";
import zhWidgets from "./locales/zh-CN/widgets.json";
import zhSettings from "./locales/zh-CN/settings.json";

/**
 * To add a new language:
 * 1. Create src/i18n/locales/<lang-code>/ directory
 * 2. Add common.json, dashboard.json, widgets.json, settings.json
 * 3. Import the JSON files above (following the existing pattern)
 * 4. Add them to the `resources` object below
 * 5. Add the language to SUPPORTED_LANGUAGES in src/stores/settingsStore.ts
 */
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
  // NEW LANGUAGES: add an entry here, e.g.:
  // { code: "ja", label: "Japanese", nativeLabel: "日本語" },
];

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
      },
      "zh-CN": {
        common: zhCommon,
        dashboard: zhDashboard,
        widgets: zhWidgets,
        settings: zhSettings,
      },
    },
    lng: localStorage.getItem("timelens-language") || "en",
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "dashboard", "widgets", "settings"],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

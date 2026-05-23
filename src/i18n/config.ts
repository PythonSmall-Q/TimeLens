import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// EN
import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enWidgets from "./locales/en/widgets.json";
import enSettings from "./locales/en/settings.json";
import enLimits from "./locales/en/limits.json";
import enCategories from "./locales/en/categories.json";
import enGoals from "./locales/en/goals.json";
import enFocus from "./locales/en/focus.json";
import enBrowserUsage from "./locales/en/browserUsage.json";

// ZH-CN
import zhCommon from "./locales/zh-CN/common.json";
import zhDashboard from "./locales/zh-CN/dashboard.json";
import zhWidgets from "./locales/zh-CN/widgets.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhLimits from "./locales/zh-CN/limits.json";
import zhCategories from "./locales/zh-CN/categories.json";
import zhGoals from "./locales/zh-CN/goals.json";
import zhFocus from "./locales/zh-CN/focus.json";
import zhBrowserUsage from "./locales/zh-CN/browserUsage.json";

// ZH-TW
import zhTWCommon from "./locales/zh-TW/common.json";
import zhTWDashboard from "./locales/zh-TW/dashboard.json";
import zhTWWidgets from "./locales/zh-TW/widgets.json";
import zhTWSettings from "./locales/zh-TW/settings.json";
import zhTWLimits from "./locales/zh-TW/limits.json";
import zhTWCategories from "./locales/zh-TW/categories.json";
import zhTWGoals from "./locales/zh-TW/goals.json";
import zhTWFocus from "./locales/zh-TW/focus.json";
import zhTWBrowserUsage from "./locales/zh-TW/browserUsage.json";

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
  { code: "zh-TW", label: "Chinese (Traditional)", nativeLabel: "繁體中文" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
];

function resolveInitialLanguage(): string {
  const saved = localStorage.getItem("timelens-language");
  if (saved && SUPPORTED_LANGUAGES.some((lang) => lang.code === saved)) return saved;
  const sys = (navigator.language || "en").toLowerCase();

  let initial = "en";
  if (sys === "zh-tw" || sys === "zh-hk" || sys === "zh-mo" || sys === "zh-hant") {
    initial = "zh-TW";
  } else if (sys.startsWith("zh")) {
    initial = "zh-CN";
  } else if (sys.startsWith("ja")) {
    initial = "ja";
  } else if (sys.startsWith("ko")) {
    initial = "ko";
  } else if (sys.startsWith("fr")) {
    initial = "fr";
  } else if (sys.startsWith("de")) {
    initial = "de";
  } else if (sys.startsWith("es")) {
    initial = "es";
  }

  localStorage.setItem("timelens-language", initial);
  return initial;
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
      "zh-CN": {
        common: zhCommon,
        dashboard: zhDashboard,
        widgets: zhWidgets,
        settings: zhSettings,
        limits: zhLimits,
        categories: zhCategories,
        goals: zhGoals,
        focus: zhFocus,
        browserUsage: zhBrowserUsage,
      },
      "zh-TW": {
        common: zhTWCommon,
        dashboard: zhTWDashboard,
        widgets: zhTWWidgets,
        settings: zhTWSettings,
        limits: zhTWLimits,
        categories: zhTWCategories,
        goals: zhTWGoals,
        focus: zhTWFocus,
        browserUsage: zhTWBrowserUsage,
      },
      ja: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
      ko: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
      fr: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
      de: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
      es: {
        common: enCommon,
        dashboard: enDashboard,
        widgets: enWidgets,
        settings: enSettings,
        limits: enLimits,
        categories: enCategories,
        goals: enGoals,
        focus: enFocus,
        browserUsage: enBrowserUsage,
      },
    },
    lng: resolveInitialLanguage(),
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "dashboard", "widgets", "settings", "limits"],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

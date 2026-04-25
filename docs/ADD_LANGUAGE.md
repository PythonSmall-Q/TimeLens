# Adding a New Language to TimeLens

This guide shows how to add a new UI language (e.g., Japanese `ja`) in five steps.

---

## Step 1 — Create locale files

Create a directory for your language under `src/i18n/locales/` and add four JSON files:

```
src/i18n/locales/ja/
├── common.json
├── dashboard.json
├── widgets.json
└── settings.json
```

Copy the contents from `src/i18n/locales/en/` as a starting template and translate all values. **Do not translate the JSON keys**, only the values.

### Example — `src/i18n/locales/ja/common.json`

```json
{
  "appName": "TimeLens",
  "loading": "読み込み中…",
  "error": "エラー",
  "hours": "時間",
  "minutes": "分",
  "seconds": "秒",
  "today": "今日",
  "yesterday": "昨日",
  "tracking": "追跡中",
  "paused": "一時停止"
}
```

---

## Step 2 — Import translations in `i18n/config.ts`

Open `src/i18n/config.ts` and add imports at the top:

```typescript
// Add these four imports
import jaCommon    from "./locales/ja/common.json";
import jaDashboard from "./locales/ja/dashboard.json";
import jaWidgets   from "./locales/ja/widgets.json";
import jaSettings  from "./locales/ja/settings.json";
```

---

## Step 3 — Add to resources object

In the same file, add `ja` to the `resources` object passed to `i18next.init`:

```typescript
resources: {
  en: { common: enCommon, dashboard: enDashboard, widgets: enWidgets, settings: enSettings },
  "zh-CN": { common: zhCNCommon, /* … */ },
  // ↓ Add your language
  ja: { common: jaCommon, dashboard: jaDashboard, widgets: jaWidgets, settings: jaSettings },
},
```

---

## Step 4 — Add to `SUPPORTED_LANGUAGES`

Still in `i18n/config.ts`, add an entry to the exported `SUPPORTED_LANGUAGES` array:

```typescript
export const SUPPORTED_LANGUAGES = [
  { code: "en",    label: "English" },
  { code: "zh-CN", label: "中文（简体）" },
  { code: "ja",    label: "日本語" },  // ← add this
] as const;
```

This automatically makes the language available in the LanguageSwitcher dropdown.

---

## Step 5 — Test

1. Run `npm run tauri:dev`.
2. Go to **Settings → Language** and select your new language.
3. Verify all four pages (Dashboard, Widget Center, Settings, and each widget type) display translated text.

---

## Notes

- The language code should follow BCP 47 (e.g., `fr`, `de`, `pt-BR`).
- Fall-through behaviour: if a key is missing, i18next falls back to `en`. This means partial translations are safe to ship.
- Right-to-left languages (e.g., Arabic `ar`) additionally require a `dir="rtl"` attribute on `<html>`; add a `useEffect` in `src/App.tsx` that sets `document.documentElement.dir` based on the active locale.

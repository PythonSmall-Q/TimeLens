# Third-party Widget Template

This template is a complete TypeScript showcase for the rewritten TimeLens widget runtime. It exposes buttons for the current WidgetClient APIs, legacy channel APIs, consent, local API access, and reserved network/media methods.

## Files

- `manifest.json`: widget metadata and v4 runtime declaration
- `index.ts`: TypeScript ESM widget entry and API showcase
- `dist/index.js`: compiled entry loaded by TimeLens
- `types.d.ts`: TypeScript declarations describing the widget context API
- `package.json`: build scripts; run `npm install && npm run build` to compile `index.ts` to `dist/index.js`
- `tsconfig.json`: TypeScript compiler options

## Manifest v4

```json
{
  "manifest_version": "v4",
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "publisher": "TimeLens Example",
  "entry": "dist/index.js",
  "runtime": { "language": "typescript", "version": "5.0", "entry": "dist/index.js" },
  "ui": { "model": "web-sandbox" },
  "capabilities": [
    "screen-time:read",
    "todo:read",
    "todo:write",
    "browser:read",
    "settings:write",
    "local-api:call",
    "active-window:subscribe"
  ]
}
```

In v4, capability strings are runtime scopes. The top-level `entry` must match
`runtime.entry`. This example declares all implemented scopes because it
demonstrates every available API. Network and media calls are mediated by the
Gateway and are subject to public-target, MIME, timeout, and response-size policy.

## Build

```bash
npm install
npm run build
```

## How to test

1. Build the package so `dist/index.js` exists.
2. Copy this folder to your local TimeLens app data widgets directory:
   - `widgets/sample_hello/`
2. Start TimeLens.
3. Open Widget Center → Add Widgets.
4. Add `Sample Hello Widget` and open it.

For faster iteration, use the Widget Dev Harness (dev mode only):

1. Open Widget Center → "Dev Harness".
2. Select this template folder.
3. Toggle capabilities and reload instantly.

## Notes

- Keep `widget_type` unique across all installed widgets.
- The entry file must be valid ESM and export `createWidget()` or `mount()`.
- Use `context.client.query(...)` for new Gateway-mediated data access.
- Use `context.channel.localApiCall({ method, path, scopes })` only for the compatibility API.
- `Client queries/state` exercises all query namespaces, browser activity, and state APIs.
- `Todo write lifecycle` adds, toggles, reorders, and deletes a temporary todo.
- `Legacy read channel` exercises the compatibility read methods.
- `Focus/settings writes` and `Local API call` require their declared scopes.
- `Test reserved network/media` is expected to report unimplemented providers.
- See `docs/WIDGETS_DEV_GUIDE.md` for the current runtime guide and `docs/WIDGET_SDK_v2_MIGRATION.md` for v1/v2 migration.

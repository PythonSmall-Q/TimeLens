# Third-party Widget Template

This template demonstrates the minimum files required to run a third-party JS widget in TimeLens.

## Files

- `manifest.json`: widget metadata and v4 runtime declaration
- `index.js`: ESM widget entry implementing `createWidget().mount/unmount`
- `index.ts`: TypeScript source for the same widget (optional)
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
  "entry": "index.js",
  "runtime": { "language": "javascript", "version": "ES2022", "entry": "index.js" },
  "ui": { "model": "web-sandbox" },
  "capabilities": [
    "screen-time:read",
    "active-window:subscribe",
    "local-api:call"
  ]
}
```

In v4, capability strings are runtime scopes. Declare only the scopes required by
the widget. The top-level `entry` must match `runtime.entry` for the current
JavaScript loader.

## How to test

1. Copy this folder to your local TimeLens app data widgets directory:
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
- See `docs/WIDGETS_DEV_GUIDE.md` for the current runtime guide and `docs/WIDGET_SDK_v2_MIGRATION.md` for v1/v2 migration.

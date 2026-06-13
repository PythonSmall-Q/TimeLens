# Third-party Widget Template

This template demonstrates the minimum files required to run a third-party JS widget in TimeLens.

## Files

- `manifest.json`: widget metadata and registry declaration (Widget SDK v2)
- `index.js`: ESM widget entry implementing `createWidget().mount/unmount`
- `index.ts`: TypeScript source for the same widget (optional)
- `types.d.ts`: TypeScript declarations describing the widget context API
- `package.json`: build scripts; run `npm install && npm run build` to compile `index.ts` to `dist/index.js`
- `tsconfig.json`: TypeScript compiler options

## Manifest v2

```json
{
  "manifest_version": "v2",
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "entry": "index.js",
  "capabilities": [
    { "capability": "read_metrics", "permission": "screen-time:read" },
    { "capability": "automation_trigger", "permission": "active-window:subscribe" },
    { "capability": "local_api_call", "permission": "local-api:call" }
  ]
}
```

### Capabilities

| Capability | Default runtime permissions granted |
|---|---|
| `read_metrics` | `screen-time:read`, `todo:read` |
| `write_data` | `todo:write`, `settings:write` |
| `automation_trigger` | `active-window:subscribe` |
| `local_api_call` | `local-api:call` |

You can also declare capabilities as plain strings; in that case TimeLens expands
each capability to its default permissions. Use the object form when you want to
request only a specific permission from a capability group.

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
- Use `context.channel.localApiCall({ method, path, scopes })` to call the TimeLens local HTTP API.
- See `docs/WIDGET_SDK_v2_MIGRATION.md` for migration from v1 manifests.

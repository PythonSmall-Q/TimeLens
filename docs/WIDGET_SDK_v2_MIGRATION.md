# Widget SDK v2 Migration Guide

TimeLens 2.0.0 introduces Widget SDK v2. This guide explains the manifest version policy, capability model, and how to upgrade an existing v1 widget.

## Manifest version policy

- `manifest_version` is now a required top-level integer field.
- Supported values: `1` (legacy, auto-upgraded) and `2` (current).
- If `manifest_version > 2`, TimeLens rejects the widget with the error **"unsupported manifest version"**.
- v1 manifests continue to load, but they are normalized to v2 internally.

## Mapping legacy permissions to capabilities

In v1 you declared `permissions` as method-level strings. In v2 you declare `capabilities`, which are broader security buckets. TimeLens maps between them automatically.

| Legacy permission | v2 capability |
|---|---|
| `screen-time:read` | `read_metrics` |
| `todo:read` | `read_metrics` |
| `todo:write` | `write_data` |
| `settings:write` | `write_data` |
| `active-window:subscribe` | `automation_trigger` |
| `local-api:call` | `local_api_call` |

### Reverse mapping (capability → runtime permissions)

When you declare a capability, TimeLens grants the underlying runtime permission strings so the widget channel works out of the box.

| v2 capability | Runtime permissions granted |
|---|---|
| `read_metrics` | `screen-time:read`, `todo:read` |
| `write_data` | `todo:write`, `settings:write` |
| `automation_trigger` | `active-window:subscribe` |
| `local_api_call` | `local-api:call` |

## New `local-api:call` capability

Widgets can now call the TimeLens local HTTP API directly through the widget channel:

```js
const result = await context.channel.localApiCall({
  method: "GET",
  path: "/api/screen-time/today",
  scopes: ["screen-time:read"],
});
```

Requirements:

1. The widget manifest includes the `local_api_call` capability.
2. The user has granted the `local-api:call` permission to this widget instance.
3. The requested `scopes` match the endpoint being called (e.g. `screen-time:read` for `GET /api/screen-time/today`).

The host automatically issues a scoped local API token and attaches it as the `X-Api-Token` header. The client ID is set to `widget-<widget_id>`, which the local API allowlist treats as a widget identity.

## How to upgrade a v1 widget

1. Add `"manifest_version": 2` to `manifest.json`.
2. Replace or supplement `permissions` with `capabilities`.

Before:

```json
{
  "widget_type": "my_widget",
  "name": "My Widget",
  "entry": "index.js",
  "permissions": ["screen-time:read", "active-window:subscribe"]
}
```

After:

```json
{
  "manifest_version": 2,
  "widget_type": "my_widget",
  "name": "My Widget",
  "entry": "index.js",
  "capabilities": ["read_metrics", "automation_trigger"],
  "sdk_version": "2.0.0"
}
```

3. If you want to call the local API, add `"local_api_call"` to `capabilities` and use `context.channel.localApiCall(...)`.
4. Optional: add `csp` for a custom Content Security Policy string, or `signature` for an SHA-256 integrity check of the entry file.

## Additional optional fields

| Field | Type | Description |
|---|---|---|
| `sdk_version` | `string` | Widget SDK version the widget targets |
| `csp` | `string` | Content Security Policy hint |
| `signature` | `string` | Hex SHA-256 digest of the entry file for integrity verification |

## Backward compatibility

- TimeLens 2.0.0 still loads v1 manifests and auto-upgrades them.
- Existing installed widgets do not need to be re-imported.
- The Widget Dev Harness (available in dev mode) can load both v1 and v2 manifests from a local folder without installation.

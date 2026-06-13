# Widget SDK v2 Migration Guide

This document describes the Widget SDK v2 manifest format introduced in TimeLens
v2.0.0 (Phase 5). It covers the new `capabilities` array, `local_api_call`
usage, the optional `signature` field, and how to migrate from v1 manifests.

## Table of contents

- [Quick comparison](#quick-comparison)
- [Required and optional fields](#required-and-optional-fields)
- [Capabilities vs. permissions](#capabilities-vs-permissions)
  - [Object form](#object-form)
  - [String form](#string-form)
  - [Permission to capability mapping](#permission-to-capability-mapping)
- [`local_api_call` usage](#local_api_call-usage)
- [Signature field](#signature-field)
- [Migrating from v1](#migrating-from-v1)
- [Testing with the Widget Dev Harness](#testing-with-the-widget-dev-harness)

## Quick comparison

| v1 manifest | v2 manifest |
|---|---|
| `"manifest_version": 1` or omitted | `"manifest_version": "v2"` |
| `permissions: ["screen-time:read"]` | `capabilities: [{ "capability": "read_metrics", "permission": "screen-time:read" }]` |
| No local API support | `local_api_call` capability |
| No integrity check | Optional `signature` SHA-256 of entry file |

## Required and optional fields

A minimal v2 manifest looks like this:

```json
{
  "manifest_version": "v2",
  "widget_type": "my_widget",
  "name": "My Widget",
  "entry": "index.js"
}
```

Required fields:

- `manifest_version`: must be `"v2"` (or the legacy integer `2`).
- `widget_type`: unique identifier, `[a-zA-Z0-9_-]` only.
- `name`: human-readable widget name.
- `entry`: path to the ESM entry file, relative to the manifest.

Optional fields:

- `description`: short description shown in Widget Center.
- `icon`: icon identifier or path.
- `default_size`: `{ "width": number, "height": number }`.
- `capabilities`: array of capability objects or strings (see below).
- `permissions`: legacy array of runtime permission strings. Still supported for
  forward compatibility.
- `sdk_version`: SDK version the widget targets, e.g. `"2.0.0"`.
- `csp`: optional Content-Security-Policy applied to the widget iframe.
- `signature`: SHA-256 hex digest of the entry file. When present, TimeLens
  verifies the entry file hash before loading the widget.

## Capabilities vs. permissions

In SDK v2 you declare **capabilities**. Each capability maps to one or more
runtime **permissions** that the user grants to the widget instance.

### Object form

The recommended v2 form lets you request a specific permission within a
capability group:

```json
{
  "capabilities": [
    { "capability": "read_metrics", "permission": "screen-time:read" },
    { "capability": "automation_trigger", "permission": "active-window:subscribe" },
    { "capability": "local_api_call", "permission": "local-api:call" }
  ]
}
```

The `permission` property is optional. When omitted, TimeLens expands the
capability to its default permissions.

### String form

For convenience you can still pass an array of capability names:

```json
{
  "capabilities": ["read_metrics", "write_data", "local_api_call"]
}
```

String capabilities expand to their default permissions.

### Permission to capability mapping

| Runtime permission | Capability | Notes |
|---|---|---|
| `screen-time:read` | `read_metrics` | Read aggregated screen time metrics. |
| `todo:read` | `read_metrics` | Read todos. |
| `todo:write` | `write_data` | Create / modify todos. |
| `settings:write` | `write_data` | Change app settings such as focus mode. |
| `active-window:subscribe` | `automation_trigger` | Receive active-window change events. |
| `local-api:call` | `local_api_call` | Call the local TimeLens HTTP API. |

If a manifest contains the legacy `permissions` array but no `capabilities`
array, TimeLens treats it as a v1 manifest and derives capabilities from the
permissions automatically.

## `local_api_call` usage

Widgets with the `local_api_call` capability can call the TimeLens local HTTP
API through the widget bridge instead of making raw `fetch` calls themselves.
The bridge automatically issues a scoped token and attaches the required
headers.

```js
const result = await context.channel.localApiCall({
  method: "GET",
  path: "/api/screen-time/today",
  scopes: ["screen-time:read"],
});
```

Available local API scopes include:

- `screen-time:read`
- `browser:read`
- `browser:write`
- `vscode:read`
- `vscode:write`
- `active-window:subscribe` (for WebSocket subscriptions)

The token is issued once per call, cached only for the request, and scoped to
the requested `scopes`. The actual HTTP request is sent to
`http://127.0.0.1:49152` with headers:

- `X-Client-Id: widget-<widget_id>`
- `X-Api-Token: <scoped-token>`

## Signature field

To protect against tampering, add the SHA-256 hex digest of your entry file:

```json
{
  "signature": "a1b2c3d4..."
}
```

Generate it with:

```bash
# Linux / macOS
shasum -a 256 index.js | awk '{print $1}'

# Windows PowerShell
(Get-FileHash index.js -Algorithm SHA256).Hash.ToLower()
```

If the entry file content does not match the signature, TimeLens refuses to
load the widget and reports a signature mismatch in Widget Center.

## Migrating from v1

1. Change `manifest_version` to `"v2"`.
2. Replace `permissions` with `capabilities`.
3. Map each legacy permission to the appropriate capability (see table above).
4. If you previously used raw `fetch` against `http://127.0.0.1:49152`, replace
   those calls with `context.channel.localApiCall(...)` and add the
   `local_api_call` capability.
5. Optionally add `sdk_version` and `signature`.

Example migration:

```json
// v1
{
  "manifest_version": 1,
  "widget_type": "my_widget",
  "name": "My Widget",
  "entry": "index.js",
  "permissions": ["screen-time:read", "todo:write"]
}

// v2
{
  "manifest_version": "v2",
  "widget_type": "my_widget",
  "name": "My Widget",
  "entry": "index.js",
  "capabilities": [
    { "capability": "read_metrics", "permission": "screen-time:read" },
    { "capability": "write_data", "permission": "todo:write" }
  ],
  "sdk_version": "2.0.0"
}
```

TimeLens remains backward compatible: old v1 manifests are automatically
upgraded to v2 at load time.

## Testing with the Widget Dev Harness

During development, use the Widget Dev Harness to iterate without installing
widgets:

1. Build TimeLens in development mode.
2. Open Widget Center → "Dev Harness".
3. Select your widget folder.
4. Toggle capabilities and reload instantly.

The harness uses a mock channel, so `localApiCall` returns a mock response
unless you point it at a running TimeLens local API server.

# Widget Development Guide

This guide describes the third-party widget runtime after the Kernel and Gateway rewrite. The first supported runtime is sandboxed JavaScript or TypeScript. Java is represented in the v4 manifest contract, but its host is not yet available.

## Current scope

Supported today:

- Local packages discovered from the app data `widgets` directory.
- ESM JavaScript or compiled TypeScript entry files.
- `createWidget()` or direct `mount()` exports.
- Gateway-mediated usage queries, todo writes, widget-scoped state, subscriptions, and local API calls.
- Runtime consent prompts, permission revocation, request throttling, lifecycle events, and audit records.
- v1/v2 manifests through the compatibility adapter.

Not available yet:

- Remote marketplace or cloud execution.
- Gateway-mediated network and media proxies are implemented. `client.fetch()` is policy-firewalled, time-limited, and response-size-limited; `client.loadMedia()` additionally accepts only image/audio/video content and returns a data URL.
- Java runtime hosting.
- Raw database, filesystem, unrestricted `fetch`, or direct privileged Tauri calls.

## Package layout

Install a widget as a directory under the TimeLens app data directory:

```text
widgets/
  my-widget/
    manifest.json
    index.js
    assets/
```

The current JavaScript loader uses the top-level `entry` path. Keep it aligned with `runtime.entry` in a v4 manifest; the latter describes the runtime contract and is required by the shared v4 schema.

## Manifest v4

```json
{
  "manifest_version": "v4",
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "description": "A minimal Gateway-based widget",
  "publisher": "Example Publisher",
  "entry": "index.js",
  "runtime": {
    "language": "javascript",
    "version": "ES2022",
    "entry": "index.js",
    "memory_budget_mb": 64,
    "cpu_budget_ms": 1000
  },
  "ui": { "model": "web-sandbox" },
  "default_size": { "width": 360, "height": 240 },
  "capabilities": ["metrics.summary.read"],
  "capability_justifications": {
    "metrics.summary.read": "Shows today's tracked usage."
  },
  "sdk_version": "4.0.0"
}
```

The v4 contract requires `manifest_version: "v4"`, unique `widget_type`, `name`, `publisher`, `runtime.language`, `runtime.version`, `runtime.entry`, `ui.model`, and a `capabilities` array. Runtime languages are `javascript`, `typescript`, and `java`; UI models are `web-sandbox` and `host-block`.

The current JavaScript loader also requires the compatibility top-level `entry`. `default_size`, `description`, `icon`, `sdk_version`, `signature`, `csp`, memory/CPU budgets, capability justifications, requested network domains, and requested media sources are optional. The registry normalizes v4 data for Widget Center.

## Capabilities and consent

Every privileged request is normalized into a Gateway request. A missing grant returns a recoverable denial; the host displays a consent prompt and retries once only when the user accepts. A denial is never silently bypassed. Users can revoke individual permissions or all permissions in Widget Center.

| Scope | Gateway access |
|---|---|
| `screen-time:read` | `metrics`, `sessions`, `categories`, `projects`, `tags`, `goals`, `rules`, and `focus` queries |
| `todo:read` | `todos` query |
| `todo:write` | Add, toggle, delete, and reorder todos |
| `browser:read` | Browser activity query |
| `settings:write` | Focus-mode writes through the SDK |
| `local-api:call` | Scoped calls to the local TimeLens API |

Declare only the capabilities the widget needs. `network_domains_requested` and `media_sources_requested` document intent; runtime requests still pass through Gateway policy and consent checks.

## Widget entry contract

TimeLens imports the entry as an ESM module. Both forms are supported:

```js
export function createWidget() {
  let root;

  return {
    async mount(container, context) {
      root = document.createElement("div");
      root.textContent = `Hello from ${context.widgetType}`;
      container.appendChild(root);
      const data = await context.client.query("metrics");
      console.log(data);
    },
    unmount() {
      root?.remove();
      root = null;
    },
  };
}
```

Alternatively export `mount(container, context)` and an optional `unmount()`. `mount` may return a promise. The context contains `widgetId`, `widgetType`, the new `client`, a backward-compatible `channel`, and optional `lifecycle` callbacks for mount, foreground, background, suspend, resume, and uninstall. New widgets should use `client`; use `channel` only while migrating an existing widget. Release subscriptions in `unmount` or call `context.client.dispose()` when the client is owned by the widget.

## WidgetClient API

```js
const metrics = await context.client.query("metrics", {
  start: "2026-08-01",
  end: "2026-08-27",
});

const value = await context.client.getState("selected-range");
await context.client.setState("selected-range", "today");
await context.client.deleteState("selected-range");

const todo = await context.client.addTodo("Review screen time");
await context.client.toggleTodo(todo.id);
await context.client.reorderTodos([todo.id]);

const handle = await context.client.subscribe("focus-started", (payload) => {
  console.log(payload);
});
await context.client.unsubscribe(handle);
```

Query namespaces are `metrics`, `sessions`, `categories`, `projects`, `tags`, `goals`, `rules`, `focus`, `todos`, and `browser`. Browser activity is also available as `getBrowserActivity(start, end)`.

Local API calls remain available through the compatibility channel:

```js
const result = await context.channel.localApiCall({
  method: "GET",
  path: "/api/screen-time/today",
  scopes: ["screen-time:read"],
});
```

The channel obtains a scoped token for the widget. Do not use an unscoped token, raw privileged bridge, or direct local API call.

## Errors, lifecycle, and testing

Gateway statuses include `success`, `denied`, `revoked`, `throttled`, `timed_out`, `degraded`, and `error`. `WidgetGatewayError` exposes `code`, `scope`, and `recoverable`; use `error.isConsentRequired()` for missing or denied consent. The host emits `mount`, `foreground`, `background`, `suspend`, `resume`, and `uninstall` events. Do not assume a widget window remains focused indefinitely.

For local testing, copy the package to the app data `widgets` directory, start TimeLens in development mode, open Widget Center > Add Widgets, and inspect the first-request consent prompt. Use the permission matrix to revoke and re-grant scopes. The development-only Widget Dev Harness can load a local folder, mock Gateway responses, toggle capabilities, and reload the entry.

The Gateway currently limits widget channel calls to 60 per minute. A `permission_denied` result means the scope must be accepted or re-granted. Network and media requests can also return policy, timeout, provider, or size-limit errors; callers should surface these as recoverable widget errors.

For v1/v2 migration details, see [`WIDGET_SDK_v2_MIGRATION.md`](WIDGET_SDK_v2_MIGRATION.md). The shared schema is `src-tauri/widget-contract/manifest-v4.schema.json`; the reference starter is `examples/third-party-widget-template/`.
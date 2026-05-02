# Widget Development Guide

This guide explains how to build third-party JavaScript widgets for TimeLens v0.8.0 widget registry prototype.

## Scope (v0.8.0)

- Local directory loading only (`manifest.json` + JS entry)
- Runtime registry discovery from app data `widgets` directory
- Render contract: `createWidget()` or `mount()` export
- Data channel (current): read-focused APIs

Not included yet:
- Remote marketplace
- Signature verification
- Cloud distribution

## Directory Layout

Each third-party widget lives in its own folder under the app data widgets directory.

```text
widgets/
  my-widget/
    manifest.json
    index.js
    assets/
```

## manifest.json

Minimal manifest example:

```json
{
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "description": "Minimal third-party widget example",
  "entry": "index.js",
  "default_size": {
    "width": 360,
    "height": 240
  },
  "permissions": [
    "screen-time:read",
    "active-window:subscribe"
  ]
}
```

### Required fields

- `widget_type`: unique widget type identifier (`[a-zA-Z0-9_-]`)
- `name`: display name in registry
- `entry`: entry JS file relative to manifest folder

### Optional fields

- `description`
- `icon`
- `default_size.width` / `default_size.height`
- `permissions`

## Render Interface Contract

TimeLens loads your entry as an ESM module.

Supported exports:

1. `createWidget()` returning an object with `mount()` and optional `unmount()`
2. direct `mount()` export with optional `unmount()` export

```js
export function createWidget() {
  let root;

  return {
    mount(container, context) {
      root = document.createElement("div");
      root.textContent = `Hello from ${context.widgetType}`;
      container.appendChild(root);
    },
    unmount() {
      root?.remove();
      root = null;
    }
  };
}
```

## Context and Data Channel

`mount(container, context)` receives:

- `context.widgetId`
- `context.widgetType`
- `context.channel`

Current channel methods:

- `getTodayAppTotals()`
- `getAppTotalsInRange(startDate, endDate)`
- `getCategoryTotalsInRange(startDate, endDate)`
- `onActiveWindowChanged(callback)`

## Permissions Model (Prototype)

Manifest permissions are discoverable in registry metadata. In this milestone, permission strings are not fully enforced yet; they are designed for upcoming install-time authorization UI.

Recommended strings:

- `screen-time:read`
- `active-window:subscribe`
- `todo:read`
- `todo:write`
- `settings:write`

## Local Testing

1. Build or copy your widget folder to app data `widgets` directory.
2. Start TimeLens in dev mode.
3. Open Widget Center and switch to Add Widgets.
4. Find your third-party entry and click Add.
5. Open created widget instance.

## Troubleshooting

- Registry entry missing:
  - check `manifest.json` parse errors
  - verify `widget_type` format
  - ensure `entry` file exists
- Widget window opens but nothing renders:
  - ensure module exports `createWidget()` or `mount()`
  - check browser console for dynamic import errors
- Unknown widget type on create:
  - registry load failed or duplicate `widget_type`

# Focus Summary Widget Template

A minimal TypeScript widget template for the TimeLens Widget Runtime v4.

It reads the `metrics` namespace through `WidgetClient`, displays today's tracked minutes, and refreshes every 30 seconds.

1. Copy this directory.
2. Compile `index.ts` to `dist/index.js`.
3. Import the directory from Widget Center.
4. Use Widget Dev Harness to test permissions and reload behavior.

The template is intentionally read-only and requests only `screen-time:read`.

# TimeLens VS Code Extension

Track VS Code coding sessions and send local analytics to TimeLens desktop app.

## Features

- Track session duration by project and language
- Local-first reporting to `http://127.0.0.1:49152`
- Retry with local in-memory queue when app is temporarily unavailable
- Commands:
  - `TimeLens: Enable Tracking`
  - `TimeLens: Disable Tracking`
  - `TimeLens: Show Tracking Status`

## Requirements

- TimeLens desktop app must be running locally
- Local API server enabled (default port `49152`)

## Extension Settings

- `timelens.enabled`: enable/disable tracking
- `timelens.apiBaseUrl`: local API URL
- `timelens.flushIntervalSeconds`: queue flush interval
- `timelens.idleThresholdSeconds`: idle split threshold

## Build

```bash
npm install
npm run build
```

## Package VSIX

```bash
npm run package
```

Or from repository root:

```bash
npm run ext:package
```

## Privacy

- No source code content is collected
- No file path is collected in tracked payload
- Data is sent only to local TimeLens API

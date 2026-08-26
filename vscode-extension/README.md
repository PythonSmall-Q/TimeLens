# TimeLens VS Code Extension

Track VS Code coding sessions and send local analytics to TimeLens desktop app.

## Quick Start

1. **Get your API key** from TimeLens desktop app:
   - Settings → Local API / Extension Bridge → copy Extension Bridge Key

2. **Configure the extension**:
   - Open VS Code and look for TimeLens sidebar
   - Click **⚙️ 配置 API 密钥** button, or
   - Use command: `TimeLens: Set Extension Bridge Key`

3. **Start tracking**: VS Code sessions will automatically sync to TimeLens

> ⚠️ **Important**: Without API key configuration, data will queue locally but won't sync to the desktop app.

## Features

- Track session duration by project and language
- Local-first reporting to `http://127.0.0.1:49152`
- Retry with local in-memory queue when app is temporarily unavailable
- Real-time sync status in VS Code sidebar
- Commands:
  - `TimeLens: Enable Tracking`
  - `TimeLens: Disable Tracking`
  - `TimeLens: Show Tracking Status`
  - `TimeLens: Set/Update Extension Bridge Key`

## Requirements

- TimeLens desktop app must be running locally
- Local API server enabled (default port `49152`)
- Extension Bridge Key from TimeLens Settings

## Extension Settings

- `timelens.enabled`: enable/disable tracking
- `timelens.apiBaseUrl`: local API URL (default: `http://127.0.0.1:49152`)
- `timelens.bridgeKey`: **extension bridge key from TimeLens Settings** (required for sync)
- `timelens.trackingLevel`: recording detail level (basic/standard/detailed)
- `timelens.flushIntervalSeconds`: queue flush interval (default: 30)
- `timelens.idleThresholdSeconds`: idle split threshold (default: 120)

## Troubleshooting

**"Extension bridge key authentication failed"**
- Check that your API key is correct in Settings
- Ensure TimeLens desktop app is running
- Restart VS Code

**"Unable to connect to TimeLens desktop app"**
- Start the TimeLens desktop app
- Check that Local API is enabled in TimeLens Settings
- Verify `timelens.apiBaseUrl` matches your setup

**Data not syncing**
- Verify API key is configured (see Quick Start)
- Check that tracking is enabled in the sidebar
- Look at VS Code Output panel for errors

See [VSCODE_EXTENSION_SETUP.md](./VSCODE_EXTENSION_SETUP.md) for detailed setup instructions.

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
- API key is stored locally in VS Code settings

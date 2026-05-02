# Third-party Widget Template

This template demonstrates the minimum files required to run a third-party JS widget in TimeLens.

## Files

- `manifest.json`: widget metadata and registry declaration
- `index.js`: ESM widget entry implementing `createWidget().mount/unmount`

## How to test

1. Copy this folder to your local TimeLens app data widgets directory:
   - `widgets/third-party-widget-template/`
2. Start TimeLens.
3. Open Widget Center -> Add Widgets.
4. Add `Sample Hello Widget` and open it.

## Notes

- The current prototype supports local loading only.
- Keep `widget_type` unique across all installed widgets.
- The entry file must be valid ESM and export `createWidget()` or `mount()`.

// Minimal ambient declaration for the Node built-in used by settingsStore.test.ts
// to read globals.css (vitest stubs all CSS imports to empty strings, so ?raw is
// not an option). @types/node is intentionally not a project dependency; extend
// this declaration if more Node APIs are needed from tests.
declare module "node:fs" {
  export function readFileSync(path: string | URL, options: string | { encoding: string }): string;
}

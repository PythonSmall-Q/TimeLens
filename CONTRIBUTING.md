# Contributing to TimeLens

Thank you for your interest in contributing! Please follow these guidelines to keep the project healthy.

---

## Development Setup

```bash
# Prerequisites: Node.js ≥ 18, Rust ≥ 1.77, Tauri CLI 2.x

git clone https://github.com/PythonSmall-Q/TimeLens.git
cd TimeLens
npm install
npm run tauri:dev
```

Refer to [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for a full environment guide, debugging tips, and architecture notes.

---

## Pull Request Process

1. **Fork** the repository and create a feature branch from `dev`:
   ```
   git checkout -b feat/your-feature dev
   ```
2. Make your changes. Keep commits focused and atomic.
3. Run checks locally before pushing:
   ```bash
   npm run lint
   npm run typecheck
   cd src-tauri && cargo check
   ```
4. Open a PR targeting the `dev` branch. Fill in the PR template.
5. A maintainer will review and merge to `dev`; `dev` → `main` merges happen on scheduled releases.

---

## Code Style

| Scope | Rule |
|-------|------|
| TypeScript / React | ESLint + Prettier (config in repo root) |
| Rust | `cargo fmt` + `cargo clippy` |
| Commit messages | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`) |

Run `npm run format` to auto-format TypeScript/JSON files.

---

## Adding a Language

See [docs/ADD_LANGUAGE.md](docs/ADD_LANGUAGE.md).

---

## Reporting Bugs

Open an issue with:
- TimeLens version
- OS and version
- Steps to reproduce
- Expected vs actual behaviour
- Logs from `Help → Open Log Directory` (if applicable)

---

## License

By contributing, you agree your contributions will be licensed under the MIT License.

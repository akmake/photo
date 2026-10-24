# photo

AI editing tool for photographers - recipe builder core

## Main directories

- `src` — application code.
- `engine` — processing engine.
- `electron` — Electron desktop integration.
- `integrations` — integrations.
- `docs` — documentation.

## Scripts

- `npm run dev`: `vite`
- `npm run shell`: `electron .`
- `npm run build`: `tsc && vite build`
- `npm run build:engine`: `npm run license:pin && cd engine && .venv\Scripts\python.exe build_protected.py && set TEZA_PROTECT=1&& .venv\Scripts\python.exe -m PyInstal`
- `npm run license:pin`: `node scripts/license-pin.cjs`
- `npm run license:preflight`: `node scripts/license-preflight.cjs`
- `npm run protect:shell`: `node scripts/protect-shell.cjs`
- `npm run protect:manifest`: `node scripts/engine-manifest.cjs`
- `npm run package:win:dir`: `npm run license:preflight && npm run build && npm run protect:shell && npm run protect:manifest && electron-builder --win --x64 --dir`
- `npm run package:win`: `npm run license:preflight && npm run build && npm run protect:shell && npm run protect:manifest && set ELECTRON_BUILDER_7Z_FILTER=BCJ&& elec`
- `npm run package:win:full`: `npm run build:engine && npm run package:win`
- `npm run release:upload`: `node scripts/release-upload.cjs`

# Elite Dangerous Bindings

Angular 22 + Angular Material web app that views, edits and prints Elite Dangerous `.binds` files. Fully static; no backend.

## Development runs in an Apple container

Never run node/npm/ng on the macOS host. A dev container named `edb-dev` (image `node:24`) mounts the repo at `/workspace` and publishes port 4200:

```sh
# create once (if `container list` doesn't show it)
container run -d --name edb-dev -v "$PWD":/workspace -w /workspace -p 4200:4200 --memory 8g --cpus 6 node:24 sleep infinity
# run anything
container exec edb-dev sh -c 'cd /workspace && npm test'
```

- `npm start` – dev server on http://localhost:4200 (regenerates the device index first)
- `npm run build` / `npm test` (Vitest via `ng test --watch=false`; limit with `-- --include 'src/app/features/x/**/*.spec.ts'`)
- `npm run e2e` – Playwright end-to-end tests in `e2e/` (Chromium inside the container)
- `npm run shots [-- <name>]` – screenshot tooling in `tools/screenshots/*.shots.ts` for visual checks; not tests, never in CI. Output in `test-results/shots/`
- `npm run devices:check` – validate every `devices/*/device.json` against `schemas/device.schema.json`
- `npm run import-data` – re-import upstream data (`tools/fetch-upstream.sh` + `tools/import_data.py`)

## Layout

- `src/app/core/binds/` – lossless `.binds` engine. `BindsDocument` edits the XML in place; an unedited file serialises byte-for-byte identical (tested). Never rewrite files through DOMParser/XMLSerializer.
- `src/app/core/binds/contexts.ts` – which game context (ship, SRV, SRV turret, on foot, FSS, free camera, …) each action is live in, plus `SHARED_BY_DESIGN` pairs. Conflicts = same input + modifiers + hold/tap, overlapping contexts, not shared by design. `src/testing/fixtures/X52.4.2.binds` (nearly default) must report zero conflicts.
- `src/app/core/data/` – `CatalogService`: actions (`public/data/actions.json`), keys, named device IDs, device index + lazily loaded `devices/<id>/device.json`, labels (`inputLabel`, `controlLabel`).
- `src/app/core/state/` – `BindingsStore` (open file, `mutate()` for every edit = undo step + autosave, `changes`), `FileActions` (open/save/download).
- `src/app/core/input/` – `InputService`: WebHID first, Gamepad API fallback, keyboard; emits Elite-named inputs. Public API in `input.service.ts` is a contract used by other features.
- `src/app/features/<feature>/` – lazy-loaded pages: home, bindings, cards, live, devices, about.
- `src/app/shared/` – `inputLabel` pipe, `app-device-diagram` (device artwork + control boxes).
- `devices/<Id>/device.json` + artwork – one folder per controller; schema in `schemas/device.schema.json`.

## Conventions

- Tests (`*.spec.ts`, `e2e/`) may only read tracked files, e.g. `src/testing/fixtures/`, `public/`. Never `upstream/` (git-ignored, absent in CI). Screenshot scripts go in `tools/screenshots/`, not `e2e/`; they may use `upstream/` only via `fixtures.ts#upstream()`, which skips when it's missing.

- Standalone components, signals, `inject()`, new control flow (`@if/@for`), OnPush where practical.
- Material 3 components; icons are Material Symbols (`<mat-icon>name</mat-icon>`, default font set configured).
- Colours come from CSS tokens in `src/styles.scss` (`--edb-accent`, `--edb-danger`, `--mat-sys-*`), not hard-coded values.
- Elite naming everywhere in the model: devices as written in `.binds` (`Keyboard`, `231D0200`, `SaitekX56Joystick`), controls as `Key_A`, `Joy_3`, `Joy_XAxis`, `Joy_POV1Up`, `Pos_Joy_XAxis`, `GamePad_FaceDown`.
- Every document edit goes through `BindingsStore.mutate()` / `setSlot()`.

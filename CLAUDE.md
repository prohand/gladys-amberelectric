# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Amber Electric**, the Australian
retailer that passes the wholesale price through. It reads the live and forecast prices of
the user's Amber sites from the Amber public API (cloud only, manifest `transports:
["cloud"]`), publishes them as Gladys devices, and adds scene triggers (price
level, spike status, feed-in crossing zero), scene actions (read the current price, find the
cheapest window) and an "Amber prices" dashboard widget. Requires Gladys 5.3.0+.

It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js); the
workflows are the same as [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/prices.test.js             # one file
node --test --test-name-pattern "cheapest"  # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also run the store
checks and build the image. Releases: **Actions → Release** only (bumps `package.json`,
manifest `version` + `docker_image`, re-runs Prettier, rolls `CHANGELOG.md`, tags, builds,
publishes the GitHub Release).

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization + log level
src/i18n.js                  LANGUAGES (en, fr, de, es), pick, localize
src/service.js               the price loop: sites, refresh, states, triggers, badges, status
src/connection.js            user messages per error code + "Test the connection" report
src/amber/client.js          Amber API client (fetch, Bearer token, typed AmberApiError)
src/amber/prices.js          pure: raw intervals -> snapshot, $/kWh, feed-in sign, cheapest window
src/amber/labels.js          Amber levels / spike / periods in 4 languages + widget colors
src/devices/site.js          one Gladys device per Amber site (features per meter channel)
src/capabilities/scenes.js   scene triggers (transitions) + scene actions
src/capabilities/widget.js   "amber_prices" dashboard widget
gladys-assistant-integration.json  manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys
test/                        node --test, fake Gladys of the SDK + test/helpers/amber.js
```

### Invariants worth knowing

- **One Amber call per site per refresh.** `GET /sites/{id}/prices/current?next=N` returns
  the current interval of every channel plus the forecast; it feeds the states, the
  triggers, the widget and the scene actions. Amber rate-limits the account: a 429 pauses
  the loop until `RateLimit-Reset`. Never add a timer that calls the API.
- **Refreshes are aligned** on the refresh interval counted from midnight UTC + 15 s
  (`nextRefreshDelay`): with 300 s they land just after each NEM 5-minute interval.
- **Units.** Amber speaks c/kWh; device features are in $/kWh (Gladys `dollar` unit, category
  `currency`); the widget shows c/kWh like the Amber app.
- **Feed-in sign.** Amber's feed-in `perKwh` is negative when the customer is paid. It is
  flipped in `prices.js`: the feature and the outputs are what the user EARNS (negative =
  exporting costs). Do not flip it twice.
- **Forecasts** use `advancedPrice.predicted` when present, `perKwh` otherwise.
- **Triggers fire on transitions only.** The first refresh after a start sets the baseline
  (no event). Scene actions never fire events (no loops) and never move the baselines.
- **States** go through `publishChangedStates` (30-minute heartbeat); a device not created
  yet in Gladys is not an error.
- **External ids** come from the Amber site id (`gladys.externalIds('site', site.id)`) and the
  feature keys in `FEATURES`: never change them, Gladys keys history and scenes on them.
  Trigger, action, widget and config keys are stored by users too: never rename them.
- **The API token is a secret**: never log it, not even partially. Nothing is written to
  disk (`/data` is the only writable path and is not used).

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code: handlers for
every action / scene action / widget, every fired trigger declared, `DEFAULT_CONFIG` and
`LIMITS` matching the defaults and bounds, `transports: ["cloud"]`, every text in
`en`/`fr`/`de`/`es`, catalog description 10–100 characters, `gladys_version >= 5.3.0`
(`keywords`, `countries`), keywords 1–10 of 2–30 characters, `countries: ["AU"]`, catalog
shelves in the store vocabulary,
version and image tag in lockstep with `package.json`.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or in
  the manifest, nor the `docker_image` tag, by hand.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow moves the section.
- **User-facing text** is `{ en, fr, de, es }`: manifest texts, action and status messages,
  widget texts, and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md` kept in sync
  (`test/docs.test.js` checks they share the same outline).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network: `test/helpers/amber.js` fakes the API.

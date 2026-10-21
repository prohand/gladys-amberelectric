# Amber Electric — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to
[Amber Electric](https://www.amber.com.au), the Australian electricity retailer that passes
the wholesale price through: live and forecast prices, price spikes and the renewable share
of the grid, for your scenes and your dashboard.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

**Transport: cloud** (manifest `"transports": ["cloud"]`). Amber has no local API: the
integration talks to `https://api.amber.com.au/v1` with the user's personal API token, and
reports a `cloud` badge per site (`unreachable` when the last read failed).

| Device                     | Gladys features                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Amber site (one per meter) | Electricity price, wholesale spot price, controlled load price¹, feed-in price¹ ($/kWh), renewables (%) |

¹ Only when the meter has that channel. The feed-in price is what the user earns per kWh
exported (Amber's sign flipped): negative means exporting costs money.

Since Gladys 5.1 it also extends the scene editor and the dashboard
(`src/capabilities/`):

| Capability      | Key                      | What it does                                                         |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| Scene trigger   | `price_level_changed`    | Amber's price level moved (extremely low … spike)                    |
| Scene trigger   | `spike_status_changed`   | A spike became possible, started or ended                            |
| Scene trigger   | `feed_in_status_changed` | Exporting started to cost money, or pays again                       |
| Scene action    | `get_current_price`      | Outputs the current price, level, spike status, renewables, period   |
| Scene action    | `find_cheapest_window`   | Outputs when a load of N minutes is cheapest in the next H hours     |
| Widget          | `amber_prices`           | Price now, feed-in, renewables, level, spike, period, forecast chart |
| Manifest action | `test_connection`        | Lists the sites of the account with their ids and the price now      |

## How it works

One refresh = one `GET /sites/{id}/prices/current?next=N` per followed site: the current
interval of every channel plus `forecast_hours` of forecast. That single answer feeds the
device states (sent only when they change), the scene triggers (fired on transitions), the
widget and the scene actions. Refreshes are aligned on Amber's 5-minute intervals; a `429`
pauses them until the window Amber names is over.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no Amber logic)
├─ src/
│  ├─ service.js                     # the price loop
│  ├─ connection.js                  # user messages + "Test the connection"
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ amber/                         # API client, price maths, labels
│  ├─ devices/site.js                # one Gladys device per Amber site
│  └─ capabilities/                  # scenes and dashboard widget (Gladys 5.1+)
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # unit tests (`node --test`), no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # rules for contributors and coding assistants
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/                          # CI, build, release, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="amber-electric" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the integration
runs inside its sandboxed container. The Amber API token is set in the Gladys configuration
screen, never in an environment variable.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test, against the fake Gladys of the SDK
```

The same checks run on every push and pull request (Node 22 and 24), plus the store
admission checks and a Docker build on pull requests. See
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Release

1. Describe your changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps the version everywhere (`package.json`, manifest `version` and
`docker_image`), moves the changelog section, pushes the `vX.Y.Z` tag, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-amberelectric` and publishes
the GitHub Release.

Before the first release: add the GitHub topic `gladys-assistant-integration`, make the
repository public, and turn on **Private vulnerability reporting** (see
[`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0. Amber Electric is a trademark of its owner; this project is not affiliated with
Amber Electric.

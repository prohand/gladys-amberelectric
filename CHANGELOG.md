# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.2.0] - 2026-10-25

### Changed

- Gladys 5.3.0 or later is now required.
- Updated the Gladys SDK to 0.16.

### Added

- Catalog search keywords (AEMO, NEM, wholesale, spot price, feed-in tariff…) and the country
  served (Australia), so the integration is easier to find in the Gladys catalog.

## [1.1.1] - 2026-10-23

- Maintenance release, no functional change.

## [1.1.0] - 2026-10-21

- Maintenance release, no functional change.

## [1.0.1] - 2026-10-21

### Added

- Amber Electric integration, built on the official Gladys JavaScript template
  (SDK 0.15, Gladys 5.1 or later), tagged `cloud`.
- One device per Amber site: electricity price, wholesale spot price,
  controlled load and feed-in prices (in $/kWh, when the meter has those
  channels) and the renewable share of the grid.
- Prices read every 5 minutes by default, aligned on Amber's intervals, with
  one call per site; a rate limit pauses the reads until Amber allows them
  again.
- Scene triggers: the price level changes, a price spike is possible, starts or
  ends, exporting to the grid starts or stops paying.
- Scene actions: read the current price, find the cheapest time to run a load.
- "Amber prices" dashboard widget: price now, feed-in, renewables, price level,
  spike status, tariff period and the forecast chart.
- "Test the connection" button, listing the sites of the account.
- Documentation in English, French, German and Spanish.
- `SECURITY.md`, `CLAUDE.md`, and the CI, build, release and GitHub release
  workflows.

[Unreleased]: https://github.com/prohand/gladys-amberelectric/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/prohand/gladys-amberelectric/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/prohand/gladys-amberelectric/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/prohand/gladys-amberelectric/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/prohand/gladys-amberelectric/releases/tag/v1.0.1

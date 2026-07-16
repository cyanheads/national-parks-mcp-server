# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-07-16

nps_find_parks re-ranks query results so exact parkCode/name matches lead (NPS returns matches unranked), and nps_find_parks/nps_get_park now render their full activity and image lists in the text channel to match structuredContent — plus a new nps_get_park imagesTruncated flag disclosing the upstream 5-image cap.

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-07-16

Pagination-correctness fixes across the NPS list tools — full-set local filtering, a new nps_get_alerts start offset, consistent alert ordering across client surfaces, and no false all-clear on an empty page — plus framework maintenance (mcp-ts-core ^0.10.9 → ^0.10.14, Socket install scanner, js-yaml advisory cleared).

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-06-20

Framework maintenance — mcp-ts-core ^0.10.6 → ^0.10.9, dev-dependency refresh, re-synced devcheck scripts and skills. No tool or behavior changes.

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-06-15

Publish public hosted endpoint at https://national-parks.caseyjhand.com/mcp

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-06-13

Initial release — six NPS trip-planning tools (parks, alerts, campgrounds, things to do, events) over the NPS Data API.

# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-10-08

Adopts mcp-ts-core 0.13.14: tool error results carry a requestId, numeric and boolean strings and a lone string for a list are repaired before validation, error data no longer carries stack traces, request context, or rootCause, and the MCP Registry HTTP entry now starts the HTTP transport.

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-09-23 · ⚠️ Breaking

Campground amenities can now be null when NPS publishes no value, excluded park directions are omitted rather than null, and malformed park codes, state codes, and dates return -32007 with each tool's declared reason and recovery on every tool.

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-09-20 · ⚠️ Breaking · 🛡️ Security

Adopts mcp-ts-core 0.13.6: argument rejections return a structured InvalidParams envelope carrying a reason and recovery hint, tool error text closes with its reason and retryable terms, and upstream error data no longer carries the request URL — which for NPS holds the API key.

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-08-23

Adopts mcp-ts-core 0.12.3 and the MCP SDK v2 protocol surface, with explicit stateless HTTP serving, TypeScript 7 test typechecking, current framework tooling, and Bun 1.4 container builds.

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-07-16

nps_find_events adds window-intersected occurrenceDates and isRecurring so a recurring series no longer reads as its frozen anchor date; invalid parkCode/stateCode now return the tool's declared recovery hint (format checks moved into the handler across four tools), and impossible calendar dates are rejected client-side.

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

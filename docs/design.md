# national-parks-mcp-server — Design

Plan a national-park trip — parks, alerts, campgrounds, and things to do across 470+ US National Park Service sites. Wraps the [NPS Data API](https://www.nps.gov/subjects/developer/api-documentation.htm) (`developer.nps.gov/api/v1`), key via the `X-Api-Key` header.

> **Field shapes verified against the live API** (key provisioned and confirmed working). Per-record fields below reflect actual live responses — not Swagger assumptions. The build agent must still include at least one sparse-payload test per the framework checklist, but the required-vs-optional decisions are now grounded in real data.

---

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `nps_find_parks` | Resolve a place name, state, or free-text query to NPS parks — **the required first step**; returns `parkCode` (the spine the other tools key on) plus a trip-planning summary. US NPS sites only. | `query`, `stateCode`, `activity`, `limit`, `start` | `readOnlyHint: true`, `openWorldHint: true` |
| `nps_get_park` | Full trip-planning detail for one or more parks by `parkCode`: description, activities, fees & passes, season hours, contacts, directions, weather overview, images, NPS URL. | `parkCode` (1–10), `fields` | `readOnlyHint: true`, `openWorldHint: true` |
| `nps_get_alerts` | Current alerts for a park or state — closures, hazards, caution, information. The time-sensitive headline tool; surfaces category + recency prominently. | `parkCode`, `stateCode`, `category`, `query`, `limit` | `readOnlyHint: true`, `openWorldHint: true` |
| `nps_find_campgrounds` | Campgrounds at a park: amenities (hookups, potable water, showers, dump station), reservable vs. first-come site counts, reservation info, accessibility, fees. | `parkCode`, `stateCode`, `query`, `limit`, `start` | `readOnlyHint: true`, `openWorldHint: true` |
| `nps_get_activities` | Curated things to do and points of interest for a park: title, description, duration, accessibility, location, fee/pet/reservation flags, season. | `parkCode`, `query`, `limit`, `start` | `readOnlyHint: true`, `openWorldHint: true` |
| `nps_find_events` | Scheduled events at a park within a date range: title, description, dates/times, location, category, fee, registration/info URLs. | `parkCode`, `stateCode`, `dateStart`, `dateEnd`, `query`, `pageSize`, `pageNumber` | `readOnlyHint: true`, `openWorldHint: true` |

### Resources

None. Park/alert/campground records are point-in-time API reads with no stable, injectable identity that earns a resource URI, and every datum is reachable through the tool surface (tool-only clients lose nothing). `parkCode` is a natural key, but a `nps://park/{parkCode}` resource would only duplicate `nps_get_park` for the minority of clients that support resources — deferred. Revisit if a clear injectable-context use case appears.

### Prompts

None. The domain is data/action oriented; tool descriptions carry the parkCode-first workflow. (The idea's "plan my visit" moonshot — overview + alerts + campgrounds + activities + an NWS forecast for the coordinates — is a cross-server composition, not a single-server prompt; left to the calling agent / a future workflow tool.)

---

## Overview

The NPS Data API exposes one authoritative source (the US National Park Service) across many resource endpoints. This is a **multi-endpoint single-source** server: one service wrapping one API, with tools shaped around trip-planning workflows rather than 1:1 endpoint mirrors.

**Audience:** travelers, hikers, campers, road-trippers, and families — and the agents answering "what's there to do at Yosemite?", "is the road to the summit open?", "find campgrounds near me with hookups." The fleet has maps (`openstreetmap`) and weather (`nws-weather`, `open-meteo`) but nothing on parks and outdoor recreation; this fills that gap and composes with all three.

**Coverage boundary (state it in descriptions):** US NPS sites only — national parks, monuments, historic sites, seashores, etc. **Not** state parks, **not** Forest Service / BLM land. Agents must not expect non-NPS public land here. (Recreation.gov's RIDB is the adjacent cross-agency source — a possible future second source, out of scope now.)

### The parkCode spine

`parkCode` (e.g. `yose`, `grca`, `zion`) is the join key for the whole API. The workflow is **two-step and must be explicit in every relevant description**:

1. `nps_find_parks` resolves a name / state / query → `parkCode`(s) plus a summary.
2. `nps_get_park` / `nps_get_alerts` / `nps_find_campgrounds` / `nps_get_activities` / `nps_find_events` key on that `parkCode`.

`nps_get_alerts`, `nps_find_campgrounds`, and `nps_find_events` also accept `stateCode` for statewide queries without a parkCode (e.g. "is anything closed in Montana's parks?"), since the underlying endpoints support it.

---

## Requirements

- Read-only. No writes, no auth scopes (single-source public data; stdio + HTTP-none deployment).
- Auth to upstream: free NPS API key via the **`X-Api-Key` request header**. Config env var **`NPS_API_KEY`** (required — server fails to start without it).
- Base URL `https://developer.nps.gov/api/v1`, overridable via `NPS_BASE_URL`.
- `parkCode` resolution is the spine — `nps_find_parks` first, most tools key on the resulting code.
- `nps_get_alerts` surfaces alert **category** and **recency** prominently (closures/road conditions change daily).
- Park records are large and deeply nested — **trim to trip-planning essentials**, link `url` (the park's NPS page) for the rest.
- Capped-list tools disclose truncation via **optional** enrichment fields (`truncated`/`shown`/`cap`) + a required `totalCount` — never declare the truncation fields required (the framework only populates them when the cap is hit; required-but-absent throws -32007).
- Identity: display/title is the hyphenated machine name **`national-parks-mcp-server`** everywhere (`createApp` `title`, manifest `display_name`) — never Title Case.
- Rate limits are generous (NPS documents 1,000 req/hr per key); a light per-call retry on 5xx/429 is enough — no mirror, no DataCanvas (this is discovery/detail data, not analytical row sets).

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `nps` (`src/services/nps/nps-service.ts`) | NPS Data API (`developer.nps.gov/api/v1`), `X-Api-Key` header | all six tools |

One service, init/accessor pattern (`initNpsService(config)` in `createApp().setup`, `getNpsService()` at request time). Methods mirror the endpoints the tools need:

| Method | Endpoint | Notes |
|:-------|:---------|:------|
| `findParks(params, ctx)` | `GET /parks` | `q`, `stateCode`, `limit`, `start`; activity filter applied locally over the full matched set (see Decisions Log §7) |
| `getParks(parkCodes, fields, ctx)` | `GET /parks` | `parkCode` is comma-joined (array param) — **one batched call** for up to 10 codes, not N calls |
| `getAlerts(params, ctx)` | `GET /alerts` | `parkCode`, `stateCode`, `q`, `limit`, `start`; category filtered locally over the full matched set (see Decisions Log §4) |
| `findCampgrounds(params, ctx)` | `GET /campgrounds` | `parkCode`, `stateCode`, `q`, `limit`, `start` |
| `getThingsToDo(params, ctx)` | `GET /thingstodo` | `parkCode`, `stateCode`, `q`, `limit`, `start` (single-string params, not arrays — see Decisions Log §8) |
| `findEvents(params, ctx)` | `GET /events` | `parkCode`, `stateCode`, `dateStart`, `dateEnd`, `q`, `pageSize`, `pageNumber` (different envelope — see §6) |

**Resilience** (per framework `add-service` / `api-utils`):
- Each method wraps the **full** fetch+parse pipeline in `withRetry` from `/utils`. Base delay ~500ms (NPS is fast and rarely rate-limits); retry on 5xx/429/network only.
- Use `fetchWithTimeout` (non-OK → `ServiceUnavailable`) and `httpErrorFromResponse(response, { service: 'nps' })` to map the upstream status table (401/403 → key problems, 429 → rate limit with `Retry-After`, 5xx → transient).
- Detect the NPS error envelope explicitly: a `403` body of `{"error":{"code":"API_KEY_INVALID"|"API_KEY_MISSING",...}}` → a clear configuration-flavored `ServiceUnavailable`/`unauthorized` naming `NPS_API_KEY`, so a bad key fails loud and actionable rather than as a generic 403.
- The NPS envelope returns counts as **strings** (`total`, `limit`, `start` are `"470"` etc.) — the service coerces them to numbers before returning to handlers. `/events` uses a different envelope (`pagenumber`, `pagesize`, `total`, and an `errors` array — no top-level `dates`) — normalize it to the same internal shape. Each event record carries its own `dates[]` (all remaining occurrences from today through `recurrencedateend`, **independent of the requested window** — see Decisions Log §16); `normalizeEvent` intersects it with `[dateStart, dateEnd]` into `occurrenceDates` and coerces `isrecurring` into `isRecurring`.
- **Pervasive string-type fields** — the NPS API returns many numeric and boolean fields as strings: `latitude`/`longitude` (parks, campgrounds, thingstodo), site counts (`numberOfSitesReservable`, `numberOfSitesFirstComeFirstServe`, `campsites.totalSites`), and boolean-flavored fields (`isReservationRequired`, `arePetsPermitted`, `isfree`, `isallday`, `rvAllowed` in accessibility). The service layer coerces all of these: numbers via `parseFloat`/`parseInt` (empty string → `null`); booleans via `=== 'true'` or `=== '1'`. Empty-string normalization to `null` also applies to `url` in alerts and string fields in events (`feeinfo`, `regresurl`, `infourl`).
- **Field extraction quirks**: Activities in parks (`activities`, `topics`) are arrays of `{id, name}` objects — extract `.name`. The `/thingstodo` endpoint has no top-level `parkCode` — extract from `relatedParks[0].parkCode`. The `/events` endpoint uses `sitecode` (not `parkCode`) for the park identifier. Alert `lastIndexedDate` format is `"YYYY-MM-DD 00:00:00.0"` — strip to `"YYYY-MM-DD"`. Campground `totalSites` is in the nested `campsites.totalSites` object, not top-level.

---

## Config

`src/config/server-config.ts` — own Zod schema, lazy-parsed via `parseEnvConfig` (maps schema paths → env var names so errors name `NPS_API_KEY`, not `apiKey`).

| Env Var | Required | Default | Description |
|:--------|:---------|:--------|:------------|
| `NPS_API_KEY` | **Yes** | — | NPS Data API key (`X-Api-Key` header). Free instant signup at nps.gov/subjects/developer/get-started.htm. Server fails to start without it. |
| `NPS_BASE_URL` | No | `https://developer.nps.gov/api/v1` | API base URL override (testing / proxy). |

```ts
// src/config/server-config.ts
import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z
    .string()
    .min(1)
    .describe(
      'NPS Data API key, sent as the X-Api-Key header. Free instant signup at https://www.nps.gov/subjects/developer/get-started.htm. Required — server fails to start without it.',
    ),
  baseUrl: z
    .string()
    .default('https://developer.nps.gov/api/v1')
    .describe('NPS Data API base URL.'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;
export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'NPS_API_KEY',
    baseUrl: 'NPS_BASE_URL',
  });
  return _config;
}
```

**Packaging:** add `NPS_API_KEY` to both `server.json` (`environmentVariables[]`) and `manifest.json` (`mcp_config.env` + `user_config`) — `lint:packaging` (run by `devcheck`) verifies the names match. Mirror into `.codex-plugin/mcp.json` and `.claude-plugin/plugin.json` env blocks. Add `NPS_API_KEY` to `.env.example` (currently absent).

---

## Tools (full detail)

> Conventions for all tools: `import { tool, z } from '@cyanheads/mcp-ts-core'` and `import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors'`. Every field `.describe()`d. JSON-Schema-serializable types only (no `z.date()` — ISO dates are `z.string()`). Handlers are pure and throw; the service layer does the fetching. Result-set context (counts, applied-filter echo, empty-result notices, truncation) goes through `ctx.enrich(...)`, **not** the `output` schema. `format()` renders every `output` field (parity is lint-enforced).

### `nps_find_parks`

**Purpose:** The entry point. Resolve a place name, state, or free-text query into NPS parks, returning `parkCode` (the spine) plus a compact trip-planning summary so the agent can pick a park and chain into the detail tools. US NPS sites only.

**Endpoint:** `GET /parks` with `q`, `stateCode`, `limit`, `start`. (`activity` is filtered locally over the full matched set — see Decisions Log §7. `query` results are re-ranked locally so exact code/name matches lead before the page is sliced — see Decisions Log §14.)

```ts
input: z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Free-text search across park names and descriptions (e.g. "yosemite", "civil war", "redwood"). Upstream full-text search. Omit to browse by state. At least one of query or stateCode is recommended; with neither, returns the first page of all ~470 NPS sites.',
    ),
  stateCode: z
    .string()
    .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
    .optional()
    .describe(
      'Two-letter US state/territory code, or comma-separated list (e.g. "CA", "WY,MT,ID"). Filters to parks located in those states. Combine with query to narrow.',
    ),
  activity: z
    .string()
    .optional()
    .describe(
      'Filter to parks offering an activity, matched against each park\'s activities list (e.g. "hiking", "camping", "stargazing"). Case-insensitive substring match applied locally (the API has no activity param) across every site matching query/stateCode, then paginated with start/limit — so totalCount is the true count of matching parks, not a per-page tally. Use nps_get_park to see a park\'s full activity list.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum parks to return (1–50). The full set is ~470 sites; narrow with query/stateCode rather than paging through everything.'),
  start: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based offset for pagination within the matched set. Use with limit to page through results.'),
}),
```

**Output** (trimmed park summary — the detail-heavy fields live in `nps_get_park`):

```ts
output: z.object({
  parks: z
    .array(
      z.object({
        parkCode: z.string().describe('Park code — the key for nps_get_park, nps_get_alerts, nps_find_campgrounds, nps_get_activities, nps_find_events (e.g. "yose").'),
        fullName: z.string().describe('Full official name (e.g. "Yosemite National Park").'),
        designation: z.string().describe('Site type (e.g. "National Park", "National Monument", "National Historic Site"). Empty string for sites without a designation.'),
        states: z.string().describe('Comma-separated state codes the park spans (e.g. "CA", "WY,MT,ID").'),
        description: z.string().describe('Short park description.'),
        latitude: z.number().nullable().describe('Center latitude (decimal degrees), or null if the park record has no coordinates. The NPS API returns this as a string — the service coerces to float (empty string → null). Feed to nws-weather / open-meteo for a forecast.'),
        longitude: z.number().nullable().describe('Center longitude (decimal degrees), or null if absent. Same string→float coercion as latitude.'),
        activities: z.array(z.string()).describe('Activity names available at the park (e.g. "Hiking", "Camping"). NPS returns activities as [{id, name}] objects — the service extracts the name strings. May be empty.'),
        entranceFee: z.string().nullable().describe('Lowest standard entrance fee as a dollar string (e.g. "35.00"), or null if the park is fee-free or lists no fee. Derived by the service from `entranceFees[0].cost` (the first fee entry, typically the per-vehicle fee). Full fee/pass breakdown is in nps_get_park.'),
        url: z.string().describe('Park\'s official NPS.gov page — the source for everything trimmed from this summary.'),
      }),
    )
    .describe('Matching parks, each carrying the parkCode needed to chain into the detail tools.'),
}),
```

**Enrichment** (counts + applied-filter echo + empty-result guidance; reaches both client surfaces):

```ts
enrichment: {
  totalCount: z.number().describe('Total parks matching the query/state filter before the limit was applied (from the API envelope total).'),
  shown: z.number().optional().describe('Number of parks returned in this response (populated when the result set was capped by limit).'),
  cap: z.number().optional().describe('The limit applied to this response (populated when results were truncated).'),
  appliedFilters: z.string().describe('Echo of the filters as the server applied them (query / stateCode / activity), so the agent can see what was searched.'),
  notice: z.string().optional().describe('Guidance when no parks matched — suggests broadening the query, checking the state code, or dropping the activity filter.'),
},
enrichmentTrailer: {
  totalCount: { label: 'Total Matches' },
  shown: { label: 'Shown' },
  cap: { label: 'Limit' },
  appliedFilters: { label: 'Filters' },
},
```
- `ctx.enrich.total(totalCount)` for the required total; `ctx.enrich.truncated({ shown, cap })` **only when** the matched total exceeds the returned count (this is what keeps `shown`/`cap` optional-and-unset on full results, avoiding -32007).
- Empty result → `ctx.enrich.notice("No NPS sites matched <filters>. Broaden the query, verify the two-letter state code, or drop the activity filter. Coverage is US NPS sites only — not state parks or Forest Service / BLM land.")`.

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_state_code` | `ValidationError` | A `stateCode` token is not two letters | `Provide two-letter US state/territory codes, comma-separated (e.g. "CA" or "WY,MT,ID").` |

Empty matches are **not** an error — return `parks: []` + the notice. (Upstream key/5xx failures bubble from the service as baseline `ServiceUnavailable`.)

**`format()`:** `## N parks` heading, then per park a block — `### {fullName}` · `**parkCode:** {parkCode} | **{designation}** | **States:** {states}` · description · `**Activities:** …` (the full list — text and structured must agree, see Decisions Log §15) · `**Entrance fee:** ${entranceFee}` or "Fee-free / see park page" · `**Coordinates:** {lat}, {lon}` when present · `[NPS page]({url})`. Empty → a line pointing at the enrichment notice.

---

### `nps_get_park`

**Purpose:** The trip-planning hub. Full (but trimmed) detail for one or more parks by `parkCode` — description, activities/topics, fees & passes, season hours, contacts, directions, weather overview, images, and the NPS URL for everything else. Accepts up to 10 codes in **one** batched upstream call.

**Endpoint:** `GET /parks?parkCode=<comma-joined>`. (`parkCode` is an array param upstream — comma-join for a single request; see Decisions Log §3.)

```ts
input: z.object({
  parkCode: z
    .array(z.string().regex(/^[a-z]{4}$/))
    .min(1)
    .max(10)
    .describe(
      'One to ten park codes (each a 4-letter lowercase code like "yose", "grca", "zion"). Get codes from nps_find_parks. Multiple codes are fetched in a single request.',
    ),
  fields: z
    .array(z.enum(['activities', 'topics', 'fees', 'hours', 'contacts', 'directions', 'images']))
    .optional()
    .describe(
      'Optional detail sections to include beyond the always-present core (name, designation, states, description, coordinates, weather, url). Omit for all sections. Narrow to reduce payload when you only need, say, hours and fees.',
    ),
}),
```

**Output** (one entry per requested code; deeply-nested NPS fields flattened to trip-planning essentials):

```ts
output: z.object({
  parks: z
    .array(
      z.object({
        parkCode: z.string().describe('Park code (echoes the request).'),
        fullName: z.string().describe('Full official park name.'),
        designation: z.string().describe('Site type (e.g. "National Park"). Empty string if none.'),
        states: z.string().describe('Comma-separated state codes the park spans.'),
        description: z.string().describe('Full park description.'),
        latitude: z.number().nullable().describe('Center latitude (decimal degrees) or null. NPS returns as string — service coerces (empty string → null).'),
        longitude: z.number().nullable().describe('Center longitude (decimal degrees) or null. Same coercion as latitude.'),
        weatherOverview: z.string().nullable().describe('NPS free-text weather/seasonal overview for the park (the `weatherInfo` field), or null. For an actual forecast, feed the coordinates to nws-weather or open-meteo.'),
        directionsInfo: z.string().nullable().describe('Free-text driving/access directions, or null.'),
        directionsUrl: z.string().nullable().describe('NPS directions page URL, or null.'),
        url: z.string().describe('Park\'s official NPS.gov page.'),
        activities: z.array(z.string()).optional().describe('Activity names (included unless fields excludes "activities"). NPS returns [{id, name}] objects — service extracts the name strings.'),
        topics: z.array(z.string()).optional().describe('Topic names — what the park is about, e.g. "Volcanoes", "Civil War" (included unless fields excludes "topics"). Same {id, name} → name extraction as activities.'),
        entranceFees: z
          .array(z.object({
            cost: z.string().describe('Fee amount as a dollar string (e.g. "35.00"). "0.00" means no charge for that category.'),
            title: z.string().describe('Fee title (e.g. "Entrance - Private Vehicle").'),
            description: z.string().describe('What the fee covers and for how long.'),
          }))
          .optional()
          .describe('Entrance fees by category (included unless fields excludes "fees"). Empty array means the park lists no entrance fee.'),
        entrancePasses: z
          .array(z.object({
            cost: z.string().describe('Pass cost as a dollar string.'),
            title: z.string().describe('Pass title (e.g. "Yosemite Annual Pass").'),
            description: z.string().describe('Pass coverage and validity.'),
          }))
          .optional()
          .describe('Annual/park-specific passes (included unless fields excludes "fees"). May be empty.'),
        operatingHours: z
          .array(z.object({
            name: z.string().describe('Schedule name (e.g. "Yosemite Valley").'),
            description: z.string().describe('Free-text hours/seasonality notes.'),
            standardHours: z.object({
              monday: z.string().describe('Monday hours (e.g. "All Day", "Closed", "9:00AM - 5:00PM").'),
              tuesday: z.string().describe('Tuesday hours.'),
              wednesday: z.string().describe('Wednesday hours.'),
              thursday: z.string().describe('Thursday hours.'),
              friday: z.string().describe('Friday hours.'),
              saturday: z.string().describe('Saturday hours.'),
              sunday: z.string().describe('Sunday hours.'),
            }).describe('Per-weekday operating hours. Values are free-text strings from NPS.'),
          }))
          .optional()
          .describe('Operating hours by area/season (included unless fields excludes "hours"). May be empty.'),
        contacts: z
          .object({
            phoneNumbers: z.array(z.object({
              phoneNumber: z.string().describe('The number.'),
              type: z.string().describe('Type (e.g. "Voice", "Fax").'),
            })).describe('Phone contacts. May be empty.'),
            emailAddresses: z.array(z.object({
              emailAddress: z.string().describe('The email address.'),
            })).describe('Email contacts. May be empty.'),
          })
          .optional()
          .describe('Park contact info (included unless fields excludes "contacts").'),
        images: z
          .array(z.object({
            url: z.string().describe('Image URL.'),
            altText: z.string().describe('Alt text / caption.'),
            title: z.string().describe('Image title.'),
          }))
          .optional()
          .describe('Representative park images (included unless fields excludes "images"). Capped at 5 by the service; imagesTruncated flags when the park has more. May be empty.'),
        imagesTruncated: z.boolean().optional().describe('True when the upstream image list exceeded the 5-item cap — the park url has the rest. Present only when the images section is included. See Decisions Log §15.'),
      }),
    )
    .describe('Requested parks with trip-planning detail.'),
}),
```

**Enrichment:**

```ts
enrichment: {
  requestedCount: z.number().describe('Number of park codes requested.'),
  returnedCount: z.number().describe('Number of parks the API returned.'),
  missingCodes: z.array(z.string()).optional().describe('Requested park codes the API returned no record for — likely invalid/misspelled codes. Populated only when some codes did not resolve.'),
  notice: z.string().optional().describe('Guidance when one or more codes did not resolve, or when none did.'),
},
enrichmentTrailer: {
  requestedCount: { label: 'Requested' },
  returnedCount: { label: 'Returned' },
  missingCodes: { label: 'Unresolved codes', render: (v) => (v as string[]).join(', ') },
},
```
- Cross-reference returned `parkCode`s against the request; any requested-but-absent → `missingCodes` + a notice ("Codes not found: …. Verify with nps_find_parks — codes are 4-letter lowercase like \"yose\".").

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `no_parks_found` | `NotFound` | The API returned zero records for every requested code | `None of the requested park codes resolved. Use nps_find_parks to look up the correct 4-letter code (e.g. "grca" for Grand Canyon).` |

Partial resolution (some codes hit, some miss) is **not** an error — return what resolved + `missingCodes`. Only a fully-empty result throws `no_parks_found`.

**`format()`:** per park — `# {fullName} ({parkCode})` · `**{designation}** · States: {states}` · description · activities/topics chips · fees table (title · cost · description) · passes · hours blocks · contacts · `**Directions:** {directionsInfo}` + link · `**Weather:** {weatherOverview}` · **every returned image** (not just the first) under an `**Images:**` list, plus the `imagesTruncated` disclosure line when set · `[Full park page]({url})`. Render every output field present (see Decisions Log §15).

---

### `nps_get_alerts`

**Purpose:** The time-sensitive headline tool. Current alerts for a park (or a whole state) — closures, hazards, caution, information — with **category and recency surfaced prominently** so "is anything closed at Glacier right now?" is answered at a glance. Returns most-recent-first.

**Endpoint:** `GET /alerts` with `parkCode`, `stateCode`, `q`, `limit`, `start`. (`category` filtered locally over the full matched set — see Decisions Log §4.)

```ts
input: z.object({
  parkCode: z
    .string()
    .regex(/^[a-z]{4}(,[a-z]{4})*$/)
    .optional()
    .describe('Park code, or comma-separated list (e.g. "glac", "yose,zion"). Get codes from nps_find_parks. Provide parkCode or stateCode; with neither, returns recent alerts service-wide.'),
  stateCode: z
    .string()
    .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
    .optional()
    .describe('Two-letter state code, or comma-separated list (e.g. "MT", "WY,MT,ID"). Returns alerts for all NPS sites in those states — use when you want a statewide "what\'s closed" sweep rather than one park.'),
  category: z
    .enum(['Danger', 'Caution', 'Information', 'Park Closure'])
    .optional()
    .describe('Filter to one alert category. "Danger" and "Park Closure" are the high-priority ones for trip safety. Applied locally (the API has no category param) across every alert matching parkCode/stateCode/query, then paginated with start/limit — so totalCount is the true count of matching alerts, not a per-page tally. Omit to see all categories (the default — closures and hazards should not be missed). Live categories observed: Danger, Caution, Information, Park Closure.'),
  query: z
    .string()
    .optional()
    .describe('Free-text search within alert titles/descriptions (e.g. "road", "wildfire", "trail"). Upstream full-text filter.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Maximum alerts to return (1–50), most-recent first.'),
  start: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based offset for pagination within the matched set. Use with limit to page through results — when totalCount exceeds what was returned, re-request with start advanced by limit.'),
}),
```

**Output:**

```ts
output: z.object({
  alerts: z
    .array(
      z.object({
        id: z.string().describe('Alert ID.'),
        parkCode: z.string().describe('Park code the alert belongs to — useful when querying by state across multiple parks.'),
        category: z.string().describe('Alert category: "Danger", "Park Closure", "Caution", or "Information". Treat Danger and Park Closure as trip-affecting.'),
        title: z.string().describe('Short alert headline (e.g. "Tioga Road Closed for the Season").'),
        description: z.string().describe('Full alert text — what is affected and any guidance.'),
        url: z.string().nullable().describe('Link to more detail on NPS.gov, or null. NPS returns empty string "" when absent — service normalizes to null.'),
        lastIndexedDate: z.string().nullable().describe('When NPS last updated/indexed this alert, or null. Format from the API is "YYYY-MM-DD 00:00:00.0" (space-delimited, with fractional seconds suffix) — service may strip to "YYYY-MM-DD" for readability. The recency signal — a stale date may mean the condition has changed; verify against the park page.'),
      }),
    )
    .describe('Current alerts, sorted most-recent first by lastIndexedDate. An empty array with totalCount 0 means no active alerts — good news, not an error; with a non-zero totalCount it means start paged past the end of the matches. The notice says which.'),
}),
```

**Enrichment** (category breakdown is the high-signal extra here):

```ts
enrichment: {
  totalCount: z.number().describe('Total alerts matching the filter before the limit was applied.'),
  shown: z.number().optional().describe('Alerts returned in this response (populated when capped by limit).'),
  cap: z.number().optional().describe('Limit applied (populated when results were truncated).'),
  categoryBreakdown: z.string().describe('Count of returned alerts per category (e.g. "Closure: 3, Caution: 1, Information: 2") — lets the agent gauge severity without scanning every alert.'),
  appliedFilters: z.string().describe('Echo of parkCode/stateCode/category/query as applied.'),
  notice: z.string().optional().describe('Message when the page is empty — states which case it is: good news (totalCount 0, the park reports nothing closed/hazardous right now) or a paging artifact (start ran past the end of a non-empty matched set).'),
},
enrichmentTrailer: {
  totalCount: { label: 'Total Alerts' },
  shown: { label: 'Shown' },
  cap: { label: 'Limit' },
  categoryBreakdown: { label: 'By category' },
  appliedFilters: { label: 'Filters' },
},
```
- Sort by `lastIndexedDate` desc in the handler before filtering/slicing (the API does not guarantee order). That sort is the tool's single ordering contract — `format()` renders the handler's order as-is.
- Empty page, branching on `total` — `total === 0` → `ctx.enrich.notice("No active alerts for <filters>. The park currently reports nothing closed or hazardous. Closures and road conditions change daily — re-check before departure.")`; `total > 0` → a paging-artifact notice naming `start=0` as the way back. `format()` asserts neither (it never sees `totalCount`) and points at the notice instead.
- `ctx.enrich.truncated()` writes a `notice` internally (last-wins), so the handler collects every notice fragment (best-effort-scan caveat, empty-result guidance, next-page pointer) and emits exactly one — via `truncated({ guidance })` when a page follows, else `notice()`.

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_park_code` | `ValidationError` | A `parkCode` token isn't 4 lowercase letters | `Provide 4-letter lowercase park codes (e.g. "glac"), comma-separated. Look them up with nps_find_parks.` |
| `invalid_state_code` | `ValidationError` | A `stateCode` token isn't two letters | `Provide two-letter state codes (e.g. "MT"), comma-separated.` |

Empty results are never an error.

**`format()`:** `## N active alerts` (or "No alerts in this response. See the notice for what this means." — `format()` receives only the domain payload, never `totalCount`, so it defers the all-clear-vs-paging-artifact call to the notice instead of guessing). Renders `alerts` in the handler's order (most-recent-first) — **no re-sort**, so `content[]` and `structuredContent` clients read the same order; per alert — `### [{category}] {title}` · `**Park:** {parkCode} | **Updated:** {lastIndexedDate}` · description · `[Details]({url})` when present (url is null when empty). Category and recency lead every entry, so severity stays scannable without reordering the list.

---

### `nps_find_campgrounds`

**Purpose:** Campgrounds at a park: amenities (hookups, potable water, showers, dump station), reservable vs. first-come site counts, reservation info, accessibility, and fees — answering "where can I camp at Zion, and can I get an RV hookup?"

**Endpoint:** `GET /campgrounds` with `parkCode`, `stateCode`, `q`, `limit`, `start`.

```ts
input: z.object({
  parkCode: z
    .string()
    .regex(/^[a-z]{4}(,[a-z]{4})*$/)
    .optional()
    .describe('Park code, or comma-separated list (e.g. "zion"). Get codes from nps_find_parks. Provide parkCode or stateCode.'),
  stateCode: z
    .string()
    .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
    .optional()
    .describe('Two-letter state code, or comma-separated list. Returns campgrounds across all NPS sites in those states.'),
  query: z
    .string()
    .optional()
    .describe('Free-text search across campground names/descriptions (e.g. "river", "group", "rv"). Upstream full-text filter.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15)
    .describe('Maximum campgrounds to return (1–50).'),
  start: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based pagination offset.'),
}),
```

**Output** (amenities flattened to the booleans/counts a camper actually filters on):

```ts
output: z.object({
  campgrounds: z
    .array(
      z.object({
        id: z.string().describe('Campground ID.'),
        name: z.string().describe('Campground name (e.g. "Watchman Campground").'),
        parkCode: z.string().describe('Park code the campground belongs to.'),
        description: z.string().describe('Short campground description.'),
        latitude: z.number().nullable().describe('Latitude (decimal degrees) or null. NPS returns as string — service coerces (empty string → null).'),
        longitude: z.number().nullable().describe('Longitude (decimal degrees) or null. Same coercion as latitude.'),
        totalSites: z.number().nullable().describe('Total number of campsites, or null if unspecified. Sourced from the `campsites.totalSites` nested object (NPS returns as string — service coerces to number; empty string → null). Not a top-level field.'),
        reservableSites: z.number().nullable().describe('Number of reservable sites (from top-level `numberOfSitesReservable`, returned as string — service coerces to number), or null. 0 means first-come-first-served only.'),
        firstComeSites: z.number().nullable().describe('Number of first-come-first-served sites (from top-level `numberOfSitesFirstComeFirstServe`, returned as string — service coerces), or null.'),
        reservationInfo: z.string().nullable().describe('Free-text reservation guidance (how/where to book), or null.'),
        reservationUrl: z.string().nullable().describe('Booking URL (often recreation.gov), or null.'),
        fee: z.string().nullable().describe('Lowest campground fee as a dollar string (e.g. "30.00"), or null if free / unspecified.'),
        amenities: z.object({
          potableWater: z.boolean().describe('Drinking water available on site.'),
          showers: z.boolean().describe('Showers available.'),
          dumpStation: z.boolean().describe('RV dump station available.'),
          rvAllowed: z.boolean().describe('RVs permitted (from accessibility.rvAllowed — "1" → true, "0" → false).'),
          toilets: z.boolean().describe('Toilets (flush or vault) available.'),
          trashCollection: z.boolean().describe('Trash/recycling collection on site.'),
        }).describe('Key amenities as booleans. NPS amenities fields are mixed types: `potableWater`, `showers`, and `toilets` are arrays (e.g. ["Yes - seasonal", "None"]) — normalize: any element starting with "Yes" → true. `dumpStation` and `trashRecyclingCollection` are strings ("Yes"/"No"/"Yes - seasonal") — normalize to bool. `rvAllowed` lives in the `accessibility` object as "1"/"0". The campground\'s NPS page has the full amenity list.'),
        accessibility: z.string().nullable().describe('Free-text accessibility summary from `accessibility.adaInfo`, or null if absent/empty. The `accessibility` field is a dict object — service extracts `adaInfo` as the primary human-readable summary.'),
        url: z.string().nullable().describe('Campground\'s NPS.gov page, or null — the source for the full amenity/site detail trimmed here.'),
      }),
    )
    .describe('Campgrounds at the requested park(s)/state(s).'),
}),
```

**Enrichment:** `totalCount` (required), `shown`/`cap` (optional, on truncation), `appliedFilters`, `notice` (empty-result guidance: "No campgrounds found for <filters>. The park may have no NPS-managed campgrounds, or try a broader state query. Some parks list lodging/backcountry permits instead — see the park page via nps_get_park."). Same `ctx.enrich.total` + `ctx.enrich.truncated` discipline.

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_park_code` | `ValidationError` | A `parkCode` token isn't 4 lowercase letters | `Provide 4-letter lowercase park codes (e.g. "zion"), comma-separated. Look them up with nps_find_parks.` |
| `invalid_state_code` | `ValidationError` | A `stateCode` token isn't two letters | `Provide two-letter state codes, comma-separated.` |

**`format()`:** per campground — `### {name}` · `**Sites:** {totalSites} ({reservableSites} reservable, {firstComeSites} first-come)` · amenity chips for the true booleans (e.g. "Potable water · Showers · RV hookups") · `**Fee:** ${fee}` · `**Reservations:** {reservationInfo}` + `[Book]({reservationUrl})` · `**Accessibility:** …` · `[Campground page]({url})`. Surface the reservable/first-come split and the hookup/water amenities prominently.

---

### `nps_get_activities`

**Purpose:** Curated things to do and points of interest at a park — title, description, duration, accessibility, location, and fee/pet/reservation flags — answering "what should I do at Acadia?" Backed by `/thingstodo` (NPS's editorially-curated activity list, distinct from the park's raw activity tags).

**Endpoint:** `GET /thingstodo` with `parkCode`, `stateCode`, `q`, `limit`, `start`. (Note: this endpoint takes **single-string** `parkCode`/`stateCode`, not arrays — see Decisions Log §8.)

```ts
input: z.object({
  parkCode: z
    .string()
    .regex(/^[a-z]{4}$/)
    .optional()
    .describe('A single 4-letter lowercase park code (e.g. "acad"). Get it from nps_find_parks. This endpoint takes one park code (not a list). Provide parkCode or stateCode.'),
  stateCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional()
    .describe('A single two-letter state code (e.g. "ME"). Returns curated activities across NPS sites in that state.'),
  query: z
    .string()
    .optional()
    .describe('Free-text search across activity titles/descriptions (e.g. "sunrise", "hike", "tour"). Upstream full-text filter.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15)
    .describe('Maximum activities to return (1–50).'),
  start: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based pagination offset.'),
}),
```

**Output:**

```ts
output: z.object({
  activities: z
    .array(
      z.object({
        id: z.string().describe('Activity ID.'),
        title: z.string().describe('Activity title (e.g. "Watch the Sunrise from Cadillac Mountain").'),
        parkCode: z.string().nullable().describe('Park code the activity belongs to, extracted from `relatedParks[0].parkCode`, or null if relatedParks is empty. The /thingstodo endpoint does not include a top-level parkCode field.'),
        shortDescription: z.string().describe('Concise description of the activity.'),
        location: z.string().nullable().describe('Where in the park this happens (free text), or null/empty.'),
        latitude: z.number().nullable().describe('Activity latitude (decimal degrees) or null. NPS returns as string — service coerces (empty string → null).'),
        longitude: z.number().nullable().describe('Activity longitude (decimal degrees) or null. Same coercion as latitude.'),
        duration: z.string().nullable().describe('Time commitment from the `duration` field (e.g. "1-3 Hours"), or null/empty. Note: the API also has a `durationDescription` field but it is frequently empty; `duration` carries the actual value.'),
        reservationRequired: z.boolean().describe('Whether a reservation is required. NPS returns `isReservationRequired` as the string "true"/"false" — service coerces to boolean.'),
        feeDescription: z.string().nullable().describe('Fee info if any (free text from `feeDescription`), or null. May contain HTML links — service strips HTML. Absence does not guarantee free — check the park page.'),
        petsPermitted: z.boolean().describe('Whether pets are permitted. NPS returns `arePetsPermitted` as the string "true"/"false" — service coerces to boolean.'),
        accessibility: z.string().nullable().describe('Accessibility information (`accessibilityInformation` field, free text), or null/empty.'),
        season: z.array(z.string()).describe('Seasons when the activity is available (e.g. ["Summer", "Fall"]). May be empty.'),
        url: z.string().nullable().describe('Activity\'s NPS.gov page, or null/empty — service normalizes empty string to null.'),
      }),
    )
    .describe('Curated activities and points of interest for the requested park/state.'),
}),
```

**Enrichment:** `totalCount` (required), `shown`/`cap` (optional, on truncation), `appliedFilters`, `notice` ("No curated activities found for <filters>. Not every park has a curated things-to-do list — try nps_get_park for the park\'s activity tags and description."). Same total/truncation discipline.

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `missing_filter` | `ValidationError` | Neither `parkCode` nor `stateCode` provided | `Provide a parkCode (e.g. "acad") or stateCode (e.g. "ME"). This endpoint requires at least one location filter.` |

(`/thingstodo` returns a large undifferentiated list with no filter; require one to keep results meaningful. parkCode/stateCode format is enforced by the regex at the schema edge.)

**`format()`:** per activity — `### {title}` · `**Duration:** {duration} | **Season:** {season}` · shortDescription · `**Location:** {location}` · flags line ("Reservation required · Pets OK · Fee: {feeDescription}") · `**Accessibility:** …` · `[Details]({url})`.

---

### `nps_find_events`

**Purpose:** Scheduled events at a park within a date range — ranger programs, festivals, tours, interpretive events — answering "what's happening at Yellowstone this weekend?" with title, dates/times, location, category, fee, and registration links.

**Endpoint:** `GET /events` with `parkCode`, `stateCode`, `dateStart`, `dateEnd`, `q`, `pageSize`, `pageNumber`. **Different envelope** from the other endpoints (`dates`, `pagenumber`, `pagesize`, `errors[]`) and an event record with **lowercased field names** — see Decisions Log §6.

```ts
input: z.object({
  parkCode: z
    .string()
    .regex(/^[a-z]{4}(,[a-z]{4})*$/)
    .optional()
    .describe('Park code, or comma-separated list (e.g. "yell"). Get codes from nps_find_parks. Provide parkCode or stateCode.'),
  stateCode: z
    .string()
    .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
    .optional()
    .describe('Two-letter state code, or comma-separated list. Returns events across NPS sites in those states.'),
  dateStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Start of the date window (YYYY-MM-DD). Combine with dateEnd to bound the search (e.g. a weekend). Omit for upcoming events from today.'),
  dateEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('End of the date window (YYYY-MM-DD). Use with dateStart.'),
  query: z
    .string()
    .optional()
    .describe('Free-text search across event titles/descriptions (e.g. "ranger", "astronomy", "guided"). Upstream full-text filter.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15)
    .describe('Maximum events to return per page (1–50). The events endpoint paginates by page number, not offset.'),
  pageNumber: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('1-based page number (events uses pageNumber/pageSize, not start/limit). Increment to page through results.'),
}),
```

**Output:**

```ts
output: z.object({
  events: z
    .array(
      z.object({
        id: z.string().describe('Event ID (from the `id` field, which is a UUID-like string; also available as `eventid`).'),
        title: z.string().describe('Event title.'),
        parkCode: z.string().nullable().describe('Park code the event belongs to. Sourced from the `sitecode` field — NPS event records do NOT have a `parkCode` field; `sitecode` carries the 4-letter park code. Null if absent.'),
        description: z.string().describe('Event description (HTML stripped to plain text in the handler — NPS event descriptions contain HTML markup).'),
        location: z.string().nullable().describe('Event location within the park (free text), or null/empty — service normalizes empty to null.'),
        dateStart: z.string().nullable().describe('Event start date (YYYY-MM-DD, from `datestart`), or null. For a recurring event this is the series anchor, which can predate the requested window — use occurrenceDates.'),
        dateEnd: z.string().nullable().describe('Event end date (YYYY-MM-DD, from `dateend`), or null. For a recurring event this is the anchor, not the last occurrence.'),
        occurrenceDates: z.array(z.string()).describe('Occurrence dates (YYYY-MM-DD) intersected with the requested dateStart/dateEnd window (all remaining occurrences when no window is requested). NPS returns each record\'s `dates[]` independent of the query window — see Decisions Log §16.'),
        isRecurring: z.boolean().describe('True for a recurring series, coerced from the `isrecurring` string. Explains a single frozen dateStart/dateEnd against a months-long occurrenceDates list.'),
        times: z.array(z.object({
          timeStart: z.string().describe('Start time (e.g. "02:00 PM").'),
          timeEnd: z.string().describe('End time (e.g. "02:30 PM").'),
        })).describe('Scheduled time slots for the event. Each entry also has `sunrisestart`/`sunsetend` string flags (ignored in output). May be empty (all-day or unspecified).'),
        category: z.string().nullable().describe('Event category (e.g. "Regular Event", "Ranger Programs"), or null. Sourced from the `category` field (not `categoryid`).'),
        isFree: z.boolean().describe('Whether the event is free. NPS returns `isfree` as the string "true"/"false" — service coerces to boolean.'),
        feeInfo: z.string().nullable().describe('Fee details when not free (`feeinfo`, free text), or null/empty — service normalizes empty to null.'),
        registrationUrl: z.string().nullable().describe('Registration/reservation URL (`regresurl`), or null/empty — service normalizes empty to null.'),
        infoUrl: z.string().nullable().describe('More-info URL (`infourl`), or null/empty — service normalizes empty to null.'),
      }),
    )
    .describe('Events matching the park/state and date window.'),
}),
```

**Enrichment:** `totalCount` (required — from the envelope `total`), `shown`/`cap` (optional, on truncation), `appliedFilters` (incl. the date window echo), `notice` (empty-result: "No events found for <filters> in <date window>. Widen the date range, drop the query filter, or check the park calendar via the park page. The events feed is sparser than alerts/campgrounds."). The events envelope can carry an `errors[]` array even on 200 — if non-empty, fold a warning into the notice rather than throwing.

**Errors:**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_date` | `ValidationError` | `dateStart`/`dateEnd` not `YYYY-MM-DD`, not a real calendar date (e.g. `2026-02-31`), or `dateEnd` < `dateStart` | `Provide dates as real YYYY-MM-DD calendar dates with dateEnd on or after dateStart (e.g. dateStart "2026-07-04", dateEnd "2026-07-06").` |
| `invalid_park_code` | `ValidationError` | A `parkCode` token isn't 4 lowercase letters | `Provide 4-letter lowercase park codes (e.g. "yell"), comma-separated. Look them up with nps_find_parks.` |
| `invalid_state_code` | `ValidationError` | A `stateCode` token isn't two letters | `Provide two-letter state codes (e.g. "WY"), comma-separated.` |

**`format()`:** per event — `### {title}` · `**When:** {dateStart}–{dateEnd}, {times}` · `**Where:** {location}` · `**Category:** {category}` · description · `**Fee:** Free` / `{feeInfo}` · `[Register]({registrationUrl})` · `[Info]({infoUrl})`. Lead with the date/time so weekend-planning is scannable.

---

## Workflow Analysis

No single tool makes ≥3 upstream calls — this is a flat multi-endpoint surface, not an orchestration. The **agent-level** chain is the workflow, and it's the reason `parkCode` resolution is hammered in every description:

| Step | Tool | Produces | Feeds |
|:-----|:-----|:---------|:------|
| 1 | `nps_find_parks` | `parkCode`, coordinates | every other tool; coordinates → nws-weather / open-meteo |
| 2a | `nps_get_park` | full detail, fees, hours | the human's plan |
| 2b | `nps_get_alerts` | closures/hazards | go/no-go decision |
| 2c | `nps_find_campgrounds` | where to stay | booking (recreation.gov) |
| 2d | `nps_get_activities` | what to do | itinerary |
| 2e | `nps_find_events` | scheduled events | itinerary timing |

`nps_get_park` is the one batching tool (≤10 codes → 1 call); that's the only multi-input efficiency play. The "plan my visit" moonshot is this chain plus an `openstreetmap_geocode` ("near me" → coordinates → nearest parks) and an `nws_get_forecast` on the coordinates — a cross-server composition the calling agent assembles, intentionally **not** built as a workflow tool here (it would couple this server to three others).

---

## Known Limitations

- **`parkCode` is opaque and must be resolved first.** Every detail tool needs a code; agents that guess codes will miss. Mitigated by making `nps_find_parks` the documented entry point and by `missingCodes` enrichment on `nps_get_park`.
- **Coverage is US NPS sites only** — not state parks, not Forest Service / BLM. Stated in descriptions and empty-result notices so agents don't treat an empty result as "no parks near here" for non-NPS land.
- **Event feed is sparse and inconsistent.** Many parks list few or no events; the `/events` envelope and field names differ from the rest of the API. Notices set the expectation.
- **Records are large and free-text-heavy.** Hours, fees, amenities, and accessibility are human-authored strings, not structured enums. The server normalizes the high-value bits (amenity booleans, fee dollar-strings, reservable counts) and links the NPS page for the rest, rather than dumping raw nested objects.
- **No coordinates on some records.** Lat/lon is nullable throughout — the server never fabricates a center point; downstream weather lookups must handle a null gracefully.
- **Local passes cost a full-corpus fetch.** `nps_find_parks.activity` and `nps_get_alerts.category` have no upstream param, and `nps_find_parks.query` re-ranking needs the whole matched set too (NPS `/parks` returns no relevance order), so any of these pulls the whole set matched by the other filters (worst case ~3.9 MB / ~2 s for an unnarrowed `/parks`; `stateCode`/`query` narrow it upstream first — `stateCode=CA` drops it to ~320 KB, and NPS's `q` alone cuts "yosemite" to 3 records). Correctness over latency: the alternative silently hides matches or buries the obvious park below the fetched page. If a corpus ever outgrows the fetch limit, the response says so rather than implying exhaustiveness (see Decisions Log §7, §14).
- **`nps_find_parks` ranking is a local heuristic, not semantic relevance.** The re-rank sorts by transparent tiers (exact `parkCode` → exact name → name prefix → name substring → description-only) over `parkCode` and `fullName`, with NPS's upstream order preserved within each tier. It surfaces the obvious park; it does **not** disambiguate two parks that both start with the query (e.g. Glacier vs Glacier Bay both prefix "glacier" — NPS order decides), and it never invents a relevance score (see Decisions Log §14).
- **`nps_get_park` returns at most 5 images per park, and says when there are more.** The service caps the image list at `MAX_IMAGES_PER_PARK = 5` (park records are large); when the upstream list is longer, `imagesTruncated: true` discloses it and the park `url` is the path to the rest. Both client surfaces render every *returned* image, so the text and structured channels never disagree on what was returned (see Decisions Log §15). Raising the cap itself is a separate question, deliberately unchanged.

---

## API Reference

| Aspect | Detail |
|:-------|:-------|
| **Base URL** | `https://developer.nps.gov/api/v1` |
| **Auth** | `X-Api-Key` header. Free instant signup. Missing key → 403 `API_KEY_MISSING`; bad key → 403 `API_KEY_INVALID`. |
| **Rate limits** | 1,000 requests/hour per key (NPS documented). Light retry on 429/5xx suffices. |
| **Envelope (most endpoints)** | `{ total, limit, start, data: [...] }` — **`total`/`limit`/`start` are strings**; coerce to numbers in the service. |
| **Envelope (`/events`)** | `{ total, errors: [...], data: [...], pagenumber, pagesize }` — different shape; normalize. Note: `dates` is NOT a top-level envelope field; it lives inside each event record as an array of all occurrence dates. |
| **Array params** | `parkCode`, `stateCode` are **array** params on `/parks`, `/alerts`, `/campgrounds`, `/events` — comma-join for a single multi-target request. `/thingstodo` takes **single-string** `parkCode`/`stateCode`. |
| **Pagination** | `start` (0-based offset) + `limit` on most endpoints; `/events` uses `pageNumber` (1-based) + `pageSize`. |
| **`limit` ceiling** | **None enforced** — the API returns `min(limit, total)` (verified 2026-07-15: `/thingstodo?limit=2000` → 2000 of 3561). `/parks?limit=1000` returns all 474 and `/alerts?limit=1000` all 651, so either corpus is one request away. |
| **Unsupported params** | **Silently ignored, never rejected** — `/parks?activity=…` and `/alerts?category=…` return results identical to the call without them. An unsupported filter cannot be detected from the response; it must be applied locally (Decisions Log §7). |
| **Error shape** | `{ "error": { "code": "...", "message": "..." } }` on 403; `400` on malformed params. |
| **Sort** | `/parks`, `/campgrounds`, `/thingstodo`, `/events` accept a `sort` param; the server sorts alerts by `lastIndexedDate` locally for recency. |

---

## Implementation Order

1. **Config + `.env.example`** — `server-config.ts` with `NPS_API_KEY` / `NPS_BASE_URL`; add the var to `server.json`, `manifest.json`, `.codex-plugin/mcp.json`, `.claude-plugin/plugin.json`.
2. **`nps` service** — `init/accessor`, `fetchWithTimeout` + `withRetry` + `httpErrorFromResponse`, envelope normalization (string→number coercion; boolean string coercion; `/events` shape normalization; NPS error-envelope detection). Field shapes are now verified — implement the coercions documented in the Services section above.
3. **Remove echo scaffold** — delete `echo*.tool.ts`, `echo*.resource.ts`, `echo*.prompt.ts`, `echo*.app-*`, clear the barrels.
4. **Read-only tools** in dependency order: `nps_find_parks` → `nps_get_park` → `nps_get_alerts` → `nps_find_campgrounds` → `nps_get_activities` → `nps_find_events`. `devcheck` after each.
5. **Identity** — `createApp({ name: 'national-parks-mcp-server', title: 'national-parks-mcp-server', websiteUrl: 'https://github.com/cyanheads/national-parks-mcp-server', description: ... })`. Title is the hyphenated machine name. Optional `instructions`: the parkCode-first workflow + US-NPS-only scope.
6. **Tests** — `createMockContext`, per-tool handler tests including **one sparse-payload case** (omitted upstream fields) per the framework checklist; `nps_get_park` missing-code path; alert empty-result path.

Each step is independently testable.

---

## Decisions Log

1. **Six tools, one per trip-planning question; no `nps_search_all` mega-tool.** Each maps to a distinct user goal (find → detail → alerts → camp → do → events) and a distinct endpoint. Consolidating under a `resource`/`mode` enum would bury the parkCode-first workflow and mix array-param endpoints with the single-string `/thingstodo`. Matches the idea.md sketch exactly.

2. **`parkCode` resolution is a hard two-step, encoded everywhere.** `nps_find_parks` is named and described as "the required first step"; every detail tool's `parkCode` description says "Get codes from nps_find_parks." `nps_get_park` adds `missingCodes` enrichment so a wrong code self-corrects. This is the single most important DX decision — opaque keys are the server's main trap.

3. **`nps_get_park` batches ≤10 codes into one call.** `/parks` `parkCode` is an array param (confirmed in the live Swagger), so multi-park detail is one request, not N. Cap at 10 to bound payload (park records are large). Cross-reference returned vs. requested codes → `missingCodes`.

4. **`nps_get_alerts` is the headline tool: category + recency surfaced, not buried — under ONE ordering contract.** Output leads with `category` and `lastIndexedDate`; enrichment adds a `categoryBreakdown` count; the handler sorts most-recent-first (the API doesn't guarantee order). An empty page is framed in the notice, branching on `totalCount` — good news when nothing matched, a paging artifact when `start` ran past the end — and never asserted by `format()`, which cannot see `totalCount`. `category` is filtered locally because `/alerts` has no category query param (it takes `parkCode`/`stateCode`/`q` only — confirmed in Swagger). Live categories confirmed: Danger, Caution, Information, Park Closure (no bare "Closure" value seen — the design previously listed it incorrectly).

   **Revised 2026-07-15 (reverses the original "`format()` orders Danger/Park Closure first").** `format()` re-sorted by category while the handler sorted by recency, so `content[]` clients (Claude Desktop) and `structuredContent` clients (Claude Code) received the same alerts in *different orders* — and the category order contradicted the tool description, the `alerts` output description, and the `limit` description, which all promise most-recent-first. One public ordering contract wins: recency, sorted once in the handler, rendered as-is by `format()`. Category stays prominent per row via the `### [{category}] {title}` heading, so severity is still scannable without reordering. `breakdown()` keeps its own `CATEGORY_ORDER` severity sort — that's the summary *string*, a distinct field, and is intentionally severity-ordered.

5. **Record trimming: normalize the high-value bits, link the NPS page for the rest.** Park/campground records are deeply nested and free-text-heavy. The server flattens what agents filter on — amenity booleans, fee dollar-strings, reservable/first-come counts, coordinates, season — and surfaces `url` for the full record. It never fabricates structure from missing data: every derived field is nullable and a missing upstream value yields `null`, not a guess (framework checklist: "preserve uncertainty").

6. **`nps_find_events` is modeled as its own shape.** `/events` uses a different envelope (`pagenumber`/`pagesize`/`total`/`errors[]` — no top-level `dates`), `pageNumber`/`pageSize` pagination (not `start`/`limit`), and lowercased record fields (`datestart`, `dateend`, `isfree`, `isallday`, `regresurl`, `feeinfo`, `infourl`, `sitecode` for park). Critically: NPS events have NO `parkCode` field — the park identifier is in `sitecode`. Boolean fields (`isfree`, `isallday`) are strings "true"/"false". The tool exposes `pageNumber`/`pageSize` honestly rather than faking `start`/`limit` parity, and the service normalizes the record to camelCase output. A non-empty envelope `errors[]` on a 200 folds into the notice, not a throw.

7. **Local filters (`nps_find_parks.activity`, `nps_get_alerts.category`) filter the FULL matched set, never one page.** Neither `/parks` nor `/alerts` has the param (Swagger: `parkCode`/`stateCode`/`limit`/`start`/`q`/`sort` only), and the API **silently ignores** an unsupported one rather than erroring — `/parks?stateCode=CA&activity=Stargazing` returns parkCodes byte-identical to the same call without `activity`. So the filter must run locally. When one is active the tool fetches the whole set matched by the *other* filters (`limit` = the per-tool full-corpus fetch limit — `LOCAL_PROCESSING_FETCH_LIMIT` in `nps_find_parks`, `CATEGORY_FILTER_FETCH_LIMIT` in `nps_get_alerts`; `start` = 0) and slices locally; `totalCount` is the true post-filter total.

   **Revised 2026-07-15 (reverses the original "post-fetch substring match over the returned page").** The original rationale — "the set isn't bounded-and-fully-fetched here, so this is a best-effort convenience" — was factually wrong, and the page-scoped filter it justified produced false-empty results: `{stateCode: "CA", activity: "Stargazing", limit: 1}` returned "no sites matched" because the first CA site in upstream order (`alca`) offers no stargazing — while 10 CA sites do. Measured 2026-07-15: `/parks?limit=1000` returns **all 474** sites in one call, `/alerts?limit=1000` returns **all 651** in one call, and the API enforces **no maximum `limit`** (it returns `min(limit, total)` — `/thingstodo?limit=2000` yields 2000 of 3561). The filterable corpus is one request away, so the design skill's bounded-and-fully-fetched gate is *met*, and page-scoped filtering was never the honest option. **Never pass `start` upstream while filtering locally** — an upstream offset skips records before the filter sees them, which is why the two modes are mutually exclusive rather than composed. If a corpus ever exceeds the fetch limit, the response discloses a best-effort scan instead of implying exhaustiveness.

8. **`nps_get_activities` keeps `/thingstodo`'s single-string param contract.** Unlike the array-param endpoints, `/thingstodo` takes a single `parkCode`/`stateCode` (Swagger). The schema reflects that (single value + a `missing_filter` error requiring at least one), rather than pretending it accepts a list — avoids a silent "only the first code worked" bug.

9. **Truncation fields are optional; `totalCount` is required.** Per the cross-cutting rule: `ctx.enrich.total(n)` always (required `totalCount`); `ctx.enrich.truncated({ shown, cap })` only when the cap is hit, so `shown`/`cap` stay optional-and-unset on full results — declaring them required would throw -32007 on every non-truncated response.

   **Extended 2026-07-15 — the "more pages exist" test is start-aware, and an empty page is not an empty result.** Truncation fires on `start + shown < total`, not `total > shown`: the latter misfires on the last page (start=50, 8 returned, total=58 is complete, not truncated) and would advertise a next page that doesn't exist. Every list tool's truncation `guidance` names the concrete next retrieval action (`start=<n>`, or `pageNumber=<n>` for `/events`), since a disclosure the agent can't act on is only half a disclosure. Correspondingly, an empty page with a **non-zero** `totalCount` is a paging artifact, not an absence — each tool's empty-result notice branches on `total > 0` and says so. Collapsing the two lets `nps_get_alerts` answer "nothing closed or hazardous" while `totalCount` reports active closures — the same false-empty reassurance the §7 revision removed, reached by over-paging instead of page-scoped filtering.

   **The empty branch of `format()` defers rather than concludes.** `format()` is handed the domain payload alone, so `totalCount` is structurally out of reach and it cannot distinguish an all-clear from a page past the end. Every list tool's empty text therefore points at the notice ("See the notice for what this means") instead of asserting an interpretation it has no basis for — the notice is the single place that owns that call. This matters most on `nps_get_alerts`, where a wrong guess reads as a safety all-clear.

10. **No auth scopes, no resources, no prompts, no DataCanvas/Mirror.** Read-only single-source public data → stdio + HTTP-`none`, scopes add nothing. Data is point-in-time discovery/detail, not analytical row sets (no SQL workspace) and not a bulk corpus queried more than it changes (no mirror). Resources would duplicate tools for the resource-supporting minority; deferred.

11. **`openWorldHint: true` on all tools.** Every tool hits a live external API whose results change (alerts daily, events seasonally) — the world is open. All are `readOnlyHint: true` (no writes). No `destructiveHint`/`idempotentHint` relevant.

12. **Identity pinned to the hyphenated machine name.** `createApp` `title` and manifest `display_name` are `national-parks-mcp-server`, never "National Parks MCP Server" — agents and humans both see the machine name (Title Case display names are a known agent prior to strike).

13. **API key blocker resolved — field shapes verified live.** The original `.env` key was invalid (36 chars + hyphen vs. NPS's 40 alphanumeric chars; `API_KEY_INVALID` on every call). A valid key is now provisioned; all record field shapes, types, and nullability decisions above are grounded in actual live API responses. The design-phase live verification is complete. Build can proceed directly to implementation.

14. **`nps_find_parks` re-ranks `query` results locally over the FULL matched set, not the page.** Measured 2026-07-16: NPS `/parks?q=` performs no relevance ranking — results come back alphabetical by `parkCode`, uncorrelated with textual relevance (`q=yosemite` → `depo, wrst, yose`; `q=zion` → `zion` last of 5; `q="grand canyon"` → `grca` sits mid-alphabet in 62 records, off page 1 at any small limit). So the obvious park is routinely buried behind sites that only mention the term in their *description*. The fix re-ranks by a stable tiered classification — exact `parkCode` (0) → exact `fullName` (1) → name prefix (2) → term elsewhere in name (3) → description-only (4), NPS's upstream order preserved within each tier — and this **must run over the whole matched set before the page is sliced**, so it reuses the same full-corpus-fetch mode as the `activity` filter (extended from `activity`-only to `activity || query`; the shared constant is now `LOCAL_PROCESSING_FETCH_LIMIT`). Ranking only the already-sliced page would reproduce the exact bug for any query whose matches exceed `limit` — the `grand canyon` case proves it: `grca` surfaces to #1 of 62 at `limit: 5` only because the full set is ranked first. The tiers are deliberately transparent, not a fuzzy-match library or a fabricated score, consistent with §7's strict-token-match convention; two parks that both prefix the query (Glacier vs Glacier Bay) keep NPS's order rather than inventing a finer signal. Patch-level: reordering within the existing handler and output shape, no new tool/resource/prompt and no contract change (verified live — ranking is entirely client-side, no new upstream mode needed).

15. **`format()` and `structuredContent` must agree on what data exists — no silent head-caps.** Two tools diverged the surfaces. `nps_find_parks.formatActivities()` rendered `activities.slice(0, 8)` + "+ N more" in text while `structuredContent.parks[].activities` carried the full array (measured 2026-07-16: `yell` returns 53 activities, of which text showed 8) — `content[]`-only clients (Claude Desktop) silently saw fewer than `structuredContent` clients (Claude Code). Fix: render the complete list in both channels. `nps_get_park.format()` rendered only `images[0]` while `structuredContent` carried up to 5, and the service caps the upstream list at `MAX_IMAGES_PER_PARK = 5` with no disclosure (measured: `yose` 12 images upstream, `acad` 12, `yell` 11 — all silently trimmed to 5, then to 1 in text). Fix: (a) render every returned image in `content[]`, and (b) add a per-park `imagesTruncated` boolean, set by `normalizeParkDetail()` when the upstream count exceeds the cap — the park `url` is already the "see the rest" path, so a boolean is the whole honest contract (no image-pagination or selector surface warranted). Raising the 5-cap itself is a separate, deliberately-unchanged question; this decision is about parity and disclosure. Additive output field, backward-compatible — patch-level.

16. **`nps_find_events` exposes window-intersected `occurrenceDates` + `isRecurring`; the raw `dates[]` is not the matched set (#2).** A date-window query returned recurring events rendered at their *series anchor* (`datestart`/`dateend`), so a July window could show May dates. Measured live 2026-07-16: each event's `dates[]` is "all remaining occurrences from today through `recurrencedateend`," **byte-identical across different requested windows** (`eventid 134460` returned the same 73 entries for an August window, a September window, and no filter) — NPS's `dateStart`/`dateEnd` filter which *events* appear, never each event's own `dates[]`. So exposing raw `dates[]` as "matched dates" would relabel a *different* piece of misleading data (a past or narrow window would intersect none of it). The service intersects `dates[]` with `[dateStart, dateEnd]` locally into `occurrenceDates` (reducing to the full remaining list when no window is requested) and surfaces the dropped `isrecurring` as `isRecurring`, so the anchor-vs-occurrence divergence is explained rather than dumped. `dateStart`/`dateEnd` keep their source mapping; additive output fields — backward-compatible, patch-level.

17. **Park/state code format and calendar-date validity are validated in the handler, not at the Zod schema edge, so declared recovery hints reach the client (#3, #8).** The framework runs `def.input.parse(input)` and throws a raw `ZodError` **before** `ctx.fail`/`recoveryFor` exist (verified in `toolHandlerFactory.js`); the classifier attaches only `{issues}`, never the tool's declared `{reason, recovery}`. So a schema-level `.regex()`/`.refine()` failure can *never* surface a tool's `invalid_park_code`/`invalid_state_code`/`invalid_date` recovery text — a `.refine()` with a custom message lands in the same dead branch. The fix loosens the `parkCode`/`stateCode` schemas to `z.string().optional()` and validates token format in each handler (mirroring the existing `dateEnd < dateStart` check), and adds a synchronous `Date.UTC` round-trip calendar check for `dateStart`/`dateEnd` in `nps_find_events` (the `YYYY-MM-DD` regex still guards shape; `"2026-02-31"` passes shape but fails the calendar check before the upstream 400). `nps_find_events` also gains the `invalid_state_code` reason it was missing despite carrying an identical `stateCode` field. Loosening a format constraint plus a handler check is strictly permissive and backward-compatible — patch-level.

---

## Review pass

**Date:** 2026-06-13 · **Reviewer:** Independent cold-read against live NPS API

### Changes made

All changes were verified against live API responses (a valid key confirmed working; probed `/parks`, `/alerts`, `/campgrounds`, `/thingstodo`, `/events`).

#### Blocker cleared

1. **Removed invalid-key blocker notice** — key is now provisioned and working; replaced with a note that field shapes are verified live.
2. **Decision #13 updated** — blocker resolved, build can proceed.

#### Type bugs (would cause runtime crashes or wrong output)

3. **`latitude`/`longitude` are strings in the NPS API, not numbers** — added coercion note throughout: service must `parseFloat(s) || null` (empty string → null). Affects parks, campgrounds, and thingstodo. Output schema stays `z.number().nullable()` (post-coercion).
4. **`totalSites` is in `campsites.totalSites` nested object, not top-level** — design referenced it as top-level. Corrected with explicit extraction path. `campsites.totalSites` is also a string and needs `parseInt` coercion.
5. **`numberOfSitesReservable`/`numberOfSitesFirstComeFirstServe` are strings** — added coercion notes.
6. **Activities and topics in parks are `{id, name}` objects**, not name strings — added note that service extracts `.name`.
7. **`/thingstodo` has no top-level `parkCode` field** — it's in `relatedParks[0].parkCode`. Output field changed to `z.string().nullable()` with extraction note.
8. **`isReservationRequired` and `arePetsPermitted` are strings `"true"`/`"false"`**, not booleans — added coercion notes.
9. **`isfree` and `isallday` in `/events` are strings**, not booleans — added coercion notes.
10. **Events `parkCode` field does not exist** — the identifier is `sitecode`. Output field description updated.
11. **`duration` vs `durationDescription`**: `durationDescription` is frequently empty; `duration` carries the actual time commitment (e.g. `"1-3 Hours"`). Design used the wrong field name. Fixed.
12. **Campground `accessibility` is a dict object**, not a string — service must extract `accessibility.adaInfo` as the free-text summary. Schema description corrected.
13. **Campground `rvHookups` boolean renamed to `rvAllowed`** — source is `accessibility.rvAllowed` (`"1"/"0"` → bool), not an amenities hookup field. The amenities object has no explicit hookup field; RV info lives in `accessibility`.

#### Data shape bugs (would produce wrong or empty output)

14. **`amenities.potableWater`, `showers`, `toilets` are arrays**, not simple strings (e.g. `["Yes - seasonal", "None"]`) — normalization must check if any element starts with `"Yes"`, not just compare a string. Corrected with description.
15. **Alert `url` is empty string `""` when absent**, not `null` — service must normalize to `null`. Updated description.
16. **Alert `lastIndexedDate` format is `"YYYY-MM-DD 00:00:00.0"`**, not ISO 8601 — corrected description; service should strip to `"YYYY-MM-DD"`.
17. **Alert category enum was wrong** — `"Closure"` does not exist in live data; actual categories are `Danger`, `Caution`, `Information`, `Park Closure`. Removed `"Closure"` from the input enum and output description. Updated all references (decision #4, format note).
18. **Events envelope `dates` misattributed** — `dates` is an array inside each event record (all occurrence dates for recurring events), NOT a top-level envelope field. API Reference table and decision #6 corrected.
19. **Events `feeinfo`, `regresurl`, `infourl` are empty strings when absent** — service must normalize to null. Noted in output descriptions.

#### Zod schema gaps

20. **`standardHours` day fields lacked `.describe()`** — the linter enforces `.describe()` on all fields; added per-day descriptions.

#### Service layer

21. **Added comprehensive coercion summary to Services section** — `withRetry`/`fetchWithTimeout` notes already present; added a "Pervasive string-type fields" bullet and "Field extraction quirks" bullet documenting all normalization the service layer must implement, so a build agent has a single reference rather than hunting individual tool sections.

### What was NOT changed

- Tool surface (6 tools) — correct and no genuine gaps; no NPS endpoint the design wrongly omits
- Auth mechanism — `X-Api-Key` header confirmed correct
- Pagination design — `start`/`limit` on most endpoints, `pageNumber`/`pageSize` on events, confirmed in live responses
- `parkCode` regex `^[a-z]{4}$` — confirmed all NPS park codes are exactly 4 lowercase characters
- Required/optional decisions on truncation fields — `shown`/`cap` remain `.optional()` per the -32007 avoidance rule; `totalCount` stays required
- Rate limit estimate (1,000/hr), retry strategy, and resilience design — unchanged
- Identity (`national-parks-mcp-server`, never Title Case) — unchanged
- No resources/prompts/DataCanvas — confirmed correct for this domain

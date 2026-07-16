<div align="center">
  <h1>@cyanheads/national-parks-mcp-server</h1>
  <p><b>Plan US National Park Service trips — find parks, check alerts and closures, find campgrounds, browse things to do and events via the NPS Data API. STDIO or Streamable HTTP.</b>
  <div>6 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/national-parks-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/national-parks-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/national-parks-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.14-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/national-parks-mcp-server/releases/latest/download/national-parks-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=national-parks-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvbmF0aW9uYWwtcGFya3MtbWNwLXNlcnZlciJdLCJlbnYiOnsiTlBTX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXkifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22national-parks-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fnational-parks-mcp-server%22%5D%2C%22env%22%3A%7B%22NPS_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://national-parks.caseyjhand.com/mcp](https://national-parks.caseyjhand.com/mcp)

</div>

---

## Tools

Six tools shaped around the trip-planning workflow — resolve a park, then key the detail tools on its code:

| Tool | Description |
|:---|:---|
| `nps_find_parks` | Resolve a place name, US state, or free-text query to parks — the required first step. Returns each park's `parkCode` plus a trip-planning summary. |
| `nps_get_park` | Full detail for up to ten parks in one batched call: description, activities, fees & passes, hours, contacts, directions, weather overview, images. |
| `nps_get_alerts` | Current alerts for a park or state — closures, hazards, caution, information — with category and recency surfaced first. |
| `nps_find_campgrounds` | Campgrounds at a park or state: amenities, reservable vs. first-come site counts, reservation info, accessibility, and fees. |
| `nps_get_activities` | Curated things to do and points of interest: title, duration, location, accessibility, and fee/pet/reservation flags. |
| `nps_find_events` | Scheduled events within a date range: dates/times, location, category, fee, and registration links. |

Coverage is **US National Park Service sites only** — national parks, monuments, historic sites, seashores — not state parks and not Forest Service or BLM land.

### The `parkCode` spine

`parkCode` (e.g. `yose`, `grca`, `zion`) is the join key for the whole API. The workflow is two steps:

1. **`nps_find_parks`** resolves a name / state / query → `parkCode`(s) plus a summary.
2. **`nps_get_park`**, **`nps_get_alerts`**, **`nps_find_campgrounds`**, **`nps_get_activities`**, **`nps_find_events`** key on that `parkCode`.

`nps_get_alerts`, `nps_find_campgrounds`, and `nps_find_events` also accept a `stateCode` for statewide queries without a code (e.g. "is anything closed in Montana's parks?"). The coordinates returned by `nps_find_parks` / `nps_get_park` feed weather servers (`nws-weather`, `open-meteo`) for a forecast.

---

### `nps_find_parks`

Resolve a place name, US state, or free-text query into NPS parks — the entry point.

- Free-text search across park names and descriptions (e.g. `"yosemite"`, `"civil war"`, `"redwood"`)
- Filter by two-letter `stateCode` or a comma-separated list (e.g. `"CA"`, `"WY,MT,ID"`)
- Optional `activity` filter — case-insensitive substring match applied locally (the API has no activity param) across every site matching `query`/`stateCode`, then paginated
- Pagination via `limit` (1–50, default 10) and `start` offset; `totalCount` counts the whole matched set, so truncation guidance names the next `start`
- Summary carries `parkCode`, designation, states, description, coordinates, headline activities, lowest entrance fee, and the NPS page
- Enrichment reports `totalCount`, applied-filter echo, and broadening guidance when nothing matched

---

### `nps_get_park`

Full trip-planning detail for one or more parks by `parkCode`.

- Batch up to **10 codes in a single upstream call**
- Always-present core: name, designation, states, description, coordinates, weather overview, NPS page
- Optional `fields` selector (`activities`, `topics`, `fees`, `hours`, `contacts`, `directions`, `images`) trims the payload to the sections you need
- Entrance fees and passes broken out by category; operating hours by area/season with per-weekday values; phone and email contacts; representative images (capped at 5)
- Unresolved codes surface as `missingCodes` enrichment with a correction hint; only a fully-empty result is an error

---

### `nps_get_alerts`

Current alerts for a park or a whole state, with category and recency leading.

- Filter by `parkCode`, `stateCode`, or free-text `query`; optional `category` (`Danger`, `Caution`, `Information`, `Park Closure`) applied locally (the API has no category param) across every matching alert, then paginated
- Pagination via `limit` (1–50, default 20) and `start` offset; truncation guidance names the next `start`
- Sorted most-recent-first, identically on both client surfaces (`structuredContent` and `content[]`)
- `categoryBreakdown` enrichment counts returned alerts per category — severity-ordered — so severity is legible without scanning each one
- An empty result is explicitly framed in the notice — good news (the park reports nothing closed or hazardous) when nothing matched, or a paging artifact when `start` ran past the end — never a bare error
- `lastIndexedDate` is the recency signal — a stale date may mean the condition has changed

---

### `nps_find_campgrounds`

Campgrounds at a park or across a state, flattened to what a camper filters on.

- Filter by `parkCode`, `stateCode`, or free-text `query`; `limit` (1–50, default 15) and `start` pagination
- Amenity booleans: potable water, showers, RV dump station, toilets, trash collection, RV access — normalized from NPS's mixed array/string amenity fields
- Reservable vs. first-come-first-served site counts, total sites, reservation guidance and booking URL (often recreation.gov)
- Lowest fee, accessibility summary, coordinates, and the campground's NPS page
- Some parks list lodging or backcountry permits instead of NPS-managed campgrounds; an empty result is not an error

---

### `nps_get_activities`

Curated things to do and points of interest, backed by the NPS `/thingstodo` list (distinct from a park's raw activity tags).

- Accepts a **single** 4-letter `parkCode` or a **single** two-letter `stateCode` — at least one is required
- Free-text `query`; `limit` (1–50, default 15) and `start` pagination
- Per activity: title, short description, time commitment, location, coordinates, accessibility, season, and the NPS page
- Reservation-required and pets-permitted booleans; fee description (absence does not guarantee free)
- Not every park has a curated list; an empty result is not an error

---

### `nps_find_events`

Scheduled events at a park within a date range — ranger programs, festivals, tours, interpretive events.

- Filter by `parkCode`, `stateCode`, or free-text `query`; bound the window with `dateStart` / `dateEnd` (`YYYY-MM-DD`)
- **Page-based pagination** (`pageNumber` / `pageSize`), not offset — the `/events` endpoint differs from the rest of the API
- Per event: title, date range, time slots, location, category, fee info, and registration / info URLs (HTML stripped to plain text)
- The events feed is sparser and less consistent than alerts or campgrounds; many parks list few or no events
- A non-empty upstream `errors[]` array folds into the result notice as a warning rather than failing the request

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports — same codebase runs locally or on Cloudflare Workers

NPS-specific:

- One service wrapping the NPS Data API (`developer.nps.gov/api/v1`, `X-Api-Key` auth) across six trip-planning endpoints
- Aggressive normalization of NPS's inconsistent payloads — numeric and boolean fields returned as strings, nested values (`campsites.totalSites`), array-typed amenity fields, and the distinct `/events` envelope with lowercased field names — coerced to clean domain types before they reach handlers
- `nps_get_park` batches up to ten park codes into a single upstream request
- Light retry on transient upstream failures (5xx / network); a missing or invalid key fails loud and names `NPS_API_KEY`

Agent-friendly output:

- Result-set context on every response — `totalCount`, truncation (`shown` / `cap`), applied-filter echo, and empty-result notices reach both the structured and text surfaces
- The `parkCode`-first workflow is encoded in every tool description; `nps_get_park` returns `missingCodes` so a wrong code self-corrects
- Uncertainty preserved, never fabricated — every derived field is nullable and a missing upstream value yields `null`, not a guess; coordinates are never invented for downstream weather lookups

## Getting started

### Public Hosted Instance

A public instance is available at `https://national-parks.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP, with this client config:

```json
{
  "mcpServers": {
    "national-parks-mcp-server": {
      "type": "streamable-http",
      "url": "https://national-parks.caseyjhand.com/mcp"
    }
  }
}
```

### Self-hosted

Add the following to your MCP client configuration file. A free NPS Data API key is required — [instant signup here](https://www.nps.gov/subjects/developer/get-started.htm).

```json
{
  "mcpServers": {
    "national-parks-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/national-parks-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "NPS_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "national-parks-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/national-parks-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "NPS_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "national-parks-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "-e", "NPS_API_KEY=your-api-key",
        "ghcr.io/cyanheads/national-parks-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 NPS_API_KEY=... bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.3](https://bun.sh/) or higher (or Node.js v24+).
- A free NPS Data API key — [instant signup](https://www.nps.gov/subjects/developer/get-started.htm). The server fails to start without it.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/national-parks-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd national-parks-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set NPS_API_KEY
```

## Configuration

All configuration is validated at startup via Zod schemas. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `NPS_API_KEY` | **Required.** NPS Data API key, sent as the `X-Api-Key` header. The server fails to start without it. | — |
| `NPS_BASE_URL` | NPS Data API base URL override (testing / proxy). | `https://developer.nps.gov/api/v1` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | Path where the MCP server is mounted. | `/mcp` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t national-parks-mcp-server .
docker run --rm -e NPS_API_KEY=your-key -p 3010:3010 national-parks-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/national-parks-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers the six tools and inits the NPS service. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). |
| `src/services/nps` | NPS Data API service — HTTP client, retry boundary, error-envelope detection, and all upstream normalization. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`AGENTS.md`](./AGENTS.md) / [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools in the `createApp()` arrays
- Wrap the external API: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

## Data & attribution

Data is retrieved from the [NPS Data API](https://developer.nps.gov/) operated by the U.S. National Park Service. Content produced by NPS employees in their official capacity is a U.S. Government work in the public domain (17 U.S.C. §§ 101 and 105). No claim to original U.S. Government works.

Not all content returned by the API is government-authored. Some images and materials carry third-party copyright or other restrictions — check individual item rights before reuse.

The NPS Arrowhead symbol is a restricted mark protected under 18 U.S.C. § 701. It must not be reproduced or reused without written permission from the NPS Director.

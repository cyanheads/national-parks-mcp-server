<div align="center">
  <h1>@cyanheads/national-parks-mcp-server</h1>
  <p><b>Plan US National Park Service trips — find parks, check alerts and closures, find campgrounds, browse things to do and events via the NPS Data API. STDIO or Streamable HTTP.</b>
  <div>6 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/national-parks-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/national-parks-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/national-parks-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/national-parks-mcp-server/releases/latest/download/national-parks-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=national-parks-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvbmF0aW9uYWwtcGFya3MtbWNwLXNlcnZlciJdLCJlbnYiOnsiTlBTX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXkifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22national-parks-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fnational-parks-mcp-server%22%5D%2C%22env%22%3A%7B%22NPS_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://national-parks.caseyjhand.com/mcp](https://national-parks.caseyjhand.com/mcp)

</div>

---

## Overview

US National Park Service trip planning over the NPS Data API. Resolve a park to its `parkCode`, then check alerts and closures, find campgrounds, and browse activities and events — coverage is US NPS sites only (national parks, monuments, historic sites, seashores), not state parks, Forest Service, or BLM land. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `nps_find_parks` | Resolve a place name, US state, or free-text query to parks — the required first step. Returns each park's `parkCode` plus a trip-planning summary. |
| `nps_get_park` | Full detail for up to ten parks in one batched call: description, activities, fees & passes, hours, contacts, directions, weather overview, images. |
| `nps_get_alerts` | Current alerts for a park or state — closures, hazards, caution, information — with category and recency surfaced first. |
| `nps_find_campgrounds` | Campgrounds at a park or state: amenities, reservable vs. first-come site counts, reservation info, accessibility, and fees. |
| `nps_get_activities` | Curated things to do and points of interest: title, duration, location, accessibility, and fee/pet/reservation flags. |
| `nps_find_events` | Scheduled events within a date range: dates/times, location, category, fee, and registration links. |

## Capability reference

### `nps_find_parks` <sub>tool</sub>

- Free-text `query`, two-letter `stateCode` (or a comma-separated list such as `"WY,MT,ID"`), and an optional `activity` filter; `limit` 1–50 (default 10) with a `start` offset
- Each park carries its `parkCode` plus designation, states, description, coordinates, headline activities, lowest entrance fee, and NPS page; exact `parkCode` or name matches rank first, and `totalCount` counts every match

---

### `nps_get_park` <sub>tool</sub>

- Up to **10** `parkCode`s per call; the optional `fields` selector (`activities`, `topics`, `fees`, `hours`, `contacts`, `directions`, `images`) trims the payload to the sections you need
- Always returns name, designation, states, description, coordinates, weather overview, and NPS page; fees and passes by category, hours by area and season, contacts, and up to 5 images (`imagesTruncated` when the park has more)
- Codes that match no site come back as `missingCodes`; the call fails (`no_parks_found`) only when none resolve

---

### `nps_get_alerts` <sub>tool</sub>

- Filter by `parkCode`, `stateCode`, free-text `query`, and `category` (`Danger`, `Caution`, `Information`, `Park Closure`); `limit` 1–50 (default 20) with a `start` offset
- Most-recent-first, each alert with its category, `lastIndexedDate` recency, and detail; `categoryBreakdown` counts the returned alerts by severity
- The notice tells an all-clear (no alerts at that location) apart from a filter that matched nothing and a page past the end

---

### `nps_find_campgrounds` <sub>tool</sub>

- Filter by `parkCode`, `stateCode`, or free-text `query`; `limit` 1–50 (default 15) with a `start` offset
- Per campground: amenities (potable water, showers, dump station, toilets, trash collection, RV access) as yes, no, or unknown; reservable, first-come, and total site counts; reservation guidance and booking URL; lowest fee, accessibility, coordinates, and NPS page

---

### `nps_get_activities` <sub>tool</sub>

- A **single** `parkCode` or a **single** `stateCode` is required, plus an optional `query`; `limit` 1–50 (default 15) with a `start` offset
- Per activity: title, short description, time commitment, location, coordinates, accessibility, season, reservation-required and pets-permitted flags, fee description, and NPS page

---

### `nps_find_events` <sub>tool</sub>

- Filter by `parkCode`, `stateCode`, or `query` within a `dateStart` / `dateEnd` window (`YYYY-MM-DD`); pages by `pageNumber` and `pageSize` (1–50, default 15), not by offset
- Per event: title, date range, `occurrenceDates` inside the window (`isRecurring` marks a series), time slots, location, category, fee, and registration and info URLs
- Errors NPS reports alongside results fold into the notice instead of failing the call

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

NPS-specific:

- One service wrapping the NPS Data API (`developer.nps.gov/api/v1`, `X-Api-Key` auth) across six trip-planning endpoints
- Aggressive normalization of NPS's inconsistent payloads — numeric and boolean fields returned as strings, nested values (`campsites.totalSites`), array-typed amenity fields, and the distinct `/events` envelope with lowercased field names — coerced to clean domain types before they reach handlers
- `nps_get_park` batches up to ten park codes into a single upstream request
- Light retry on transient upstream failures (5xx / network); a missing or invalid key fails loud and names `NPS_API_KEY`
- Coordinates returned by `nps_find_parks` / `nps_get_park` feed weather servers (`nws-weather`, `open-meteo`) for a forecast

Agent-friendly output:

- Result-set context on every response — `totalCount`, truncation (`truncated` / `shown` / `cap`), applied-filter echo, and empty-result notices reach both the structured and text surfaces
- Many parks list no campgrounds, curated activities, or events; an empty result comes back with a notice on where else to look, never as an error
- The `parkCode`-first workflow is encoded in every tool description; `nps_get_park` returns `missingCodes` so a wrong code self-corrects
- Uncertainty preserved, never fabricated — missing coordinates, directions, fees, and amenity values come back `null`, not a guess; coordinates are never invented for downstream weather lookups

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

### Self-Hosted / Local

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

- [Bun v1.4](https://bun.sh/) or higher (or Node.js v24+).
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
| `MCP_SESSION_MODE` | Session handling: `auto`, `stateful`, or `stateless`. The schema default `auto` resolves to stateful; this server sets `stateless` explicitly. MCP 2026-07-28 is sessionless in either mode. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log each failed tool call's arguments and result, redacted by key name and capped at `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). A secret inside a free-form value is not redacted. | `false` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry) (spans, metrics, completion logs). | `false` |

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

## Data & attribution

Data is retrieved from the [NPS Data API](https://developer.nps.gov/) operated by the U.S. National Park Service. Content produced by NPS employees in their official capacity is a U.S. Government work in the public domain (17 U.S.C. §§ 101 and 105). No claim to original U.S. Government works.

Not all content returned by the API is government-authored. Some images and materials carry third-party copyright or other restrictions — check individual item rights before reuse.

The NPS Arrowhead symbol is a restricted mark protected under 18 U.S.C. § 701. It must not be reproduced or reused without written permission from the NPS Director.

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

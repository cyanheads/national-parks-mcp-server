#!/usr/bin/env node
/**
 * @fileoverview national-parks-mcp-server entry point — wires the six NPS
 * trip-planning tools and initializes the NPS service in setup().
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
import { npsFindCampgrounds } from './mcp-server/tools/definitions/nps-find-campgrounds.tool.js';
import { npsFindEvents } from './mcp-server/tools/definitions/nps-find-events.tool.js';
import { npsFindParks } from './mcp-server/tools/definitions/nps-find-parks.tool.js';
import { npsGetActivities } from './mcp-server/tools/definitions/nps-get-activities.tool.js';
import { npsGetAlerts } from './mcp-server/tools/definitions/nps-get-alerts.tool.js';
import { npsGetPark } from './mcp-server/tools/definitions/nps-get-park.tool.js';
import { initNpsService } from './services/nps/nps-service.js';

await createApp({
  name: 'national-parks-mcp-server',
  title: 'national-parks-mcp-server',
  tools: [
    npsFindParks,
    npsGetPark,
    npsGetAlerts,
    npsFindCampgrounds,
    npsGetActivities,
    npsFindEvents,
  ],
  instructions:
    'Plan a US National Park Service trip. Coverage is US NPS sites only — national parks, monuments, historic sites, seashores — not state parks, Forest Service, or BLM land. The workflow is parkCode-first: call nps_find_parks to resolve a place/state/query into a parkCode, then key nps_get_park, nps_get_alerts, nps_find_campgrounds, nps_get_activities, and nps_find_events on that code. nps_get_alerts is time-sensitive (closures change daily). Park coordinates returned by nps_find_parks / nps_get_park feed weather servers (nws-weather, open-meteo) for a forecast.',
  setup() {
    initNpsService(getServerConfig());
  },
});

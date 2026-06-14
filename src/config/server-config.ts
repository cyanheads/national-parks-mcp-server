/**
 * @fileoverview Server-specific configuration for national-parks-mcp-server.
 * Lazy-parsed Zod schema mapping env vars (NPS_API_KEY, NPS_BASE_URL) to typed
 * config, kept separate from the framework's core config.
 * @module config/server-config
 */

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

/**
 * Lazily parse and cache the server configuration from the environment.
 * `parseEnvConfig` maps schema paths to env var names so a missing/invalid
 * value reports `NPS_API_KEY`, not the internal `apiKey` path.
 */
export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'NPS_API_KEY',
    baseUrl: 'NPS_BASE_URL',
  });
  return _config;
}

/**
 * @fileoverview nps_get_park — the trip-planning hub. Full (trimmed) detail for
 * up to 10 parks by parkCode in one batched upstream call: description,
 * activities/topics, fees & passes, hours, contacts, directions, weather, images.
 * @module mcp-server/tools/definitions/nps-get-park.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';

export const npsGetPark = tool('nps_get_park', {
  title: 'national-parks-mcp-server: get park detail',
  description:
    'Full trip-planning detail for one or more parks by parkCode: description, activities and topics, entrance fees and passes, operating hours by area/season, contacts, directions, a free-text weather overview, representative images, and the NPS page for everything else. Get codes from nps_find_parks. Up to ten codes are fetched in a single request. Use the fields parameter to trim the payload when you only need certain sections.',
  annotations: { readOnlyHint: true, openWorldHint: true },
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
  output: z.object({
    parks: z
      .array(
        z
          .object({
            parkCode: z.string().describe('Park code (echoes the request).'),
            fullName: z.string().describe('Full official park name.'),
            designation: z
              .string()
              .describe('Site type (e.g. "National Park"). Empty string if none.'),
            states: z.string().describe('Comma-separated state codes the park spans.'),
            description: z.string().describe('Full park description.'),
            latitude: z.number().nullable().describe('Center latitude (decimal degrees) or null.'),
            longitude: z
              .number()
              .nullable()
              .describe('Center longitude (decimal degrees) or null.'),
            weatherOverview: z
              .string()
              .nullable()
              .describe(
                'NPS free-text weather/seasonal overview for the park, or null. For an actual forecast, feed the coordinates to nws-weather or open-meteo.',
              ),
            directionsInfo: z
              .string()
              .nullable()
              .describe('Free-text driving/access directions, or null.'),
            directionsUrl: z.string().nullable().describe('NPS directions page URL, or null.'),
            url: z.string().describe("Park's official NPS.gov page."),
            activities: z
              .array(z.string())
              .optional()
              .describe('Activity names (included unless fields excludes "activities").'),
            topics: z
              .array(z.string())
              .optional()
              .describe(
                'Topic names — what the park is about, e.g. "Volcanoes", "Civil War" (included unless fields excludes "topics").',
              ),
            entranceFees: z
              .array(
                z
                  .object({
                    cost: z
                      .string()
                      .describe(
                        'Fee amount as a dollar string (e.g. "35.00"). "0.00" means no charge for that category.',
                      ),
                    title: z.string().describe('Fee title (e.g. "Entrance - Private Vehicle").'),
                    description: z.string().describe('What the fee covers and for how long.'),
                  })
                  .describe('A single entrance fee category.'),
              )
              .optional()
              .describe(
                'Entrance fees by category (included unless fields excludes "fees"). Empty array means the park lists no entrance fee.',
              ),
            entrancePasses: z
              .array(
                z
                  .object({
                    cost: z.string().describe('Pass cost as a dollar string.'),
                    title: z.string().describe('Pass title (e.g. "Yosemite Annual Pass").'),
                    description: z.string().describe('Pass coverage and validity.'),
                  })
                  .describe('A single annual or park-specific pass.'),
              )
              .optional()
              .describe(
                'Annual/park-specific passes (included unless fields excludes "fees"). May be empty.',
              ),
            operatingHours: z
              .array(
                z
                  .object({
                    name: z.string().describe('Schedule name (e.g. "Yosemite Valley").'),
                    description: z.string().describe('Free-text hours/seasonality notes.'),
                    standardHours: z
                      .object({
                        monday: z
                          .string()
                          .describe('Monday hours (e.g. "All Day", "Closed", "9:00AM - 5:00PM").'),
                        tuesday: z.string().describe('Tuesday hours.'),
                        wednesday: z.string().describe('Wednesday hours.'),
                        thursday: z.string().describe('Thursday hours.'),
                        friday: z.string().describe('Friday hours.'),
                        saturday: z.string().describe('Saturday hours.'),
                        sunday: z.string().describe('Sunday hours.'),
                      })
                      .describe(
                        'Per-weekday operating hours. Values are free-text strings from NPS.',
                      ),
                  })
                  .describe('Operating hours for one area or season.'),
              )
              .optional()
              .describe(
                'Operating hours by area/season (included unless fields excludes "hours"). May be empty.',
              ),
            contacts: z
              .object({
                phoneNumbers: z
                  .array(
                    z
                      .object({
                        phoneNumber: z.string().describe('The number.'),
                        type: z.string().describe('Type (e.g. "Voice", "Fax").'),
                      })
                      .describe('A single phone contact.'),
                  )
                  .describe('Phone contacts. May be empty.'),
                emailAddresses: z
                  .array(
                    z
                      .object({ emailAddress: z.string().describe('The email address.') })
                      .describe('A single email contact.'),
                  )
                  .describe('Email contacts. May be empty.'),
              })
              .optional()
              .describe('Park contact info (included unless fields excludes "contacts").'),
            images: z
              .array(
                z
                  .object({
                    url: z.string().describe('Image URL.'),
                    altText: z.string().describe('Alt text / caption.'),
                    title: z.string().describe('Image title.'),
                  })
                  .describe('A single representative park image.'),
              )
              .optional()
              .describe(
                'Representative park images (included unless fields excludes "images"). Capped at 5; imagesTruncated flags when the park has more. May be empty.',
              ),
            imagesTruncated: z
              .boolean()
              .optional()
              .describe(
                'True when the park has more images upstream than the 5 returned here — open the park url for the full set. Present only when the images section is included.',
              ),
          })
          .describe('One park with its trip-planning detail.'),
      )
      .describe('Requested parks with trip-planning detail.'),
  }),
  enrichment: {
    requestedCount: z.number().describe('Number of park codes requested.'),
    returnedCount: z.number().describe('Number of parks the API returned.'),
    missingCodes: z
      .array(z.string())
      .optional()
      .describe(
        'Requested park codes the API returned no record for — likely invalid/misspelled codes. Populated only when some codes did not resolve.',
      ),
    notice: z
      .string()
      .optional()
      .describe('Guidance when one or more codes did not resolve, or when none did.'),
  },
  enrichmentTrailer: {
    requestedCount: { label: 'Requested' },
    returnedCount: { label: 'Returned' },
    missingCodes: { label: 'Unresolved codes', render: (v) => (v as string[]).join(', ') },
  },
  errors: [
    {
      reason: 'no_parks_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The API returned zero records for every requested code.',
      recovery:
        'None of the requested park codes resolved. Use nps_find_parks to look up the correct 4-letter code (e.g. "grca" for Grand Canyon).',
    },
  ],

  async handler(input, ctx) {
    const parks = await getNpsService().getParks(input.parkCode, input.fields, ctx);

    if (parks.length === 0) {
      throw ctx.fail('no_parks_found', `No parks resolved for ${input.parkCode.length} code(s).`, {
        requestedCodes: input.parkCode,
        ...ctx.recoveryFor('no_parks_found'),
      });
    }

    const returnedCodes = new Set(parks.map((p) => p.parkCode));
    const missing = input.parkCode.filter((c) => !returnedCodes.has(c));

    ctx.enrich({ requestedCount: input.parkCode.length, returnedCount: parks.length });
    if (missing.length > 0) {
      ctx.enrich({ missingCodes: missing });
      ctx.enrich.notice(
        `Codes not found: ${missing.join(', ')}. Verify with nps_find_parks — codes are 4-letter lowercase like "yose".`,
      );
    }
    ctx.log.info('Fetched park detail', {
      requested: input.parkCode.length,
      returned: parks.length,
    });

    return { parks };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const p of result.parks) {
      lines.push(`# ${p.fullName} (${p.parkCode})`);
      lines.push(`**${p.designation || 'NPS site'}** · States: ${p.states || 'n/a'}`);
      if (p.description) lines.push('', p.description);
      if (p.activities?.length) lines.push('', `**Activities:** ${p.activities.join(', ')}`);
      if (p.topics?.length) lines.push(`**Topics:** ${p.topics.join(', ')}`);
      renderFees(lines, p);
      renderHours(lines, p);
      renderContacts(lines, p);
      if (p.directionsInfo) lines.push('', `**Directions:** ${p.directionsInfo}`);
      if (p.directionsUrl) lines.push(`[Directions page](${p.directionsUrl})`);
      if (p.weatherOverview) lines.push('', `**Weather:** ${p.weatherOverview}`);
      if (p.latitude != null && p.longitude != null) {
        lines.push(`**Coordinates:** ${p.latitude}, ${p.longitude}`);
      }
      if (p.images?.length) {
        lines.push('', '**Images:**');
        for (const img of p.images) {
          lines.push(`- ${img.title}: ![${img.altText}](${img.url})`);
        }
        if (p.imagesTruncated) {
          lines.push(
            '_The park has more images upstream than the representative set shown here — see the park page._',
          );
        }
      }
      if (p.url) lines.push('', `[Full park page](${p.url})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});

/** Rendered park shape — derived from the output schema so the format() helpers
 * type against exactly what the handler returns (no exactOptionalPropertyTypes
 * drift versus the hand-written domain type). */
type ParkDetailItem = z.infer<typeof npsGetPark.output>['parks'][number];

function renderFees(lines: string[], p: ParkDetailItem): void {
  if (p.entranceFees && p.entranceFees.length > 0) {
    lines.push('', '**Entrance fees:**');
    for (const f of p.entranceFees) lines.push(`- ${f.title}: $${f.cost} — ${f.description}`);
  }
  if (p.entrancePasses && p.entrancePasses.length > 0) {
    lines.push('', '**Passes:**');
    for (const f of p.entrancePasses) lines.push(`- ${f.title}: $${f.cost} — ${f.description}`);
  }
}

function renderHours(lines: string[], p: ParkDetailItem): void {
  if (!p.operatingHours || p.operatingHours.length === 0) return;
  lines.push('', '**Operating hours:**');
  for (const h of p.operatingHours) {
    lines.push(`- **${h.name}:** ${h.description}`);
    const sh = h.standardHours;
    lines.push(
      `  Mon ${sh.monday} · Tue ${sh.tuesday} · Wed ${sh.wednesday} · Thu ${sh.thursday} · Fri ${sh.friday} · Sat ${sh.saturday} · Sun ${sh.sunday}`,
    );
  }
}

function renderContacts(lines: string[], p: ParkDetailItem): void {
  if (!p.contacts) return;
  const phones = p.contacts.phoneNumbers.map(
    (n) => `${n.phoneNumber}${n.type ? ` (${n.type})` : ''}`,
  );
  const emails = p.contacts.emailAddresses.map((e) => e.emailAddress);
  if (phones.length > 0) lines.push('', `**Phone:** ${phones.join(', ')}`);
  if (emails.length > 0) lines.push(`**Email:** ${emails.join(', ')}`);
}

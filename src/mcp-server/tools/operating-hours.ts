/**
 * @fileoverview Shared MCP output schema and text rendering for NPS schedules.
 * @module mcp-server/tools/operating-hours
 */

import { z } from '@cyanheads/mcp-ts-core';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';

const weekdayHours = z.object({
  monday: z.string().describe('Monday hours, e.g. "All Day", "Closed", or "9:00AM - 5:00PM".'),
  tuesday: z.string().describe('Tuesday hours.'),
  wednesday: z.string().describe('Wednesday hours.'),
  thursday: z.string().describe('Thursday hours.'),
  friday: z.string().describe('Friday hours.'),
  saturday: z.string().describe('Saturday hours.'),
  sunday: z.string().describe('Sunday hours.'),
});

/** NPS schedules with a weekly baseline and any dated overrides. */
export const operatingHours = z.array(
  z
    .object({
      name: z.string().describe('Schedule name. Empty if unspecified.'),
      description: z.string().describe('Free-text hours or seasonality notes.'),
      standardHours: weekdayHours.describe(
        'Baseline hours by weekday. Empty weekday strings mean no hours were published for those days.',
      ),
      exceptions: z
        .array(
          z
            .object({
              name: z.string().describe('Exception name. Empty if unspecified.'),
              startDate: z
                .string()
                .describe('Start date as published by NPS. Empty if unspecified.'),
              endDate: z.string().describe('End date as published by NPS. Empty if unspecified.'),
              hours: weekdayHours
                .nullable()
                .describe(
                  'Exception hours by weekday, or null if no weekday hours were published.',
                ),
            })
            .describe('A dated exception to the weekly baseline.'),
        )
        .describe('Published exceptions to the weekly baseline. May be empty.'),
    })
    .describe('An operating schedule.'),
);

/** Append each schedule and its exceptions to the tool's text response. */
export function renderOperatingHours(
  lines: string[],
  schedules: z.infer<typeof operatingHours>,
): void {
  if (schedules.length === 0) return;
  lines.push('', '**Operating hours:**');
  for (const schedule of schedules) {
    lines.push(
      '',
      `**Schedule:** ${escapeMarkdownInline(schedule.name)}`,
      `**Notes:** ${escapeMarkdownInline(schedule.description)}`,
      `**Standard hours:** ${renderWeekdays(schedule.standardHours)}`,
    );
    for (const exception of schedule.exceptions) {
      lines.push(
        `**Exception:** ${escapeMarkdownInline(exception.name)} (${escapeMarkdownInline(exception.startDate || 'unknown')} to ${escapeMarkdownInline(exception.endDate || 'unknown')})`,
        exception.hours ? renderWeekdays(exception.hours) : 'Hours unknown',
      );
    }
  }
}

function renderWeekdays(hours: z.infer<typeof weekdayHours>): string {
  return Object.entries(hours)
    .map(
      ([day, value]) =>
        `${day.charAt(0).toUpperCase()}${day.slice(1, 3)} ${escapeMarkdownInline(value || 'unknown')}`,
    )
    .join(' · ');
}

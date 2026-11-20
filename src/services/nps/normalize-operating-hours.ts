/**
 * @fileoverview Shared normalization of weekly schedules and dated exceptions.
 * @module services/nps/normalize-operating-hours
 */

import type { NpsOperatingHours, NpsOperatingHoursRaw, NpsWeekdayHours } from './types.js';

function weekdayHours(hours: Partial<NpsWeekdayHours> | undefined): NpsWeekdayHours {
  return {
    monday: hours?.monday ?? '',
    tuesday: hours?.tuesday ?? '',
    wednesday: hours?.wednesday ?? '',
    thursday: hours?.thursday ?? '',
    friday: hours?.friday ?? '',
    saturday: hours?.saturday ?? '',
    sunday: hours?.sunday ?? '',
  };
}

/** Preserve published exceptions even when their weekday hours are unspecified. */
export function normalizeOperatingHours(schedule: NpsOperatingHoursRaw): NpsOperatingHours {
  return {
    name: schedule.name ?? '',
    description: schedule.description ?? '',
    standardHours: weekdayHours(schedule.standardHours),
    exceptions: (schedule.exceptions ?? []).map((exception) => {
      const hours = weekdayHours(exception.exceptionHours);
      return {
        name: exception.name ?? '',
        startDate: exception.startDate ?? '',
        endDate: exception.endDate ?? '',
        hours: Object.values(hours).some((day) => day.trim() !== '') ? hours : null,
      };
    }),
  };
}

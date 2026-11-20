---
name: national-parks-guide
description: Build NPS visit plans with nps_* tools when a trip involves camping, dated events, ambiguous park names, or nearby destinations. Check identity, access, and reservation evidence before turning discovery results into an itinerary.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.1"
---

## Scope

Use these tools to assess NPS destinations and assemble a visit plan. Campground records describe facilities and reservation arrangements; they do not report vacancies for travel dates or make bookings. Proximity, driving routes, and live forecasts require other sources.

## Identifiers

Carry the selected park's `parkCode` from `nps_find_parks` through the trip. Alert, campground, activity, and event IDs identify their own records; they are not substitutes for a park code.

## Gates

- Confirm the returned name, state, and designation match the intended destination before requesting related records. Search ranking cannot settle an ambiguous name: Glacier and Glacier Bay can both match "glacier".
- Check the selected park's alerts before recommending access-dependent activities. Read the affected location and condition, not just the category; a filtered search cannot establish that the whole park is clear.
- Check result notices and coverage before concluding something is absent. A partial result, an upstream warning, or an empty page beyond the matches cannot support that conclusion. An empty curated activity or event feed does not establish that the park offers nothing to do.
- Verify date-specific availability through the campground's reservation source before calling a campsite available. Reservable and first-come counts describe inventory, not remaining sites.
- Compare the rig and trailer lengths with the published limits. Check the electrical-hookup count and confirm the specific site, amperage, water, and sewer requirements on the campground or booking page.
- Use `occurrenceDates` to schedule a program and `cancelledDates` to identify a cancelled visit date. An empty occurrence list alone gives no reason for the absence.

## Workflows

### Camping feasibility

Resolve the destination, then compare park alerts and campground exceptions with the visit dates. An exception may list open hours during a primitive season or a named closure with unspecified weekday hours. Read its name, dates, and hours together. Match the rig and site requirements, then use the reservation source to check vacancies.

### A dated visit

Read the dated exceptions for the entrance or area the visitor will use. Check which category a quoted fee covers and consult the activity’s pet and permit guidance. For scheduled programs, match the visit date and time, then check `registrationRequired` and the registration instructions even when there is no booking link. Review alerts for conflicts.

### Nearby destinations

Discover NPS candidates in the relevant area, then use a mapping source to compare proximity and travel routes. Search order is not distance order. Park-level coordinates do not identify a particular entrance, campground, or trailhead; use the destination's directions and specific location before calculating an arrival route. If coordinates are missing, resolve the location through a mapping source rather than inventing a point.

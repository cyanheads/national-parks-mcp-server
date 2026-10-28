---
name: national-parks-guide
description: Build NPS visit plans with nps_* tools when a trip involves camping, dated events, ambiguous park names, or nearby destinations. Check identity, access, and reservation evidence before turning discovery results into an itinerary.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
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
- Verify hookup requirements on the campground's linked page. RV permission, a dump station, and potable water do not establish an RV hookup.
- Place a recurring event on the itinerary only when its returned occurrence dates include the visit date. A series anchor is not evidence of an occurrence that day; an empty occurrence list does not establish cancellation.

## Workflows

### Camping feasibility

Resolve the destination, then combine park access alerts with campground records. Compare the user's actual requirements against amenities, accessibility text, reservation guidance, and linked campground details. Keep unknown amenities unresolved. Present suitable candidates with their reservation links, separating facility suitability from availability for the requested dates.

### A dated visit

Combine park hours and fees with curated activities, then search scheduled events for the visit window. Curated activities suggest what to do; they are not scheduled ranger programs. Use event occurrence dates and time slots to place programs, and keep missing times unresolved. Check registration links before describing a program as ready to attend. Review alerts for conflicts with the proposed locations and activities.

### Nearby destinations

Discover NPS candidates in the relevant area, then use a mapping source to compare proximity and travel routes. Search order is not distance order. Park-level coordinates do not identify a particular entrance, campground, or trailhead; use the destination's directions and specific location before calculating an arrival route. If coordinates are missing, resolve the location through a mapping source rather than inventing a point.

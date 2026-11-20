/**
 * @fileoverview Domain types for the NPS Data API service. Two layers:
 * raw upstream shapes (`Nps*Raw`) that reflect the API's real, string-heavy,
 * sparse payloads, and normalized domain shapes the service returns to tool
 * handlers (numbers/booleans coerced, empty strings → null, HTML stripped).
 * @module services/nps/types
 */

/* ------------------------------------------------------------------------- *
 * Shared parameter shapes
 * ------------------------------------------------------------------------- */

/** Common pagination/filter params for the array-param endpoints. */
export interface NpsListParams {
  /** Max results (`limit`). */
  limit: number;
  /** Comma-separated park codes (already validated/joined by the handler). */
  parkCode?: string | undefined;
  /** Free-text query (`q`). */
  query?: string | undefined;
  /** Zero-based offset (`start`). */
  start?: number | undefined;
  /** Comma-separated state codes. */
  stateCode?: string | undefined;
}

/** Params for `/thingstodo` — single-string parkCode/stateCode. */
export interface NpsThingsToDoParams {
  limit: number;
  parkCode?: string | undefined;
  query?: string | undefined;
  start?: number | undefined;
  stateCode?: string | undefined;
}

/** Params for `/events` — page-based pagination + date window. */
export interface NpsEventsParams {
  dateEnd?: string | undefined;
  dateStart?: string | undefined;
  pageNumber: number;
  pageSize: number;
  parkCode?: string | undefined;
  query?: string | undefined;
  stateCode?: string | undefined;
}

/** Normalized envelope returned by list methods: data + the true total. */
export interface NpsListResult<T> {
  data: T[];
  /** Total matches upstream before the limit (coerced from the string envelope). */
  total: number;
}

/* ------------------------------------------------------------------------- *
 * Raw upstream record shapes (string-heavy, sparse — trust nothing)
 * ------------------------------------------------------------------------- */

export interface NpsIdName {
  id?: string;
  name?: string;
}

export interface NpsEntranceFeeRaw {
  cost?: string;
  description?: string;
  title?: string;
}

export type NpsWeekdayHours = Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  string
>;

export interface NpsOperatingHoursRaw {
  description?: string;
  exceptions?: {
    name?: string;
    startDate?: string;
    endDate?: string;
    exceptionHours?: Partial<NpsWeekdayHours>;
  }[];
  name?: string;
  standardHours?: Partial<NpsWeekdayHours>;
}

export interface NpsImageRaw {
  altText?: string;
  caption?: string;
  title?: string;
  url?: string;
}

export interface NpsParkRaw {
  activities?: NpsIdName[];
  contacts?: {
    phoneNumbers?: { phoneNumber?: string; type?: string }[];
    emailAddresses?: { emailAddress?: string }[];
  };
  description?: string;
  designation?: string;
  directionsInfo?: string;
  directionsUrl?: string;
  entranceFees?: NpsEntranceFeeRaw[];
  entrancePasses?: NpsEntranceFeeRaw[];
  fullName?: string;
  images?: NpsImageRaw[];
  latitude?: string;
  longitude?: string;
  name?: string;
  operatingHours?: NpsOperatingHoursRaw[];
  parkCode?: string;
  states?: string;
  topics?: NpsIdName[];
  url?: string;
  weatherInfo?: string;
}

export interface NpsAlertRaw {
  category?: string;
  description?: string;
  id?: string;
  lastIndexedDate?: string;
  parkCode?: string;
  title?: string;
  url?: string;
}

export interface NpsCampgroundRaw {
  accessibility?: {
    adaInfo?: string;
    rvAllowed?: string;
    rvMaxLength?: string;
    trailerMaxLength?: string;
  };
  amenities?: {
    potableWater?: string[];
    showers?: string[];
    toilets?: string[];
    dumpStation?: string;
    trashRecyclingCollection?: string;
  };
  campsites?: {
    electricalHookups?: string;
    group?: string;
    horse?: string;
    rvOnly?: string;
    tentOnly?: string;
    totalSites?: string;
    walkBoatTo?: string;
  };
  description?: string;
  fees?: NpsEntranceFeeRaw[];
  id?: string;
  latitude?: string;
  longitude?: string;
  name?: string;
  numberOfSitesFirstComeFirstServe?: string;
  numberOfSitesReservable?: string;
  operatingHours?: NpsOperatingHoursRaw[];
  parkCode?: string;
  reservationInfo?: string;
  reservationUrl?: string;
  url?: string;
}

export interface NpsThingToDoRaw {
  accessibilityInformation?: string;
  arePetsPermitted?: string;
  duration?: string;
  durationDescription?: string;
  feeDescription?: string;
  id?: string;
  isReservationRequired?: string;
  latitude?: string;
  location?: string;
  longitude?: string;
  petsDescription?: string;
  relatedParks?: { parkCode?: string }[];
  reservationDescription?: string;
  season?: string[];
  shortDescription?: string;
  title?: string;
  url?: string;
}

export interface NpsEventRaw {
  cancelleddatelist?: (string | null)[];
  category?: string;
  dateend?: string;
  /** Every occurrence date (YYYY-MM-DD) NPS still lists — from today through
   * `recurrencedateend`, independent of the requested window. */
  dates?: string[];
  datestart?: string;
  description?: string;
  eventid?: string;
  feeinfo?: string;
  id?: string;
  infourl?: string;
  isfree?: string;
  /** "true"/"false" — whether this event is a recurring series. */
  isrecurring?: string;
  isregresrequired?: string;
  location?: string;
  regresinfo?: string;
  regresurl?: string;
  sitecode?: string;
  times?: {
    timestart?: string;
    timeend?: string;
    sunrisestart?: string;
    sunsetend?: string;
  }[];
  title?: string;
}

/** The `/events` envelope differs from the rest of the API. */
export interface NpsEventsEnvelopeRaw {
  data?: NpsEventRaw[];
  errors?: unknown[];
  pagenumber?: string;
  pagesize?: string;
  total?: string;
}

/** The standard envelope for `/parks`, `/alerts`, `/campgrounds`, `/thingstodo`. */
export interface NpsStandardEnvelopeRaw<T> {
  data?: T[];
  limit?: string;
  start?: string;
  total?: string;
}

/** NPS error envelope returned on 403 (and some 4xx). */
export interface NpsErrorEnvelopeRaw {
  error?: { code?: string; message?: string };
}

/* ------------------------------------------------------------------------- *
 * Normalized domain shapes (what the service returns to handlers)
 * ------------------------------------------------------------------------- */

export interface NpsParkSummary {
  activities: string[];
  description: string;
  designation: string;
  entranceFee: string | null;
  entranceFeeTitle: string | null;
  fullName: string;
  latitude: number | null;
  longitude: number | null;
  parkCode: string;
  states: string;
  url: string;
}

export interface NpsFeeEntry {
  cost: string;
  description: string;
  title: string;
}

export interface NpsOperatingHours {
  description: string;
  exceptions: {
    name: string;
    startDate: string;
    endDate: string;
    hours: NpsWeekdayHours | null;
  }[];
  name: string;
  standardHours: NpsWeekdayHours;
}

export interface NpsParkImage {
  altText: string;
  title: string;
  url: string;
}

export interface NpsParkContacts {
  emailAddresses: { emailAddress: string }[];
  phoneNumbers: { phoneNumber: string; type: string }[];
}

/** Full park detail. Optional sections are omitted when `fields` excludes them. */
export interface NpsParkDetail {
  activities?: string[];
  contacts?: NpsParkContacts;
  description: string;
  designation: string;
  /** Present only when the `directions` section is included; null when NPS has none. */
  directionsInfo?: string | null;
  directionsUrl?: string | null;
  entranceFees?: NpsFeeEntry[];
  entrancePasses?: NpsFeeEntry[];
  fullName: string;
  images?: NpsParkImage[];
  /** True when the upstream image list was longer than the returned cap
   * (`MAX_IMAGES_PER_PARK`). Present only when the `images` section is included;
   * the park's `url` is the path to the full set. */
  imagesTruncated?: boolean;
  latitude: number | null;
  longitude: number | null;
  operatingHours?: NpsOperatingHours[];
  parkCode: string;
  states: string;
  topics?: string[];
  url: string;
  weatherOverview: string | null;
}

export type NpsParkDetailSection =
  | 'activities'
  | 'topics'
  | 'fees'
  | 'hours'
  | 'contacts'
  | 'directions'
  | 'images';

export interface NpsAlert {
  category: string;
  description: string;
  id: string;
  lastIndexedDate: string | null;
  parkCode: string;
  title: string;
  url: string | null;
}

/** Each amenity is true/false, or null when NPS published no value for it. */
export interface NpsCampgroundAmenities {
  dumpStation: boolean | null;
  potableWater: boolean | null;
  rvAllowed: boolean | null;
  showers: boolean | null;
  toilets: boolean | null;
  trashCollection: boolean | null;
}

export interface NpsCampground {
  accessibility: string | null;
  amenities: NpsCampgroundAmenities;
  description: string;
  electricalHookupSites: number | null;
  fee: string | null;
  feeTitle: string | null;
  firstComeSites: number | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  operatingHours: NpsOperatingHours[];
  parkCode: string;
  reservableSites: number | null;
  reservationInfo: string | null;
  reservationUrl: string | null;
  rvMaxLengthFt: number | null;
  siteTypes: {
    tentOnly: number | null;
    rvOnly: number | null;
    group: number | null;
    walkBoatTo: number | null;
    horse: number | null;
  };
  totalSites: number | null;
  trailerMaxLengthFt: number | null;
  url: string | null;
}

export interface NpsThingToDo {
  accessibility: string | null;
  duration: string | null;
  feeDescription: string | null;
  id: string;
  latitude: number | null;
  location: string | null;
  longitude: number | null;
  parkCode: string | null;
  petsDescription: string | null;
  petsPermitted: boolean;
  reservationDescription: string | null;
  reservationRequired: boolean;
  season: string[];
  shortDescription: string;
  title: string;
  url: string | null;
}

export interface NpsEventTime {
  timeEnd: string;
  timeStart: string;
}

export interface NpsEvent {
  cancelledDates: string[];
  category: string | null;
  dateEnd: string | null;
  dateStart: string | null;
  description: string;
  feeInfo: string | null;
  id: string;
  infoUrl: string | null;
  isFree: boolean;
  /** True when this is a recurring series (multiple occurrence dates). */
  isRecurring: boolean;
  location: string | null;
  /** Occurrence dates (YYYY-MM-DD) intersected with the requested window; all
   * remaining occurrences when no window was requested. See NpsService.normalizeEvent. */
  occurrenceDates: string[];
  parkCode: string | null;
  registrationInfo: string | null;
  registrationRequired: boolean | null;
  registrationUrl: string | null;
  times: NpsEventTime[];
  title: string;
}

/** Events result carries the envelope's `errors[]` so the handler can warn. */
export interface NpsEventsResult extends NpsListResult<NpsEvent> {
  errors: string[];
}

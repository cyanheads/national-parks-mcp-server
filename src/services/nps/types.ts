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

export interface NpsOperatingHoursRaw {
  description?: string;
  name?: string;
  standardHours?: Partial<Record<string, string>>;
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
  };
  amenities?: {
    potableWater?: string[];
    showers?: string[];
    toilets?: string[];
    dumpStation?: string;
    trashRecyclingCollection?: string;
  };
  campsites?: { totalSites?: string };
  description?: string;
  fees?: { cost?: string; title?: string; description?: string }[];
  id?: string;
  latitude?: string;
  longitude?: string;
  name?: string;
  numberOfSitesFirstComeFirstServe?: string;
  numberOfSitesReservable?: string;
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
  relatedParks?: { parkCode?: string }[];
  season?: string[];
  shortDescription?: string;
  title?: string;
  url?: string;
}

export interface NpsEventRaw {
  category?: string;
  dateend?: string;
  datestart?: string;
  description?: string;
  eventid?: string;
  feeinfo?: string;
  id?: string;
  infourl?: string;
  isfree?: string;
  location?: string;
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
  name: string;
  standardHours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
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
  directionsInfo: string | null;
  directionsUrl: string | null;
  entranceFees?: NpsFeeEntry[];
  entrancePasses?: NpsFeeEntry[];
  fullName: string;
  images?: NpsParkImage[];
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

export interface NpsCampgroundAmenities {
  dumpStation: boolean;
  potableWater: boolean;
  rvAllowed: boolean;
  showers: boolean;
  toilets: boolean;
  trashCollection: boolean;
}

export interface NpsCampground {
  accessibility: string | null;
  amenities: NpsCampgroundAmenities;
  description: string;
  fee: string | null;
  firstComeSites: number | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  parkCode: string;
  reservableSites: number | null;
  reservationInfo: string | null;
  reservationUrl: string | null;
  totalSites: number | null;
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
  petsPermitted: boolean;
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
  category: string | null;
  dateEnd: string | null;
  dateStart: string | null;
  description: string;
  feeInfo: string | null;
  id: string;
  infoUrl: string | null;
  isFree: boolean;
  location: string | null;
  parkCode: string | null;
  registrationUrl: string | null;
  times: NpsEventTime[];
  title: string;
}

/** Events result carries the envelope's `errors[]` so the handler can warn. */
export interface NpsEventsResult extends NpsListResult<NpsEvent> {
  errors: string[];
}

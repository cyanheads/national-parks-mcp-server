/**
 * @fileoverview NPS Data API service — wraps `developer.nps.gov/api/v1`
 * (X-Api-Key auth) for the six trip-planning tools. Owns the retry boundary,
 * the NPS error-envelope detection, and ALL upstream normalization: the API
 * returns many numeric/boolean fields as strings, nests some values, and uses
 * a distinct envelope + lowercased field names for `/events`. Every coercion
 * the tools depend on lives here so handlers receive clean domain types.
 * @module services/nps/nps-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, serviceUnavailable, unauthorized } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, requestContextService, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import type {
  NpsAlert,
  NpsAlertRaw,
  NpsCampground,
  NpsCampgroundRaw,
  NpsEvent,
  NpsEventRaw,
  NpsEventsEnvelopeRaw,
  NpsEventsParams,
  NpsEventsResult,
  NpsFeeEntry,
  NpsListParams,
  NpsListResult,
  NpsParkDetail,
  NpsParkDetailSection,
  NpsParkRaw,
  NpsParkSummary,
  NpsStandardEnvelopeRaw,
  NpsThingsToDoParams,
  NpsThingToDo,
  NpsThingToDoRaw,
} from './types.js';

const REQUEST_TIMEOUT_MS = 12_000;
/** NPS is fast and rarely rate-limits; a short backoff suffices. */
const RETRY_BASE_DELAY_MS = 500;
/** Park records are large — cap images per park in the detail tool. */
const MAX_IMAGES_PER_PARK = 5;

/* ------------------------------------------------------------------------- *
 * Coercion helpers — the single reference for NPS's string-typed fields.
 * ------------------------------------------------------------------------- */

/** NPS returns lat/lng (and other numerics) as strings; empty → null. */
function toFloat(value: string | undefined | null): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

/** Integer coercion for site counts; empty/non-numeric → null. */
function toInt(value: string | undefined | null): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/** NPS boolean-flavored fields arrive as the strings "true"/"false" or "1"/"0". */
function toBool(value: string | undefined | null): boolean {
  return value === 'true' || value === '1';
}

/** Normalize an empty-or-missing string to null; trims whitespace. */
function emptyToNull(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Negative sentinels NPS uses across amenity fields to mean "not available".
 * `toilets`/`showers` are TYPE-described (`"Flush Toilets - seasonal"`,
 * `"Hot - Year Round"`) and never start with "Yes", so a "starts-with-Yes"
 * test wrongly reports them absent. Presence = any element that isn't blank
 * and isn't one of these negatives.
 */
const AMENITY_NEGATIVES = new Set(['none', 'no', 'no water', 'not available', 'n/a']);

/** True if the value is blank or a known "not available" sentinel. */
function isAmenityNegative(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || AMENITY_NEGATIVES.has(v);
}

/**
 * NPS array amenity fields (`potableWater`, `showers`, `toilets`) list the
 * amenity's type/season (e.g. ["Flush Toilets - year round"], ["Hot - Seasonal"],
 * ["Yes - seasonal"]) or a negative (["None"], ["No water"]). The amenity is
 * present when any element is a real value rather than a negative sentinel.
 */
function hasAmenity(value: string[] | undefined | null): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((v) => typeof v === 'string' && !isAmenityNegative(v));
}

/** A string amenity field (`dumpStation`, `trashRecyclingCollection`) → boolean.
 * Values are "Yes"/"Yes - seasonal"/"No"; present unless blank or a negative. */
function hasStringAmenity(value: string | undefined | null): boolean {
  return typeof value === 'string' && !isAmenityNegative(value);
}

/** Strip HTML tags and decode the handful of entities NPS emits, to plain text. */
function stripHtml(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract `.name` strings from NPS `[{id, name}]` arrays. */
function names(items: { name?: string }[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => i.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/** Alert `lastIndexedDate` is "YYYY-MM-DD 00:00:00.0"; keep the date only. */
function dateOnly(value: string | undefined | null): string | null {
  const v = emptyToNull(value);
  if (!v) return null;
  const match = v.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : v;
}

function mapFees(
  fees: { cost?: string; title?: string; description?: string }[] | undefined,
): NpsFeeEntry[] {
  if (!Array.isArray(fees)) return [];
  return fees.map((f) => ({
    cost: f.cost ?? '',
    title: f.title ?? '',
    description: f.description ?? '',
  }));
}

/* ------------------------------------------------------------------------- *
 * Service
 * ------------------------------------------------------------------------- */

export class NpsService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ServerConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  /** Resolve a place/state/query to park summaries. `GET /parks`. */
  async findParks(params: NpsListParams, ctx: Context): Promise<NpsListResult<NpsParkSummary>> {
    const query = this.buildQuery({
      q: params.query,
      stateCode: params.stateCode,
      limit: params.limit,
      start: params.start,
    });
    const env = await this.get<NpsStandardEnvelopeRaw<NpsParkRaw>>('/parks', query, ctx);
    return {
      total: toInt(env.total) ?? env.data?.length ?? 0,
      data: (env.data ?? []).map((p) => this.normalizeParkSummary(p)),
    };
  }

  /** Batched full detail for up to 10 park codes in one call. `GET /parks`. */
  async getParks(
    parkCodes: string[],
    fields: NpsParkDetailSection[] | undefined,
    ctx: Context,
  ): Promise<NpsParkDetail[]> {
    const query = this.buildQuery({
      parkCode: parkCodes.join(','),
      limit: parkCodes.length,
    });
    const env = await this.get<NpsStandardEnvelopeRaw<NpsParkRaw>>('/parks', query, ctx);
    return (env.data ?? []).map((p) => this.normalizeParkDetail(p, fields));
  }

  /** Current alerts for park(s)/state(s). `GET /alerts`. */
  async getAlerts(params: NpsListParams, ctx: Context): Promise<NpsListResult<NpsAlert>> {
    const query = this.buildQuery({
      q: params.query,
      parkCode: params.parkCode,
      stateCode: params.stateCode,
      limit: params.limit,
    });
    const env = await this.get<NpsStandardEnvelopeRaw<NpsAlertRaw>>('/alerts', query, ctx);
    return {
      total: toInt(env.total) ?? env.data?.length ?? 0,
      data: (env.data ?? []).map((a) => this.normalizeAlert(a)),
    };
  }

  /** Campgrounds for park(s)/state(s). `GET /campgrounds`. */
  async findCampgrounds(
    params: NpsListParams,
    ctx: Context,
  ): Promise<NpsListResult<NpsCampground>> {
    const query = this.buildQuery({
      q: params.query,
      parkCode: params.parkCode,
      stateCode: params.stateCode,
      limit: params.limit,
      start: params.start,
    });
    const env = await this.get<NpsStandardEnvelopeRaw<NpsCampgroundRaw>>(
      '/campgrounds',
      query,
      ctx,
    );
    return {
      total: toInt(env.total) ?? env.data?.length ?? 0,
      data: (env.data ?? []).map((c) => this.normalizeCampground(c)),
    };
  }

  /** Curated things to do. `GET /thingstodo` (single-string parkCode/stateCode). */
  async getThingsToDo(
    params: NpsThingsToDoParams,
    ctx: Context,
  ): Promise<NpsListResult<NpsThingToDo>> {
    const query = this.buildQuery({
      q: params.query,
      parkCode: params.parkCode,
      stateCode: params.stateCode,
      limit: params.limit,
      start: params.start,
    });
    const env = await this.get<NpsStandardEnvelopeRaw<NpsThingToDoRaw>>('/thingstodo', query, ctx);
    return {
      total: toInt(env.total) ?? env.data?.length ?? 0,
      data: (env.data ?? []).map((t) => this.normalizeThingToDo(t)),
    };
  }

  /** Scheduled events within a date window. `GET /events` (distinct envelope). */
  async findEvents(params: NpsEventsParams, ctx: Context): Promise<NpsEventsResult> {
    const query = this.buildQuery({
      q: params.query,
      parkCode: params.parkCode,
      stateCode: params.stateCode,
      dateStart: params.dateStart,
      dateEnd: params.dateEnd,
      pageSize: params.pageSize,
      pageNumber: params.pageNumber,
    });
    const env = await this.get<NpsEventsEnvelopeRaw>('/events', query, ctx);
    const errors = Array.isArray(env.errors)
      ? env.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).filter(Boolean)
      : [];
    return {
      total: toInt(env.total) ?? env.data?.length ?? 0,
      data: (env.data ?? []).map((e) => this.normalizeEvent(e)),
      errors,
    };
  }

  /* ----------------------------------------------------------------------- *
   * Normalization
   * ----------------------------------------------------------------------- */

  private normalizeParkSummary(p: NpsParkRaw): NpsParkSummary {
    const firstFee = p.entranceFees?.[0]?.cost;
    return {
      parkCode: p.parkCode ?? '',
      fullName: p.fullName ?? p.name ?? '',
      designation: p.designation ?? '',
      states: p.states ?? '',
      description: p.description ?? '',
      latitude: toFloat(p.latitude),
      longitude: toFloat(p.longitude),
      activities: names(p.activities),
      entranceFee: emptyToNull(firstFee),
      url: p.url ?? '',
    };
  }

  private normalizeParkDetail(
    p: NpsParkRaw,
    fields: NpsParkDetailSection[] | undefined,
  ): NpsParkDetail {
    const include = (section: NpsParkDetailSection): boolean => !fields || fields.includes(section);

    const detail: NpsParkDetail = {
      parkCode: p.parkCode ?? '',
      fullName: p.fullName ?? p.name ?? '',
      designation: p.designation ?? '',
      states: p.states ?? '',
      description: p.description ?? '',
      latitude: toFloat(p.latitude),
      longitude: toFloat(p.longitude),
      weatherOverview: emptyToNull(p.weatherInfo),
      directionsInfo: include('directions') ? emptyToNull(p.directionsInfo) : null,
      directionsUrl: include('directions') ? emptyToNull(p.directionsUrl) : null,
      url: p.url ?? '',
    };

    if (include('activities')) detail.activities = names(p.activities);
    if (include('topics')) detail.topics = names(p.topics);
    if (include('fees')) {
      detail.entranceFees = mapFees(p.entranceFees);
      detail.entrancePasses = mapFees(p.entrancePasses);
    }
    if (include('hours')) {
      detail.operatingHours = (p.operatingHours ?? []).map((h) => ({
        name: h.name ?? '',
        description: h.description ?? '',
        standardHours: {
          monday: h.standardHours?.monday ?? '',
          tuesday: h.standardHours?.tuesday ?? '',
          wednesday: h.standardHours?.wednesday ?? '',
          thursday: h.standardHours?.thursday ?? '',
          friday: h.standardHours?.friday ?? '',
          saturday: h.standardHours?.saturday ?? '',
          sunday: h.standardHours?.sunday ?? '',
        },
      }));
    }
    if (include('contacts')) {
      detail.contacts = {
        phoneNumbers: (p.contacts?.phoneNumbers ?? []).map((n) => ({
          phoneNumber: n.phoneNumber ?? '',
          type: n.type ?? '',
        })),
        emailAddresses: (p.contacts?.emailAddresses ?? []).map((e) => ({
          emailAddress: e.emailAddress ?? '',
        })),
      };
    }
    if (include('images')) {
      detail.images = (p.images ?? []).slice(0, MAX_IMAGES_PER_PARK).map((img) => ({
        url: img.url ?? '',
        altText: img.altText ?? img.caption ?? '',
        title: img.title ?? '',
      }));
    }

    return detail;
  }

  private normalizeAlert(a: NpsAlertRaw): NpsAlert {
    return {
      id: a.id ?? '',
      parkCode: a.parkCode ?? '',
      category: a.category ?? '',
      title: a.title ?? '',
      description: a.description ?? '',
      url: emptyToNull(a.url),
      lastIndexedDate: dateOnly(a.lastIndexedDate),
    };
  }

  private normalizeCampground(c: NpsCampgroundRaw): NpsCampground {
    return {
      id: c.id ?? '',
      name: c.name ?? '',
      parkCode: c.parkCode ?? '',
      description: c.description ?? '',
      latitude: toFloat(c.latitude),
      longitude: toFloat(c.longitude),
      totalSites: toInt(c.campsites?.totalSites),
      reservableSites: toInt(c.numberOfSitesReservable),
      firstComeSites: toInt(c.numberOfSitesFirstComeFirstServe),
      reservationInfo: emptyToNull(c.reservationInfo),
      reservationUrl: emptyToNull(c.reservationUrl),
      fee: emptyToNull(c.fees?.[0]?.cost),
      amenities: {
        potableWater: hasAmenity(c.amenities?.potableWater),
        showers: hasAmenity(c.amenities?.showers),
        toilets: hasAmenity(c.amenities?.toilets),
        dumpStation: hasStringAmenity(c.amenities?.dumpStation),
        trashCollection: hasStringAmenity(c.amenities?.trashRecyclingCollection),
        rvAllowed: toBool(c.accessibility?.rvAllowed),
      },
      accessibility: emptyToNull(c.accessibility?.adaInfo),
      url: emptyToNull(c.url),
    };
  }

  private normalizeThingToDo(t: NpsThingToDoRaw): NpsThingToDo {
    return {
      id: t.id ?? '',
      title: t.title ?? '',
      parkCode: emptyToNull(t.relatedParks?.[0]?.parkCode),
      shortDescription: stripHtml(t.shortDescription),
      location: emptyToNull(t.location),
      latitude: toFloat(t.latitude),
      longitude: toFloat(t.longitude),
      duration: emptyToNull(t.duration),
      reservationRequired: toBool(t.isReservationRequired),
      feeDescription: emptyToNull(stripHtml(t.feeDescription)),
      petsPermitted: toBool(t.arePetsPermitted),
      accessibility: emptyToNull(stripHtml(t.accessibilityInformation)),
      season: Array.isArray(t.season)
        ? t.season.filter((s): s is string => typeof s === 'string')
        : [],
      url: emptyToNull(t.url),
    };
  }

  private normalizeEvent(e: NpsEventRaw): NpsEvent {
    return {
      id: e.id ?? e.eventid ?? '',
      title: e.title ?? '',
      parkCode: emptyToNull(e.sitecode),
      description: stripHtml(e.description),
      location: emptyToNull(e.location),
      dateStart: emptyToNull(e.datestart),
      dateEnd: emptyToNull(e.dateend),
      times: (e.times ?? [])
        .filter((t) => t.timestart || t.timeend)
        .map((t) => ({ timeStart: t.timestart ?? '', timeEnd: t.timeend ?? '' })),
      category: emptyToNull(e.category),
      isFree: toBool(e.isfree),
      feeInfo: emptyToNull(e.feeinfo),
      registrationUrl: emptyToNull(e.regresurl),
      infoUrl: emptyToNull(e.infourl),
    };
  }

  /* ----------------------------------------------------------------------- *
   * HTTP
   * ----------------------------------------------------------------------- */

  /**
   * GET an endpoint with the X-Api-Key header, retrying transient failures.
   * The retry boundary wraps the full fetch+parse pipeline. Non-OK responses
   * are surfaced as clear errors — the NPS error envelope (bad/missing key) is
   * detected and reported against `NPS_API_KEY` rather than as a generic 403.
   */
  private get<T>(path: string, query: URLSearchParams, ctx: Context): Promise<T> {
    const url = `${this.baseUrl}${path}?${this.encodeQuery(query)}`;
    const reqCtx = requestContextService.createRequestContext({
      operation: `NpsService.get ${path}`,
      requestId: ctx.requestId,
    });
    return withRetry(
      async () => {
        let response: Response;
        try {
          response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, reqCtx, {
            signal: ctx.signal,
            headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
          });
        } catch (err) {
          // fetchWithTimeout throws a classified McpError on non-OK responses.
          // A 401/403 here almost always means the API key is wrong/missing —
          // re-frame it against NPS_API_KEY so the failure is actionable.
          throw this.reframeAuthError(err);
        }
        const text = await response.text();
        return this.parseBody<T>(text);
      },
      {
        operation: `NpsService.get ${path}`,
        context: reqCtx,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        signal: ctx.signal,
      },
    );
  }

  private parseBody<T>(text: string): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw serviceUnavailable(
        'NPS API returned a non-JSON response — likely a transient upstream error.',
      );
    }
    // Some NPS errors come back as 200/4xx with an { error: { code } } envelope.
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const code = (parsed as { error?: { code?: string } }).error?.code;
      if (code === 'API_KEY_INVALID' || code === 'API_KEY_MISSING') {
        throw unauthorized(
          'NPS API key is missing or invalid. Set NPS_API_KEY to a valid key (free signup at https://www.nps.gov/subjects/developer/get-started.htm).',
          { code },
        );
      }
      if (code) {
        throw serviceUnavailable(`NPS API returned an error: ${code}.`, { code });
      }
    }
    return parsed as T;
  }

  private reframeAuthError(err: unknown): unknown {
    const code = (err as { code?: unknown })?.code;
    if (code === JsonRpcErrorCode.Unauthorized || code === JsonRpcErrorCode.Forbidden) {
      return unauthorized(
        'NPS API rejected the request (401/403) — NPS_API_KEY is likely missing or invalid. Get a free key at https://www.nps.gov/subjects/developer/get-started.htm.',
        { cause: err },
      );
    }
    return err;
  }

  /** Build a query string, skipping empty/undefined params. */
  private buildQuery(params: Record<string, string | number | undefined>): URLSearchParams {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      search.set(key, String(value));
    }
    return search;
  }

  /**
   * Serialize the query string with literal commas. `URLSearchParams.toString()`
   * percent-encodes commas to `%2C`, but NPS array params (`parkCode`,
   * `stateCode`) require a literal `,` separator — given `%2C` the API treats
   * the whole encoded blob as one malformed token and silently drops every
   * value after the first (e.g. `parkCode=yose%2Czion` → only `yose`). Restore
   * `,` after encoding so multi-value batches resolve; all other reserved
   * characters stay encoded.
   */
  private encodeQuery(query: URLSearchParams): string {
    return query.toString().replace(/%2C/gi, ',');
  }
}

/* ------------------------------------------------------------------------- *
 * Init/accessor
 * ------------------------------------------------------------------------- */

let _service: NpsService | undefined;

export function initNpsService(config: ServerConfig): void {
  _service = new NpsService(config);
}

export function getNpsService(): NpsService {
  if (!_service) {
    throw new Error('NpsService not initialized — call initNpsService() in setup()');
  }
  return _service;
}

import type {
  NtopInterface,
  NtopTimeseries,
  NtopAlertList,
  NtopTopTalker,
  NtopL4Counter,
  NtopAlertSeverityCounter,
  NtopConfig,
  NtopAlertPage,
  NtopAlert,
} from '../types/ntopng';

// ─── Config ───────────────────────────────────────────────────────────────────

const LS_KEYS = {
  token:   'ntopng_token',
  ifid:    'ntopng_ifid',
  baseUrl: 'ntopng_base_url',
} as const;

export function getConfig(): NtopConfig {
  return {
    baseUrl: localStorage.getItem(LS_KEYS.baseUrl)
          || import.meta.env.VITE_NTOPNG_BASE_URL
          || 'https://flow-ntop.aquitelecom.com',
    token:   localStorage.getItem(LS_KEYS.token)
          || import.meta.env.VITE_NTOPNG_TOKEN
          || '',
    ifid:    Number(
               localStorage.getItem(LS_KEYS.ifid)
            ?? import.meta.env.VITE_NTOPNG_IFID
            ?? 0
             ),
  };
}

export function saveConfig(cfg: Partial<NtopConfig>): void {
  if (cfg.token   !== undefined) localStorage.setItem(LS_KEYS.token,   cfg.token);
  if (cfg.ifid    !== undefined) localStorage.setItem(LS_KEYS.ifid,    String(cfg.ifid));
  if (cfg.baseUrl !== undefined) localStorage.setItem(LS_KEYS.baseUrl, cfg.baseUrl);
}

// Sempre tenta — auth é injetada pelo proxy Vite via headers
export function isApiConfigured(): boolean { return true; }

// ─── Core fetch ───────────────────────────────────────────────────────────────
// Requests go through the Vite dev proxy at /ntopng-api  →  ntopng server.
// The proxy injects:  Authorization: Token …  +  CF_Authorization cookie.

async function rawFetch(
  path: string,
  params: Record<string, string | number> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`/ntopng-api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (res.status === 302 || res.status === 301) {
      const loc = res.headers.get('location') ?? '';
      if (loc.includes('login')) throw new Error('ntopng: token/sessão inválido');
      throw new Error(`Redirect inesperado → ${loc}`);
    }

    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && !ct.includes('application/json')) {
      throw new Error('ntopng: resposta não-JSON (endpoint Pro-only ou sessão expirada)');
    }

    if (!res.ok) {
      let errMsg = `HTTP ${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.rc_str) errMsg = `ntopng: ${j.rc_str}`;
        else if (j?.error) errMsg = j.error;
      } catch { /* keep status text */ }
      throw new Error(errMsg);
    }

    const json = await res.json() as Record<string, unknown>;
    if (json.rc !== undefined && json.rc !== 0)
      throw new Error(`ntopng: ${json.rc_str ?? `rc=${json.rc}`}`);

    return json;
  } finally {
    clearTimeout(tid);
  }
}

async function ntopFetch<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const json = await rawFetch(path, params);
  return json.rsp as T;
}

// Paginated endpoints: recordsTotal lives at the root, rsp.records has the rows
async function ntopFetchPaginated(
  path: string,
  params: Record<string, string | number> = {},
): Promise<{ records: unknown[]; recordsTotal: number }> {
  const json = await rawFetch(path, params);
  const rsp = (json.rsp ?? {}) as Record<string, unknown>;
  return {
    records:      (rsp.records as unknown[]) ?? [],
    recordsTotal: (json.recordsTotal as number) ?? 0,
  };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** ntopng v6 ZMQ/NetFlow interfaces use `ifid` and flat byte fields — normalize here */
function normalizeInterface(raw: Record<string, unknown>): NtopInterface {
  const bytesDownload = Number(raw.bytes_download ?? raw.bytes_download_since_reset ?? 0);
  const bytesUpload   = Number(raw.bytes_upload   ?? raw.bytes_upload_since_reset   ?? 0);
  const nestedBytes   = raw.bytes as { rcvd?: number; sent?: number } | undefined;

  return {
    id:              Number(raw.id ?? raw.ifid ?? 0),
    ifname:          String(raw.ifname ?? raw.name ?? ''),
    speed:           Number(raw.speed ?? 1000),
    epoch:           Number(raw.epoch ?? 0),
    is_view:         Boolean(raw.is_view),
    is_loopback:     Boolean(raw.is_loopback),
    is_up:           raw.is_up as boolean | undefined,
    num_flows:       Number(raw.num_flows ?? 0),
    num_hosts:       Number(raw.num_hosts ?? 0),
    num_local_hosts: Number(raw.num_local_hosts ?? 0),
    engaged_alerts:  Number(raw.engaged_alerts ?? 0),
    alerts_stored:   Number(raw.alerts_stored ?? raw.written_alerts ?? 0),
    bytes: {
      rcvd: nestedBytes?.rcvd ?? bytesDownload,
      sent: nestedBytes?.sent ?? bytesUpload,
    },
    packets: {
      rcvd: Number(raw.packets_download ?? (typeof raw.packets === 'object' ? (raw.packets as { rcvd?: number })?.rcvd : 0) ?? 0),
      sent: Number(raw.packets_upload   ?? (typeof raw.packets === 'object' ? (raw.packets as { sent?: number })?.sent : 0) ?? 0),
    },
    drops: { total: Number(raw.drops ?? raw.tot_pkt_drops ?? 0) },
    throughput_bps: Number(raw.throughput_bps ?? 0),
    throughput_pps: Number(raw.throughput_pps ?? 0),
    remote_bps:     Number(raw.remote_bps ?? 0),
  };
}

/** List all monitored interfaces */
export async function getInterfaces(): Promise<NtopInterface[]> {
  const raw = await ntopFetch<unknown>(
    '/lua/rest/v2/get/ntopng/interfaces.lua',
  );
  const list: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : ((raw as { interfaces?: Record<string, unknown>[] }).interfaces ?? []);
  return list.map(normalizeInterface);
}

/** Full stats for a single interface */
export async function getInterfaceData(ifid: number): Promise<NtopInterface> {
  const raw = await ntopFetch<Record<string, unknown>>(
    '/lua/rest/v2/get/interface/data.lua',
    { ifid },
  );
  return normalizeInterface(raw);
}

// ─── Timeseries ───────────────────────────────────────────────────────────────

export async function getTrafficTimeseries(ifid: number, minutes = 30): Promise<NtopTimeseries> {
  const epochEnd   = Math.floor(Date.now() / 1000);
  const epochBegin = epochEnd - minutes * 60;

  return ntopFetch<NtopTimeseries>('/lua/rest/v2/get/timeseries/ts.lua', {
    ifid,
    ts_schema:   'iface:traffic',
    ts_query:    `ifid:${ifid}`,
    epoch_begin: epochBegin,
    epoch_end:   epochEnd,
    step:        60,
  });
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function getFlowAlerts(ifid: number): Promise<NtopAlertList> {
  const params = { ifid, currentPage: 0, perPage: 20, sortColumn: 'score', sortOrder: 'desc' };

  // Try flow alerts first; if disabled try the generic alert list endpoint
  try {
    return await ntopFetch<NtopAlertList>('/lua/rest/v2/get/flow/alert/list.lua', params);
  } catch {
    return ntopFetch<NtopAlertList>('/lua/rest/v2/get/alert/list.lua', params);
  }
}

// ─── Top Talkers (community endpoint) ────────────────────────────────────────

export async function getTopTalkers(ifid: number): Promise<NtopTopTalker[]> {
  // Try the community interface top-talkers endpoint.
  // Falls back to empty array (→ mock) if not available.
  const raw = await ntopFetch<
    | NtopTopTalker[]
    | { hosts?: NtopTopTalker[]; data?: NtopTopTalker[]; rcvd?: NtopTopTalker[]; sent?: NtopTopTalker[] }
  >('/lua/rest/v2/get/interface/top/talkers.lua', { ifid });

  if (Array.isArray(raw)) return raw;
  const r = raw as { hosts?: NtopTopTalker[]; data?: NtopTopTalker[]; rcvd?: NtopTopTalker[]; sent?: NtopTopTalker[] };
  return r.hosts ?? r.data ?? r.rcvd ?? r.sent ?? [];
}

// ─── L4 counters ─────────────────────────────────────────────────────────────

export async function getL4Counters(ifid: number): Promise<NtopL4Counter[]> {
  const raw = await ntopFetch<NtopL4Counter[] | Record<string, { bytes: number; packets: number }>>(
    '/lua/rest/v2/get/flow/l4/counters.lua',
    { ifid },
  );
  if (Array.isArray(raw)) return raw;
  // Some versions return an object: { TCP: { bytes, packets }, UDP: {...}, ... }
  return Object.entries(raw as Record<string, { bytes: number; packets: number }>).map(
    ([name, v]) => ({ name, bytes: v.bytes ?? 0, packets: v.packets ?? 0 }),
  );
}

// ─── Alert severity ───────────────────────────────────────────────────────────

export async function getAlertSeverityCounters(ifid: number): Promise<NtopAlertSeverityCounter[]> {
  return ntopFetch<NtopAlertSeverityCounter[]>(
    '/lua/rest/v2/get/alert/severity/counters.lua',
    { ifid },
  );
}

// ─── L7 Protocol Counters (community endpoint) ────────────────────────────────

/**
 * Flow L7 protocol counters for a given interface.
 * May return array [{name, bytes, num_flows}] or object {TCP:{bytes,packets},...}
 */
export async function getFlowL7Counters(ifid: number): Promise<unknown> {
  return ntopFetch('/lua/rest/v2/get/flow/l7/counters.lua', { ifid });
}

/**
 * nDPI application-level stats per interface (community endpoint).
 * Returns [{name, bytes, num_flows, breed}] sorted descending.
 */
export async function getInterfaceL7Stats(ifid: number): Promise<unknown> {
  return ntopFetch('/lua/rest/v2/get/interface/l7/stats.lua', {
    ifid,
    ndpistats_mode: 'count',
    breed: 'false',
    ndpi_category: 'false',
    max_values: 10,
    collapse_stats: 'true',
  });
}

// ─── Active Hosts (community endpoint) ───────────────────────────────────────

/**
 * Paginated active host list, sorted by traffic descending.
 * Returns { data: [...], totalRows: N } or flat array depending on version.
 */
export async function getActiveHosts(ifid: number, perPage = 8): Promise<unknown> {
  return ntopFetch('/lua/rest/v2/get/host/active.lua', {
    ifid,
    currentPage: 0,
    perPage,
    sortColumn: 'traffic',
    sortOrder: 'desc',
  });
}

// ─── Active Flows (community endpoint) ───────────────────────────────────────

/**
 * Paginated active flow list, sorted by score descending (most suspicious first).
 * Returns { data: [...], totalRows: N } or flat array depending on version.
 */
export async function getActiveFlows(ifid: number, perPage = 20): Promise<unknown> {
  return ntopFetch('/lua/rest/v2/get/flow/active.lua', {
    ifid,
    currentPage: 0,
    perPage,
    sortColumn: 'score',
    sortOrder: 'desc',
  });
}

// ─── Connection test ──────────────────────────────────────────────────────────

export async function testConnection(): Promise<NtopInterface[]> {
  return getInterfaces();
}

// ─── Alert pages (host + all) ─────────────────────────────────────────────────

interface AlertQueryParams {
  ifid:         number;
  currentPage?: number;
  perPage?:     number;
  alert_id?:    number;
  epochBegin?:  number;
  epochEnd?:    number;
  /** Default on ntopng REST = engaged-only. Use 'all' for historical alerts. */
  status?:      'engaged' | 'all';
}

function alertParams(p: AlertQueryParams): Record<string, string | number> {
  const params: Record<string, string | number> = {
    ifid:        p.ifid,
    currentPage: p.currentPage ?? 0,
    perPage:     p.perPage     ?? 20,
    status:      p.status      ?? 'engaged',
  };
  if (p.alert_id   !== undefined) params.alert_id   = p.alert_id;
  if (p.epochBegin !== undefined) params.epoch_begin = p.epochBegin;
  if (p.epochEnd   !== undefined) params.epoch_end   = p.epochEnd;
  return params;
}

/** ntopng v6 REST returns nested {label, value} objects — flatten for the UI */
function unwrapVal(v: unknown): unknown {
  if (v != null && typeof v === 'object' && 'value' in (v as object))
    return (v as { value: unknown }).value;
  return v;
}

function unwrapLabel(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object' && 'label' in (v as object)) {
    const lbl = (v as { label: unknown }).label;
    if (typeof lbl === 'string') return lbl.replace(/<[^>]*>/g, '').trim();
    return String(lbl);
  }
  return typeof v === 'string' ? v : undefined;
}

function unwrapIp(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const ip = o.ip ?? o.value ?? o.label;
    return ip ? String(ip) : undefined;
  }
  return undefined;
}

function severityFromId(v: number): string {
  if (v >= 5) return 'critical';
  if (v >= 4) return 'error';
  if (v >= 3) return 'notice';
  if (v >= 2) return 'warning';
  return 'info';
}

export function normalizeAlertRecord(raw: Record<string, unknown>): NtopAlert {
  const flow   = raw.flow as Record<string, unknown> | undefined;
  const msg    = raw.msg as Record<string, unknown> | undefined;
  const sevVal = Number(unwrapVal(raw.severity) ?? 0);
  const alertId = Number(unwrapVal(raw.alert_id) ?? msg?.value ?? 0);

  return {
    tstamp:       Number(unwrapVal(raw.tstamp) ?? 0),
    alert_id:     alertId,
    name:         String(raw.alert_name ?? unwrapLabel(raw.alert_id) ?? msg?.fullname ?? msg?.name ?? ''),
    severity:     typeof raw.severity === 'string' ? raw.severity : severityFromId(sevVal),
    score:        Number(unwrapVal(raw.score) ?? 0),
    duration:     Number(raw.duration ?? 0),
    ip:           unwrapIp(raw.srv_ip ?? raw.ip ?? flow?.srv_ip),
    cli_ip:       unwrapIp(raw.cli_ip ?? flow?.cli_ip),
    proto:        unwrapLabel(raw.proto) ?? unwrapLabel(raw.l7_proto),
    alert_status: Number(unwrapVal(raw.alert_status) ?? 1),
    cli_asn:      (unwrapVal(raw.cli_asn ?? flow?.cli_asn) ?? unwrapLabel(raw.cli_asn ?? flow?.cli_asn)) as number | string | undefined,
    srv_asn:      (unwrapVal(raw.srv_asn ?? flow?.srv_asn) ?? unwrapLabel(raw.srv_asn ?? flow?.srv_asn)) as number | string | undefined,
  };
}

function mapAlertPage(raw: { records: unknown[]; recordsTotal: number }): NtopAlertPage {
  return {
    records: (raw.records as Record<string, unknown>[]).map(normalizeAlertRecord),
    recordsTotal: raw.recordsTotal,
  };
}

export async function getAllAlerts(p: AlertQueryParams): Promise<NtopAlertPage> {
  const raw = await ntopFetchPaginated('/lua/rest/v2/get/all/alert/list.lua', alertParams(p));
  return mapAlertPage(raw);
}

export async function getHostAlerts(p: AlertQueryParams): Promise<NtopAlertPage> {
  const raw = await ntopFetchPaginated('/lua/rest/v2/get/host/alert/list.lua', alertParams(p));
  return mapAlertPage(raw);
}

export async function getFlowAlertsPage(p: AlertQueryParams): Promise<NtopAlertPage> {
  const raw = await ntopFetchPaginated('/lua/rest/v2/get/flow/alert/list.lua', alertParams(p));
  return mapAlertPage(raw);
}

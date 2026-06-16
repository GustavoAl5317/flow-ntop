const TOKEN_KEY = 'flow_auth_token';

export interface AuthUser {
  username: string;
  role: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401) {
    clearStoredToken();
    throw new Error('Sessão expirada — faça login novamente');
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch { /* keep status */ }
    throw new Error(msg);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return res.text() as unknown as T;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setStoredToken(data.access_token);
  return data;
}

export async function getMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me');
}

export async function saveEventsBulk(events: unknown[], source = 'ntopng'): Promise<{ inserted: number }> {
  return apiFetch('/events/bulk', {
    method: 'POST',
    body: JSON.stringify({ events, source }),
  });
}

export async function getStoredEvents(params: {
  epoch_begin?: number;
  epoch_end?: number;
  alert_id?: number;
  severity?: string;
  ip?: string;
  limit?: number;
}): Promise<{ records: unknown[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return apiFetch(`/events?${qs}`);
}

export async function getReportSummary(epoch_begin: number, epoch_end: number) {
  return apiFetch(`/reports/summary?epoch_begin=${epoch_begin}&epoch_end=${epoch_end}`);
}

export async function saveReport(data: {
  name: string;
  report_type: string;
  epoch_begin: number;
  epoch_end: number;
  summary: Record<string, unknown>;
}) {
  return apiFetch('/reports', { method: 'POST', body: JSON.stringify(data) });
}

export interface Threshold {
  id: number;
  ifid: number;
  metric: string;
  label: string;
  warning_value: number | null;
  critical_value: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export async function getThresholds(ifid?: number): Promise<{ thresholds: Threshold[] }> {
  const qs = ifid !== undefined ? `?ifid=${ifid}` : '';
  return apiFetch(`/thresholds${qs}`);
}

export async function saveThreshold(data: {
  ifid: number;
  metric: string;
  label: string;
  warning_value: number | null;
  critical_value: number | null;
  enabled: boolean;
}): Promise<Threshold> {
  return apiFetch('/thresholds', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteThreshold(id: number): Promise<{ deleted: boolean }> {
  return apiFetch(`/thresholds/${id}`, { method: 'DELETE' });
}

export interface AlertStatus {
  id: number;
  alert_key: string;
  status: string;
  assigned_to: string | null;
  note: string | null;
  updated_by: string;
  updated_at: string;
}

export async function getAlertStatuses(keys: string[]): Promise<{ statuses: Record<string, AlertStatus> }> {
  if (keys.length === 0) return { statuses: {} };
  return apiFetch(`/alert-status?keys=${encodeURIComponent(keys.join(','))}`);
}

export async function saveAlertStatus(data: {
  alert_key: string;
  status: string;
  assigned_to?: string | null;
  note?: string | null;
}): Promise<AlertStatus> {
  return apiFetch('/alert-status', { method: 'POST', body: JSON.stringify(data) });
}

// ─── NetFlow (GoFlow2 pipeline) ────────────────────────────────────────────

export interface NetflowTopTalker {
  ip: string;
  total_bytes: number;
  total_packets: number;
  flows: number;
  src_as: number | null;
  dst_as: number | null;
}

export interface NetflowTopPort {
  port: number;
  protocol: string;
  total_bytes: number;
  total_packets: number;
  flows: number;
}

export interface NetflowTopAsn {
  asn: number;
  total_bytes: number;
  total_packets: number;
  flows: number;
}

export interface NetflowProtocol {
  protocol: string;
  total_bytes: number;
  total_packets: number;
  flows: number;
}

export interface NetflowBandwidthClient {
  ip: string;
  total_bytes: number;
  total_packets: number;
  flows: number;
  critical: number;
  warning: number;
}

export interface NetflowTimeseriesPoint {
  bucket: number;
  total_bytes: number;
  total_packets: number;
  flows: number;
  critical: number;
  warning: number;
}

export interface NetflowIncident {
  id: number;
  tstamp: number;
  severity: string;
  score: number;
  proto: string | null;
  ip: string | null;
  cli_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  bytes: number | null;
  packets: number | null;
  duration: number | null;
}

export interface NetflowSummary {
  total_flows: number;
  total_bytes: number;
  total_packets: number;
  peak_mbps: number;
  avg_mbps: number;
  current_mbps: number;
}

interface NetflowParams {
  epoch_begin?: number;
  epoch_end?: number;
  limit?: number;
  protocol?: string;
  ip_version?: '4' | '6';
  asn?: number;
  src_ip?: string;
  dst_ip?: string;
}

function buildQS(params: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function getNetflowSummary(
  params: NetflowParams & { bucket_seconds?: number } = {},
): Promise<NetflowSummary> {
  return apiFetch(`/netflow/summary${buildQS(params)}`);
}

export async function getNetflowTopTalkers(
  params: NetflowParams & { direction?: 'src' | 'dst' } = {},
): Promise<{ records: NetflowTopTalker[] }> {
  return apiFetch(`/netflow/top-talkers${buildQS(params)}`);
}

export async function getNetflowTopPorts(
  params: NetflowParams & { port_type?: 'src' | 'dst' } = {},
): Promise<{ records: NetflowTopPort[] }> {
  return apiFetch(`/netflow/top-ports${buildQS(params)}`);
}

export async function getNetflowTopAsn(
  params: NetflowParams & { asn_type?: 'src' | 'dst' } = {},
): Promise<{ records: NetflowTopAsn[] }> {
  return apiFetch(`/netflow/top-asn${buildQS(params)}`);
}

export async function getNetflowProtocols(
  params: NetflowParams = {},
): Promise<{ records: NetflowProtocol[] }> {
  return apiFetch(`/netflow/protocols${buildQS(params)}`);
}

export async function getNetflowBandwidthByClient(
  params: NetflowParams = {},
): Promise<{ records: NetflowBandwidthClient[] }> {
  return apiFetch(`/netflow/bandwidth-by-client${buildQS(params)}`);
}

export async function getNetflowTimeseries(
  params: NetflowParams & { bucket_seconds?: number; ip?: string } = {},
): Promise<{ records: NetflowTimeseriesPoint[] }> {
  return apiFetch(`/netflow/timeseries${buildQS(params)}`);
}

export async function getNetflowIncidents(
  params: NetflowParams & { severity?: string } = {},
): Promise<{ records: NetflowIncident[] }> {
  return apiFetch(`/netflow/incidents${buildQS(params)}`);
}

// ─── IP Blocks ────────────────────────────────────────────────────────────────

export interface IpBlock {
  id: number;
  cidr: string;
  label: string;
  customer: string | null;
  network_int: number;
  broadcast_int: number;
  created_at: string;
}

export interface IpBlockStats {
  id: number;
  total_bytes: number;
  total_packets: number;
  total_flows: number;
}

export async function getIpBlocks(): Promise<{ blocks: IpBlock[] }> {
  return apiFetch('/ip-blocks');
}

export async function createIpBlock(data: {
  cidr: string;
  label: string;
  customer?: string | null;
}): Promise<IpBlock> {
  return apiFetch('/ip-blocks', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteIpBlock(id: number): Promise<{ deleted: boolean }> {
  return apiFetch(`/ip-blocks/${id}`, { method: 'DELETE' });
}

export async function getIpBlocksStats(params: {
  epoch_begin?: number;
  epoch_end?: number;
} = {}): Promise<{ stats: IpBlockStats[] }> {
  return apiFetch(`/ip-blocks/stats${buildQS(params)}`);
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

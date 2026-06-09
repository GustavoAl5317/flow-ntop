// ─── ntopng REST API v6.5 — Response type definitions ───────────────────────

/** Every ntopng REST response is wrapped in this envelope */
export interface NtopResponse<T> {
  rc: number;       // 0 = success
  rc_str: string;   // "OK" on success
  rsp: T;
}

// ─── Interface / Link ────────────────────────────────────────────────────────

export interface NtopInterfaceBytes {
  rcvd: number;
  sent: number;
}

export interface NtopInterface {
  ifname: string;
  id: number;
  speed: number;         // Mbps
  epoch: number;         // unix timestamp
  is_view: boolean;
  is_loopback: boolean;
  is_up?: boolean;
  num_flows: number;
  num_hosts: number;
  num_local_hosts: number;
  engaged_alerts: number;
  alerts_stored: number;
  bytes: NtopInterfaceBytes;
  packets: NtopInterfaceBytes;
  drops: { total: number };
  throughput_bps: number;   // bits/s total
  throughput_pps: number;   // packets/s total
  remote_bps?: number;      // remote-to-local bits/s
  remote_pps?: number;
  local2remote?: { bps: number; pps: number };
  remote2local?: { bps: number; pps: number };
  tcpPacketStats?: { retransmissions: number; lost: number; out_of_order: number };
}

// ─── Timeseries ──────────────────────────────────────────────────────────────

export interface NtopTSSeries {
  label: string;
  data: number[];
}

export interface NtopTimeseries {
  start: number;           // epoch
  end: number;             // epoch
  step: number;            // seconds per point
  count: number;
  series: NtopTSSeries[];
  additional_series?: NtopTSSeries[];
}

// ─── Flow Alerts ─────────────────────────────────────────────────────────────

export interface NtopFlowAlert {
  rowid: number;
  first_seen: number;      // epoch
  last_seen: number;       // epoch
  score: number;
  vlan_id?: number;
  l4proto: string;         // "TCP", "UDP", …
  l7proto?: string;        // application name
  l7_master_proto?: string;
  cli_ip: string;
  cli_port?: number;
  srv_ip: string;
  srv_port?: number;
  cli2srv_bytes: number;
  srv2cli_bytes: number;
  cli2srv_pkts: number;
  srv2cli_pkts: number;
  alert_name: string;      // e.g. "SYN Flood", "DNS Amplification"
  alert_id?: number;
  category?: string;
  severity: string;        // "error", "warning", "notice", "info"
  severity_id: number;     // 4=error, 3=warning, 2=notice, 1=info
  cli_country?: string;    // 2-char ISO code
  srv_country?: string;
  cli_asname?: string;
  srv_asname?: string;
  cli_asn?: number;
  srv_asn?: number;
  cli_name?: string;
  srv_name?: string;
}

export interface NtopAlertList {
  records: NtopFlowAlert[];
  totalRows: number;
}

// ─── Generic Alert (host + flow alerts unified) ───────────────────────────────

export interface NtopAlert {
  tstamp?:       number;
  tstamp_end?:   number;
  alert_id:      number;
  severity?:     string;
  score?:        number;
  duration?:     number;
  ip?:           string;
  name?:         string;
  cli_ip?:       string;
  srv_ip?:       string;
  cli_asn?:      number | string;
  srv_asn?:      number | string;
  proto?:        string;
  alert_status?: number;
  json?:         string;
}

export interface NtopAlertPage {
  records:       NtopAlert[];
  recordsTotal:  number;
  recordsFiltered?: number;
}

// ─── Top Talkers ─────────────────────────────────────────────────────────────

export interface NtopTopTalker {
  ip: string;
  name?: string;
  country?: string;         // 2-char ISO or full name
  bytes: number;            // bytes/s
  bytes_rcvd?: number;
  bytes_sent?: number;
  packets?: number;
  l7proto?: string;
  asname?: string;
  asn?: number;
}

// ─── L4 Protocol Counters ────────────────────────────────────────────────────

export interface NtopL4Counter {
  name: string;   // "TCP", "UDP", "ICMP", etc.
  bytes: number;
  packets: number;
}

// ─── Alert Severity Counter ──────────────────────────────────────────────────

export interface NtopAlertSeverityCounter {
  count: number;
  severity: string;
  severity_id: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface NtopConfig {
  baseUrl: string;
  token: string;
  ifid: number;
}

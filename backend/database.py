import ipaddress
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from classifier import classify_event, detect_volumetric_attacks

DB_PATH = Path(os.getenv("FLOW_DB_PATH", Path(__file__).parent / "flow.db"))


def _ip_to_int(ip_str: str | None) -> int | None:
    if not ip_str:
        return None
    try:
        return int(ipaddress.IPv4Address(ip_str))
    except Exception:
        return None


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.create_function("ip_to_int", 1, _ip_to_int)
    return conn


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Extra columns added for the NetFlow (GoFlow2) pipeline.
# Mapping from NetFlow payload -> events table:
#   cli_ip = src_ip, ip = dst_ip, proto = protocol,
#   duration = (flow_end_ns - flow_start_ns) / 1e9
NETFLOW_COLUMNS: dict[str, str] = {
    "src_ip":        "TEXT",
    "dst_ip":        "TEXT",
    "src_port":      "INTEGER",
    "dst_port":      "INTEGER",
    "protocol":      "TEXT",
    "bytes":         "INTEGER",
    "packets":       "INTEGER",
    "src_as":        "INTEGER",
    "dst_as":        "INTEGER",
    "src_net":       "TEXT",
    "dst_net":       "TEXT",
    "in_if":         "INTEGER",
    "out_if":        "INTEGER",
    "next_hop":      "TEXT",
    "flow_start_ns": "INTEGER",
    "flow_end_ns":   "INTEGER",
    "sampler":       "TEXT",
}


def _migrate_events_table(conn: sqlite3.Connection) -> None:
    """Add new NetFlow columns to an existing events table, if missing."""
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(events)")}
    for col, col_type in NETFLOW_COLUMNS.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE events ADD COLUMN {col} {col_type}")


def init_db() -> None:
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                tstamp      INTEGER NOT NULL,
                alert_id    INTEGER NOT NULL DEFAULT 0,
                severity    TEXT,
                score       INTEGER,
                duration    INTEGER,
                ip          TEXT,
                cli_ip      TEXT,
                proto       TEXT,
                alert_status INTEGER,
                source      TEXT DEFAULT 'ntopng',
                raw_json    TEXT,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_tstamp ON events(tstamp);
            CREATE INDEX IF NOT EXISTS idx_events_alert_id ON events(alert_id);
            CREATE INDEX IF NOT EXISTS idx_events_ip ON events(ip);

            CREATE TABLE IF NOT EXISTS reports (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                report_type TEXT NOT NULL,
                epoch_begin INTEGER NOT NULL,
                epoch_end   INTEGER NOT NULL,
                summary     TEXT NOT NULL,
                created_by  TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS alert_status (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_key   TEXT NOT NULL UNIQUE,
                status      TEXT NOT NULL DEFAULT 'open',
                assigned_to TEXT,
                note        TEXT,
                updated_by  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS thresholds (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ifid          INTEGER NOT NULL,
                metric        TEXT NOT NULL,
                label         TEXT NOT NULL,
                warning_value REAL,
                critical_value REAL,
                enabled       INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                UNIQUE(ifid, metric)
            );

            CREATE TABLE IF NOT EXISTS ip_blocks (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                cidr          TEXT NOT NULL UNIQUE,
                label         TEXT NOT NULL,
                customer      TEXT,
                network_int   INTEGER NOT NULL,
                broadcast_int INTEGER NOT NULL,
                created_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ip_blocks_nets ON ip_blocks(network_int, broadcast_int);

            CREATE TABLE IF NOT EXISTS interfaces (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ifid          INTEGER NOT NULL,
                router_ip     TEXT NOT NULL DEFAULT '',
                name          TEXT NOT NULL,
                description   TEXT,
                capacity_mbps REAL,
                created_at    TEXT NOT NULL,
                UNIQUE(ifid, router_ip)
            );
            CREATE INDEX IF NOT EXISTS idx_interfaces_ifid ON interfaces(ifid);
        """)
        _migrate_events_table(conn)
        _migrate_ip_blocks_table(conn)
        _migrate_interfaces_table(conn)


def normalize_netflow_event(ev: dict) -> dict:
    """Map a raw NetFlow (GoFlow2 collector) event onto the events schema.

    Existing fields (ip, cli_ip, proto, duration, severity, score) are kept
    if already present (e.g. ntopng-sourced events); otherwise they are
    derived from the NetFlow fields.
    """
    out = dict(ev)

    if out.get("cli_ip") is None:
        out["cli_ip"] = ev.get("src_ip")
    if out.get("ip") is None:
        out["ip"] = ev.get("dst_ip")
    if out.get("proto") is None:
        out["proto"] = ev.get("protocol")

    if out.get("duration") is None:
        start_ns = ev.get("flow_start_ns")
        end_ns = ev.get("flow_end_ns")
        if start_ns is not None and end_ns is not None:
            try:
                out["duration"] = max(0, int((int(end_ns) - int(start_ns)) / 1_000_000_000))
            except (TypeError, ValueError):
                pass

    # Classify NetFlow-sourced flows that don't already carry a severity/score
    # (e.g. ntopng-sourced events keep their own classification).
    if out.get("severity") is None or out.get("score") is None:
        severity, score = classify_event(out)
        if out.get("severity") is None:
            out["severity"] = severity
        if out.get("score") is None:
            out["score"] = score

    return out


def insert_events(events: list[dict], source: str = "ntopng") -> int:
    """Insert a batch of events.

    `source` is the bulk-request-level default (e.g. from EventBulkRequest.source).
    Individual events may carry their own `source` field (e.g. the GoFlow2
    collector embeds "source": "goflow2" in each event but does not set the
    top-level request field) — that per-event value takes precedence.
    """
    now = datetime.now(timezone.utc).isoformat()
    netflow_cols = list(NETFLOW_COLUMNS.keys())
    inserted = 0
    max_tstamp_by_source: dict[str, int] = {}
    with get_db() as conn:
        for raw_ev in events:
            tstamp = raw_ev.get("tstamp")
            if tstamp is None:
                continue
            ev = normalize_netflow_event(raw_ev)
            alert_id = ev.get("alert_id") or 0
            event_source = raw_ev.get("source") or source
            max_tstamp_by_source[event_source] = max(
                max_tstamp_by_source.get(event_source, 0), int(tstamp)
            )

            columns = ["tstamp", "alert_id", "severity", "score", "duration", "ip", "cli_ip", "proto",
                       "alert_status", "source", "raw_json", "created_at", *netflow_cols]
            values = [
                int(tstamp),
                int(alert_id),
                ev.get("severity"),
                ev.get("score"),
                ev.get("duration"),
                ev.get("ip"),
                ev.get("cli_ip"),
                ev.get("proto"),
                ev.get("alert_status"),
                event_source,
                json.dumps(raw_ev, ensure_ascii=False),
                now,
                *(ev.get(col) for col in netflow_cols),
            ]
            placeholders = ",".join("?" for _ in columns)
            conn.execute(
                f"INSERT INTO events ({','.join(columns)}) VALUES ({placeholders})",
                values,
            )
            inserted += 1

        goflow2_max_tstamp = max_tstamp_by_source.get("goflow2")
        if goflow2_max_tstamp:
            detect_volumetric_attacks(conn, goflow2_max_tstamp)

    return inserted


def query_events(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    alert_id: int | None = None,
    severity: str | None = None,
    ip: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict], int]:
    clauses: list[str] = []
    params: list = []

    if epoch_begin is not None:
        clauses.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        clauses.append("tstamp <= ?")
        params.append(epoch_end)
    if alert_id is not None:
        clauses.append("alert_id = ?")
        params.append(alert_id)
    if severity:
        clauses.append("severity = ?")
        params.append(severity)
    if ip:
        clauses.append("(ip LIKE ? OR cli_ip LIKE ?)")
        params.extend([f"%{ip}%", f"%{ip}%"])

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM events {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT * FROM events {where}
                ORDER BY tstamp DESC LIMIT ? OFFSET ?""",
            [*params, limit, offset],
        ).fetchall()

    return [dict(r) for r in rows], total


def build_summary(epoch_begin: int, epoch_end: int) -> dict:
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM events WHERE tstamp BETWEEN ? AND ?",
            (epoch_begin, epoch_end),
        ).fetchone()[0]

        by_type = conn.execute(
            """SELECT alert_id, COUNT(*) as count,
                      SUM(CASE WHEN severity IN ('critical','error') THEN 1 ELSE 0 END) as critical,
                      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning
               FROM events WHERE tstamp BETWEEN ? AND ?
               GROUP BY alert_id ORDER BY count DESC""",
            (epoch_begin, epoch_end),
        ).fetchall()

        top_ips = conn.execute(
            """SELECT ip, COUNT(*) as count FROM (
                   SELECT ip as ip FROM events WHERE tstamp BETWEEN ? AND ? AND ip IS NOT NULL
                   UNION ALL
                   SELECT cli_ip as ip FROM events WHERE tstamp BETWEEN ? AND ? AND cli_ip IS NOT NULL
               ) GROUP BY ip ORDER BY count DESC LIMIT 20""",
            (epoch_begin, epoch_end, epoch_begin, epoch_end),
        ).fetchall()

        critical = conn.execute(
            """SELECT COUNT(*) FROM events
               WHERE tstamp BETWEEN ? AND ? AND severity IN ('critical','error')""",
            (epoch_begin, epoch_end),
        ).fetchone()[0]

        warning = conn.execute(
            """SELECT COUNT(*) FROM events
               WHERE tstamp BETWEEN ? AND ? AND severity = 'warning'""",
            (epoch_begin, epoch_end),
        ).fetchone()[0]

    return {
        "total": total,
        "critical": critical,
        "warning": warning,
        "by_type": [dict(r) for r in by_type],
        "top_ips": [dict(r) for r in top_ips],
        "epoch_begin": epoch_begin,
        "epoch_end": epoch_end,
    }


def save_report(name: str, report_type: str, epoch_begin: int, epoch_end: int,
                summary: dict, created_by: str) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO reports (name, report_type, epoch_begin, epoch_end, summary, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (name, report_type, epoch_begin, epoch_end, json.dumps(summary), created_by, now),
        )
        return cur.lastrowid or 0


def list_reports(limit: int = 20) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, report_type, epoch_begin, epoch_end, created_by, created_at FROM reports ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_thresholds(ifid: int | None = None) -> list[dict]:
    with get_db() as conn:
        if ifid is not None:
            rows = conn.execute(
                "SELECT * FROM thresholds WHERE ifid = ? ORDER BY metric", (ifid,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM thresholds ORDER BY ifid, metric").fetchall()
    return [dict(r) for r in rows]


def upsert_threshold(
    ifid: int,
    metric: str,
    label: str,
    warning_value: float | None,
    critical_value: float | None,
    enabled: bool,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO thresholds (ifid, metric, label, warning_value, critical_value, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ifid, metric) DO UPDATE SET
                   label=excluded.label,
                   warning_value=excluded.warning_value,
                   critical_value=excluded.critical_value,
                   enabled=excluded.enabled,
                   updated_at=excluded.updated_at""",
            (ifid, metric, label, warning_value, critical_value, int(enabled), now, now),
        )
        row = conn.execute(
            "SELECT * FROM thresholds WHERE ifid = ? AND metric = ?", (ifid, metric)
        ).fetchone()
    return dict(row)


def delete_threshold(threshold_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM thresholds WHERE id = ?", (threshold_id,))
    return cur.rowcount > 0


# ─── NetFlow aggregation queries (GoFlow2 pipeline) ───────────────────────────

def _epoch_clause(clauses: list[str], params: list, epoch_begin: int | None, epoch_end: int | None) -> None:
    if epoch_begin is not None:
        clauses.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        clauses.append("tstamp <= ?")
        params.append(epoch_end)


def _nf_filters(
    clauses: list[str],
    params: list,
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> None:
    """Append WHERE clauses for GoFlow2 NetFlow queries (mutates clauses/params)."""
    clauses.append("source = 'goflow2'")
    if epoch_begin is not None:
        clauses.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        clauses.append("tstamp <= ?")
        params.append(epoch_end)
    if protocol:
        clauses.append("protocol = ?")
        params.append(protocol.upper())
    if ip_version == "4":
        clauses.append("(src_ip IS NULL OR src_ip NOT LIKE '%:%') AND (dst_ip IS NULL OR dst_ip NOT LIKE '%:%')")
    elif ip_version == "6":
        clauses.append("(src_ip LIKE '%:%' OR dst_ip LIKE '%:%')")
    if asn is not None:
        clauses.append("(src_as = ? OR dst_as = ?)")
        params.extend([asn, asn])
    if src_ip:
        clauses.append("src_ip = ?")
        params.append(src_ip)
    if dst_ip:
        clauses.append("dst_ip = ?")
        params.append(dst_ip)


def netflow_summary(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 60,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> dict:
    """Consolidated metrics for the period: totals + peak/avg/current bandwidth."""
    clauses: list[str] = []
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        agg = conn.execute(
            f"""SELECT COUNT(*) AS total_flows,
                       COALESCE(SUM(bytes), 0) AS total_bytes,
                       COALESCE(SUM(packets), 0) AS total_packets
                FROM events WHERE {where}""",
            params,
        ).fetchone()

        bucket_rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket, SUM(bytes) AS bucket_bytes
                FROM events WHERE {where}
                GROUP BY bucket ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *params],
        ).fetchall()

    bucket_bytes_list = [r["bucket_bytes"] or 0 for r in bucket_rows]
    peak_bytes = max(bucket_bytes_list) if bucket_bytes_list else 0
    avg_bytes = sum(bucket_bytes_list) / len(bucket_bytes_list) if bucket_bytes_list else 0
    current_bytes = bucket_bytes_list[-1] if bucket_bytes_list else 0

    def to_mbps(b: float) -> float:
        return round(b * 8 / max(bucket_seconds, 1) / 1_000_000, 3)

    return {
        "total_flows": agg["total_flows"] or 0,
        "total_bytes": agg["total_bytes"] or 0,
        "total_packets": agg["total_packets"] or 0,
        "peak_mbps": to_mbps(peak_bytes),
        "avg_mbps": to_mbps(avg_bytes),
        "current_mbps": to_mbps(current_bytes),
    }


def netflow_top_talkers(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    direction: str = "src",
    limit: int = 20,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    ip_col = "dst_ip" if direction == "dst" else "src_ip"
    clauses = [f"{ip_col} IS NOT NULL"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT {ip_col} AS ip,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows,
                       MAX(src_as) AS src_as,
                       MAX(dst_as) AS dst_as
                FROM events WHERE {where}
                GROUP BY {ip_col}
                ORDER BY total_bytes DESC
                LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_top_ports(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    port_type: str = "dst",
    limit: int = 20,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    port_col = "src_port" if port_type == "src" else "dst_port"
    clauses = [f"{port_col} IS NOT NULL"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT {port_col} AS port,
                       protocol,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows
                FROM events WHERE {where}
                GROUP BY {port_col}, protocol
                ORDER BY total_bytes DESC
                LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_top_asn(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    asn_type: str = "src",
    limit: int = 20,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    asn_col = "src_as" if asn_type == "src" else "dst_as"
    clauses = [f"{asn_col} IS NOT NULL", f"{asn_col} != 0"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT {asn_col} AS asn,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows
                FROM events WHERE {where}
                GROUP BY {asn_col}
                ORDER BY total_bytes DESC
                LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_protocols(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    clauses = ["protocol IS NOT NULL"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT protocol,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows
                FROM events WHERE {where}
                GROUP BY protocol
                ORDER BY total_bytes DESC""",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_bandwidth_by_client(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    limit: int = 20,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    clauses = ["src_ip IS NOT NULL"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT src_ip AS ip,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows,
                       SUM(CASE WHEN severity IN ('critical','error') THEN 1 ELSE 0 END) AS critical,
                       SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning
                FROM events WHERE {where}
                GROUP BY src_ip
                ORDER BY total_bytes DESC
                LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_timeseries(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 60,
    ip: str | None = None,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    clauses: list[str] = []
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    if ip:
        clauses.append("(src_ip = ? OR dst_ip = ?)")
        params.extend([ip, ip])
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       SUM(bytes) AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*) AS flows,
                       SUM(CASE WHEN severity IN ('critical','error') THEN 1 ELSE 0 END) AS critical,
                       SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning
                FROM events WHERE {where}
                GROUP BY bucket
                ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *params],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_incidents(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    severity: str | None = None,
    limit: int = 200,
    protocol: str | None = None,
    ip_version: str | None = None,
    asn: int | None = None,
    src_ip: str | None = None,
    dst_ip: str | None = None,
) -> list[dict]:
    clauses = ["severity IS NOT NULL", "severity != 'info'"]
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end, protocol, ip_version, asn, src_ip, dst_ip)
    if severity:
        clauses.append("severity = ?")
        params.append(severity)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT id, tstamp, severity, score, proto, ip, cli_ip,
                       src_port, dst_port, bytes, packets, duration
                FROM events WHERE {where}
                ORDER BY tstamp DESC
                LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_ip_timeseries(
    ip: str,
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 60,
    direction: str = "both",
) -> list[dict]:
    """Timeseries de bytes/pacotes/fluxos para um IP específico (src, dst ou ambos)."""
    clauses: list[str] = []
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end)
    if direction == "src":
        clauses.append("src_ip = ?")
        params.append(ip)
    elif direction == "dst":
        clauses.append("dst_ip = ?")
        params.append(ip)
    else:
        clauses.append("(src_ip = ? OR dst_ip = ?)")
        params.extend([ip, ip])
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       SUM(bytes)   AS total_bytes,
                       SUM(packets) AS total_packets,
                       COUNT(*)     AS flows
                FROM events WHERE {where}
                GROUP BY bucket ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *params],
        ).fetchall()
    return [dict(r) for r in rows]


def netflow_protocol_timeseries(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 300,
    top_n: int = 5,
) -> dict:
    """Timeseries de bytes por protocolo (top N protocolos do período)."""
    clauses: list[str] = []
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end)
    clauses.append("protocol IS NOT NULL")
    where = " AND ".join(clauses)

    with get_db() as conn:
        # Top protocols by total bytes in range
        top_protos = [
            r["protocol"] for r in conn.execute(
                f"""SELECT protocol, SUM(bytes) AS b FROM events WHERE {where}
                    GROUP BY protocol ORDER BY b DESC LIMIT ?""",
                [*params, top_n],
            ).fetchall()
        ]

        if not top_protos:
            return {"protocols": [], "series": []}

        placeholders = ",".join("?" for _ in top_protos)
        rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       protocol,
                       SUM(bytes) AS bytes,
                       COUNT(*)   AS flows
                FROM events WHERE {where} AND protocol IN ({placeholders})
                GROUP BY bucket, protocol
                ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *params, *top_protos],
        ).fetchall()

    # Pivot: bucket → {proto: bytes}
    bucket_map: dict[int, dict[str, float]] = {}
    for r in rows:
        b = r["bucket"]
        if b not in bucket_map:
            bucket_map[b] = {p: 0 for p in top_protos}
        bucket_map[b][r["protocol"]] = r["bytes"] or 0

    series = [{"bucket": b, **vals} for b, vals in sorted(bucket_map.items())]
    return {"protocols": top_protos, "series": series}


def netflow_asn_timeseries(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 300,
    asn_type: str = "src",
    top_n: int = 5,
) -> dict:
    """Timeseries de bytes por ASN (top N ASNs do período)."""
    asn_col = "src_as" if asn_type == "src" else "dst_as"
    clauses: list[str] = []
    params: list = []
    _nf_filters(clauses, params, epoch_begin, epoch_end)
    clauses.extend([f"{asn_col} IS NOT NULL", f"{asn_col} != 0"])
    where = " AND ".join(clauses)

    with get_db() as conn:
        top_asns = [
            r[asn_col] for r in conn.execute(
                f"""SELECT {asn_col}, SUM(bytes) AS b FROM events WHERE {where}
                    GROUP BY {asn_col} ORDER BY b DESC LIMIT ?""",
                [*params, top_n],
            ).fetchall()
        ]

        if not top_asns:
            return {"asns": [], "series": []}

        placeholders = ",".join("?" for _ in top_asns)
        rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       {asn_col} AS asn,
                       SUM(bytes) AS bytes,
                       COUNT(*)   AS flows
                FROM events WHERE {where} AND {asn_col} IN ({placeholders})
                GROUP BY bucket, {asn_col}
                ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *params, *top_asns],
        ).fetchall()

    asn_labels = [str(a) for a in top_asns]
    bucket_map: dict[int, dict[str, float]] = {}
    for r in rows:
        b = r["bucket"]
        if b not in bucket_map:
            bucket_map[b] = {a: 0 for a in asn_labels}
        key = str(r["asn"])
        if key in bucket_map[b]:
            bucket_map[b][key] = r["bytes"] or 0

    series = [{"bucket": b, **vals} for b, vals in sorted(bucket_map.items())]
    return {"asns": top_asns, "series": series}


# ─── IP Blocks (prefixos monitorados) ────────────────────────────────────────

_IP_BLOCKS_EXTRA: dict[str, str] = {
    "description": "TEXT",
    "type":        "TEXT",
    "category":    "TEXT",
    "active":      "INTEGER DEFAULT 1",
}


def _migrate_ip_blocks_table(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(ip_blocks)")}
    for col, col_type in _IP_BLOCKS_EXTRA.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE ip_blocks ADD COLUMN {col} {col_type}")


def list_ip_blocks() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM ip_blocks ORDER BY label").fetchall()
    return [dict(r) for r in rows]


def upsert_ip_block(
    cidr: str,
    label: str,
    customer: str | None = None,
    description: str | None = None,
    type_: str | None = None,
    category: str | None = None,
) -> dict:
    net = ipaddress.IPv4Network(cidr, strict=False)
    network_int = int(net.network_address)
    broadcast_int = int(net.broadcast_address)
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO ip_blocks (cidr, label, customer, description, type, category, network_int, broadcast_int, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(cidr) DO UPDATE SET
                   label=excluded.label,
                   customer=excluded.customer,
                   description=excluded.description,
                   type=excluded.type,
                   category=excluded.category""",
            (cidr, label, customer, description, type_, category, network_int, broadcast_int, now),
        )
        row = conn.execute("SELECT * FROM ip_blocks WHERE cidr = ?", (cidr,)).fetchone()
    return dict(row)


def delete_ip_block(block_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM ip_blocks WHERE id = ?", (block_id,))
    return cur.rowcount > 0


def ip_blocks_stats(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
) -> list[dict]:
    where_parts = ["source = 'goflow2'"]
    params: list = []
    if epoch_begin is not None:
        where_parts.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        where_parts.append("tstamp <= ?")
        params.append(epoch_end)
    where = " AND ".join(where_parts)

    with get_db() as conn:
        rows = conn.execute(
            f"""WITH filtered AS (
                    SELECT bytes, packets,
                           ip_to_int(src_ip) AS src_int,
                           ip_to_int(dst_ip) AS dst_int,
                           1 AS cnt
                    FROM events WHERE {where}
                )
                SELECT b.id,
                       COALESCE(SUM(f.bytes), 0)   AS total_bytes,
                       COALESCE(SUM(f.packets), 0) AS total_packets,
                       COALESCE(SUM(f.cnt), 0)     AS total_flows
                FROM ip_blocks b
                LEFT JOIN filtered f
                    ON (f.src_int IS NOT NULL AND f.src_int BETWEEN b.network_int AND b.broadcast_int)
                    OR (f.dst_int IS NOT NULL AND f.dst_int BETWEEN b.network_int AND b.broadcast_int)
                GROUP BY b.id""",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def ip_block_detail(
    block_id: int,
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 300,
) -> dict | None:
    """Dashboard completo para um bloco IP: IN/OUT timeseries + top ASNs/protocols/ports/IPs."""
    with get_db() as conn:
        block = conn.execute("SELECT * FROM ip_blocks WHERE id = ?", (block_id,)).fetchone()
        if not block:
            return None

        net = block["network_int"]
        bcast = block["broadcast_int"]
        ep: list = []
        ec = ["source = 'goflow2'"]
        if epoch_begin is not None:
            ec.append("tstamp >= ?"); ep.append(epoch_begin)
        if epoch_end is not None:
            ec.append("tstamp <= ?"); ep.append(epoch_end)
        ew = " AND ".join(ec)

        in_cond  = f"ip_to_int(dst_ip) BETWEEN {net} AND {bcast}"
        out_cond = f"ip_to_int(src_ip) BETWEEN {net} AND {bcast}"
        block_cond = f"({in_cond} OR {out_cond})"

        # Summary totals
        summ = conn.execute(
            f"""SELECT COALESCE(SUM(bytes), 0) AS total_bytes,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN bytes ELSE 0 END), 0) AS in_bytes,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN bytes ELSE 0 END), 0) AS out_bytes,
                       COUNT(*) AS total_flows
                FROM events WHERE {ew} AND {block_cond}""",
            ep,
        ).fetchone()

        # IN/OUT timeseries
        ts_rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN bytes ELSE 0 END), 0) AS in_bytes,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN bytes ELSE 0 END), 0) AS out_bytes,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN 1 ELSE 0 END), 0) AS in_flows,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN 1 ELSE 0 END), 0) AS out_flows
                FROM events WHERE {ew} AND {block_cond}
                GROUP BY bucket ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *ep],
        ).fetchall()

        # Top peer ASNs (the ASN communicating with this block)
        asn_rows = conn.execute(
            f"""SELECT CASE WHEN {in_cond} THEN src_as ELSE dst_as END AS asn,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {block_cond}
                  AND CASE WHEN {in_cond} THEN src_as ELSE dst_as END IS NOT NULL
                  AND CASE WHEN {in_cond} THEN src_as ELSE dst_as END != 0
                GROUP BY 1 ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top protocols
        proto_rows = conn.execute(
            f"""SELECT protocol,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {block_cond} AND protocol IS NOT NULL
                GROUP BY protocol ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top destination ports (attacks/services aimed at the block)
        port_rows = conn.execute(
            f"""SELECT dst_port AS port, protocol,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {in_cond} AND dst_port IS NOT NULL
                GROUP BY dst_port, protocol ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top source IPs sending INTO this block
        src_rows = conn.execute(
            f"""SELECT src_ip AS ip,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {in_cond} AND src_ip IS NOT NULL
                GROUP BY src_ip ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top destination IPs receiving FROM this block
        dst_rows = conn.execute(
            f"""SELECT dst_ip AS ip,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {out_cond} AND dst_ip IS NOT NULL
                GROUP BY dst_ip ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

    total_bytes = summ["total_bytes"] or 0
    ts_list = [dict(r) for r in ts_rows]
    bucket_bytes = [r["in_bytes"] + r["out_bytes"] for r in ts_list]
    peak_bytes = max(bucket_bytes) if bucket_bytes else 0
    avg_bytes  = sum(bucket_bytes) / len(bucket_bytes) if bucket_bytes else 0

    def to_mbps(b: float) -> float:
        return round(b * 8 / max(bucket_seconds, 1) / 1_000_000, 3)

    return {
        "block":   dict(block),
        "summary": {
            "total_bytes": total_bytes,
            "in_bytes":    summ["in_bytes"] or 0,
            "out_bytes":   summ["out_bytes"] or 0,
            "total_flows": summ["total_flows"] or 0,
            "peak_mbps":   to_mbps(peak_bytes),
            "avg_mbps":    to_mbps(avg_bytes),
        },
        "timeseries":   ts_list,
        "top_asns":     [dict(r) for r in asn_rows],
        "top_protocols":[dict(r) for r in proto_rows],
        "top_ports":    [dict(r) for r in port_rows],
        "top_src":      [dict(r) for r in src_rows],
        "top_dst":      [dict(r) for r in dst_rows],
    }


def ip_blocks_ranking(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
) -> list[dict]:
    """Ranking de blocos IP por volume com % de participação e flags de anomalia."""
    ep: list = []
    ec = ["source = 'goflow2'"]
    if epoch_begin is not None:
        ec.append("tstamp >= ?"); ep.append(epoch_begin)
    if epoch_end is not None:
        ec.append("tstamp <= ?"); ep.append(epoch_end)
    ew = " AND ".join(ec)

    with get_db() as conn:
        blocks = conn.execute("SELECT * FROM ip_blocks ORDER BY label").fetchall()
        if not blocks:
            return []

        total_row = conn.execute(
            f"SELECT COALESCE(SUM(bytes), 0) AS t FROM events WHERE {ew}", ep
        ).fetchone()
        grand_total = total_row["t"] or 1

        filtered = conn.execute(
            f"""SELECT bytes,
                       ip_to_int(src_ip) AS src_int,
                       ip_to_int(dst_ip) AS dst_int
                FROM events WHERE {ew}""",
            ep,
        ).fetchall()

        results = []
        for b in blocks:
            net = b["network_int"]
            bcast = b["broadcast_int"]
            total = in_b = out_b = flows = 0
            for r in filtered:
                si = r["src_int"]
                di = r["dst_int"]
                byt = r["bytes"] or 0
                is_in  = di is not None and net <= di <= bcast
                is_out = si is not None and net <= si <= bcast
                if is_in or is_out:
                    total += byt
                    if is_in:  in_b  += byt
                    if is_out: out_b += byt
                    flows += 1
            results.append({
                **dict(b),
                "total_bytes": total,
                "in_bytes":    in_b,
                "out_bytes":   out_b,
                "total_flows": flows,
                "pct":         round(total / grand_total * 100, 2),
            })

        results.sort(key=lambda x: x["total_bytes"], reverse=True)
        return results


# ─── Interfaces ───────────────────────────────────────────────────────────────

_INTERFACES_EXTRA: dict[str, str] = {
    "equipment":  "TEXT",
    "link_type":  "TEXT",
    "operator":   "TEXT",
    "partner":    "TEXT",
    "city":       "TEXT",
    "pop":        "TEXT",
}


def _migrate_interfaces_table(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(interfaces)")}
    for col, col_type in _INTERFACES_EXTRA.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE interfaces ADD COLUMN {col} {col_type}")


def list_interfaces() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM interfaces ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def upsert_interface(
    ifid: int,
    router_ip: str,
    name: str,
    description: str | None,
    capacity_mbps: float | None,
    equipment: str | None = None,
    link_type: str | None = None,
    operator: str | None = None,
    partner: str | None = None,
    city: str | None = None,
    pop: str | None = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO interfaces
                   (ifid, router_ip, name, description, capacity_mbps,
                    equipment, link_type, operator, partner, city, pop, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ifid, router_ip) DO UPDATE SET
                   name=excluded.name,
                   description=excluded.description,
                   capacity_mbps=excluded.capacity_mbps,
                   equipment=excluded.equipment,
                   link_type=excluded.link_type,
                   operator=excluded.operator,
                   partner=excluded.partner,
                   city=excluded.city,
                   pop=excluded.pop""",
            (ifid, router_ip, name, description, capacity_mbps,
             equipment, link_type, operator, partner, city, pop, now),
        )
        row = conn.execute(
            "SELECT * FROM interfaces WHERE ifid = ? AND router_ip = ?", (ifid, router_ip)
        ).fetchone()
    return dict(row)


def delete_interface(iface_id: int) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM interfaces WHERE id = ?", (iface_id,))
    return cur.rowcount > 0


def interface_detail(
    iface_id: int,
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = 300,
) -> dict | None:
    """Dashboard completo de uma interface: IN/OUT timeseries + top ASN/proto/porta/IPs."""
    with get_db() as conn:
        iface = conn.execute("SELECT * FROM interfaces WHERE id = ?", (iface_id,)).fetchone()
        if not iface:
            return None

        ifid = iface["ifid"]
        router_ip = iface["router_ip"]

        ep: list = []
        ec = ["source = 'goflow2'"]
        if epoch_begin is not None:
            ec.append("tstamp >= ?"); ep.append(epoch_begin)
        if epoch_end is not None:
            ec.append("tstamp <= ?"); ep.append(epoch_end)
        if router_ip:
            ec.append("sampler = ?"); ep.append(router_ip)
        ew = " AND ".join(ec)

        in_cond  = f"in_if  = {ifid}"
        out_cond = f"out_if = {ifid}"
        iface_cond = f"({in_cond} OR {out_cond})"

        # Summary
        summ = conn.execute(
            f"""SELECT COALESCE(SUM(bytes), 0) AS total_bytes,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN bytes ELSE 0 END), 0) AS in_bytes,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN bytes ELSE 0 END), 0) AS out_bytes,
                       COUNT(*) AS total_flows
                FROM events WHERE {ew} AND {iface_cond}""",
            ep,
        ).fetchone()

        # IN/OUT timeseries
        ts_rows = conn.execute(
            f"""SELECT (tstamp / ?) * ? AS bucket,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN bytes ELSE 0 END), 0) AS in_bytes,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN bytes ELSE 0 END), 0) AS out_bytes,
                       COALESCE(SUM(CASE WHEN {in_cond}  THEN 1 ELSE 0 END), 0) AS in_flows,
                       COALESCE(SUM(CASE WHEN {out_cond} THEN 1 ELSE 0 END), 0) AS out_flows
                FROM events WHERE {ew} AND {iface_cond}
                GROUP BY bucket ORDER BY bucket ASC""",
            [bucket_seconds, bucket_seconds, *ep],
        ).fetchall()

        # Top ASNs (src_as for IN, dst_as for OUT — who is communicating via this interface)
        asn_in = conn.execute(
            f"""SELECT src_as AS asn,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {in_cond} AND src_as IS NOT NULL AND src_as != 0
                GROUP BY src_as ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()
        asn_out = conn.execute(
            f"""SELECT dst_as AS asn,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {out_cond} AND dst_as IS NOT NULL AND dst_as != 0
                GROUP BY dst_as ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Merge ASN results
        asn_map: dict[int, dict] = {}
        for r in asn_in:
            asn_map[r["asn"]] = {"asn": r["asn"], "bytes": r["bytes"] or 0, "flows": r["flows"]}
        for r in asn_out:
            a = r["asn"]
            if a in asn_map:
                asn_map[a]["bytes"] += r["bytes"] or 0
                asn_map[a]["flows"] += r["flows"]
            else:
                asn_map[a] = {"asn": a, "bytes": r["bytes"] or 0, "flows": r["flows"]}
        top_asns = sorted(asn_map.values(), key=lambda x: x["bytes"], reverse=True)[:10]

        # Top protocols
        proto_rows = conn.execute(
            f"""SELECT protocol,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {iface_cond} AND protocol IS NOT NULL
                GROUP BY protocol ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top destination ports (services flowing through interface)
        port_rows = conn.execute(
            f"""SELECT dst_port AS port, protocol,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {in_cond} AND dst_port IS NOT NULL
                GROUP BY dst_port, protocol ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top source IPs (sending IN through this interface)
        src_rows = conn.execute(
            f"""SELECT src_ip AS ip,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {in_cond} AND src_ip IS NOT NULL
                GROUP BY src_ip ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

        # Top destination IPs (receiving OUT through this interface)
        dst_rows = conn.execute(
            f"""SELECT dst_ip AS ip,
                       COALESCE(SUM(bytes), 0) AS bytes,
                       COUNT(*) AS flows
                FROM events WHERE {ew} AND {out_cond} AND dst_ip IS NOT NULL
                GROUP BY dst_ip ORDER BY bytes DESC LIMIT 10""",
            ep,
        ).fetchall()

    ts_list = [dict(r) for r in ts_rows]
    bucket_bytes = [r["in_bytes"] + r["out_bytes"] for r in ts_list]
    peak_bytes = max(bucket_bytes) if bucket_bytes else 0
    avg_bytes  = sum(bucket_bytes) / len(bucket_bytes) if bucket_bytes else 0

    capacity_mbps = iface["capacity_mbps"] or 0

    def to_mbps(b: float) -> float:
        return round(b * 8 / max(bucket_seconds, 1) / 1_000_000, 3)

    avg_mbps = to_mbps(avg_bytes)
    utilization_pct = round(avg_mbps / capacity_mbps * 100, 1) if capacity_mbps > 0 else 0.0

    return {
        "iface": dict(iface),
        "summary": {
            "total_bytes":     summ["total_bytes"] or 0,
            "in_bytes":        summ["in_bytes"] or 0,
            "out_bytes":       summ["out_bytes"] or 0,
            "total_flows":     summ["total_flows"] or 0,
            "peak_mbps":       to_mbps(peak_bytes),
            "avg_mbps":        avg_mbps,
            "utilization_pct": utilization_pct,
        },
        "timeseries":    ts_list,
        "top_asns":      top_asns,
        "top_protocols": [dict(r) for r in proto_rows],
        "top_ports":     [dict(r) for r in port_rows],
        "top_src":       [dict(r) for r in src_rows],
        "top_dst":       [dict(r) for r in dst_rows],
    }


def interfaces_ranking(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
) -> list[dict]:
    """Ranking de interfaces por saturação e volume, com flag de imbalance."""
    ep: list = []
    ec = ["source = 'goflow2'"]
    if epoch_begin is not None:
        ec.append("tstamp >= ?"); ep.append(epoch_begin)
    if epoch_end is not None:
        ec.append("tstamp <= ?"); ep.append(epoch_end)
    ew = " AND ".join(ec)

    with get_db() as conn:
        ifaces = conn.execute("SELECT * FROM interfaces ORDER BY name").fetchall()
        if not ifaces:
            return []

        results = []
        for iface in ifaces:
            ifid = iface["ifid"]
            router_ip = iface["router_ip"]
            capacity_mbps = iface["capacity_mbps"] or 0

            ep_iface = list(ep)
            ec_iface = list(ec)
            if router_ip:
                ec_iface.append("sampler = ?"); ep_iface.append(router_ip)
            ew_iface = " AND ".join(ec_iface)

            row = conn.execute(
                f"""SELECT COALESCE(SUM(bytes), 0) AS total_bytes,
                           COALESCE(SUM(CASE WHEN in_if  = {ifid} THEN bytes ELSE 0 END), 0) AS in_bytes,
                           COALESCE(SUM(CASE WHEN out_if = {ifid} THEN bytes ELSE 0 END), 0) AS out_bytes,
                           COUNT(*) AS total_flows,
                           COUNT(DISTINCT tstamp / 60) AS buckets
                    FROM events WHERE {ew_iface} AND (in_if = {ifid} OR out_if = {ifid})""",
                ep_iface,
            ).fetchone()

            in_b  = row["in_bytes"]  or 0
            out_b = row["out_bytes"] or 0
            total = row["total_bytes"] or 0
            buckets = row["buckets"] or 1

            avg_in_mbps  = round(in_b  * 8 / buckets / 60 / 1_000_000, 3)
            avg_out_mbps = round(out_b * 8 / buckets / 60 / 1_000_000, 3)
            avg_mbps = round((in_b + out_b) * 8 / buckets / 60 / 1_000_000 / 2, 3)

            utilization_pct = round(avg_mbps / capacity_mbps * 100, 1) if capacity_mbps > 0 else 0.0
            imbalance_ratio = round(max(in_b, out_b) / max(min(in_b, out_b), 1), 2)

            results.append({
                **dict(iface),
                "total_bytes":     total,
                "in_bytes":        in_b,
                "out_bytes":       out_b,
                "total_flows":     row["total_flows"] or 0,
                "avg_mbps":        avg_mbps,
                "avg_in_mbps":     avg_in_mbps,
                "avg_out_mbps":    avg_out_mbps,
                "utilization_pct": utilization_pct,
                "imbalance_ratio": imbalance_ratio,
            })

        results.sort(key=lambda x: x["utilization_pct"], reverse=True)
        return results


def interfaces_stats(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
) -> list[dict]:
    where_parts = ["source = 'goflow2'"]
    params: list = []
    if epoch_begin is not None:
        where_parts.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        where_parts.append("tstamp <= ?")
        params.append(epoch_end)
    where = " AND ".join(where_parts)

    with get_db() as conn:
        rows = conn.execute(
            f"""WITH filtered AS (
                    SELECT in_if, out_if, bytes, packets
                    FROM events WHERE {where}
                )
                SELECT i.id,
                       COALESCE(SUM(CASE WHEN f.in_if  = i.ifid THEN f.bytes   ELSE 0 END), 0) AS bytes_in,
                       COALESCE(SUM(CASE WHEN f.out_if = i.ifid THEN f.bytes   ELSE 0 END), 0) AS bytes_out,
                       COALESCE(SUM(CASE WHEN f.in_if  = i.ifid THEN f.packets ELSE 0 END), 0) AS packets_in,
                       COALESCE(SUM(CASE WHEN f.out_if = i.ifid THEN f.packets ELSE 0 END), 0) AS packets_out,
                       COALESCE(SUM(CASE WHEN f.in_if  = i.ifid THEN 1         ELSE 0 END), 0) AS flows_in,
                       COALESCE(SUM(CASE WHEN f.out_if = i.ifid THEN 1         ELSE 0 END), 0) AS flows_out
                FROM interfaces i
                LEFT JOIN filtered f ON f.in_if = i.ifid OR f.out_if = i.ifid
                GROUP BY i.id""",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def discovered_interfaces(epoch_begin: int | None = None) -> list[dict]:
    """Return unique (in_if, out_if, sampler) combinations seen in recent flows."""
    clauses = ["source = 'goflow2'", "(in_if IS NOT NULL OR out_if IS NOT NULL)"]
    params: list = []
    if epoch_begin is not None:
        clauses.append("tstamp >= ?")
        params.append(epoch_begin)
    where = " AND ".join(clauses)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT ifid, sampler, COUNT(*) AS flows, SUM(bytes) AS total_bytes
                FROM (
                    SELECT in_if AS ifid, sampler, bytes FROM events WHERE {where} AND in_if IS NOT NULL
                    UNION ALL
                    SELECT out_if AS ifid, sampler, bytes FROM events WHERE {where} AND out_if IS NOT NULL
                )
                GROUP BY ifid, sampler
                ORDER BY total_bytes DESC
                LIMIT 50""",
            [*params, *params],
        ).fetchall()
    return [dict(r) for r in rows]


# ─── Attack Correlation ───────────────────────────────────────────────────────

def correlated_attacks(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    min_events: int = 50,
    limit: int = 30,
) -> list[dict]:
    """Group GoFlow2 flows by destination IP (victim) to surface attack campaigns.

    Works directly on flow data — no dependency on the alert classifier.
    Severity is derived from heuristics (unique sources + flow volume).
    min_events is the minimum flow count threshold per victim.
    """
    clauses = ["source = 'goflow2'", "dst_ip IS NOT NULL"]
    params: list = []
    if epoch_begin is not None:
        clauses.append("tstamp >= ?")
        params.append(epoch_begin)
    if epoch_end is not None:
        clauses.append("tstamp <= ?")
        params.append(epoch_end)
    where = " AND ".join(clauses)

    with get_db() as conn:
        # Top victims by byte volume, one query
        rows = conn.execute(
            f"""SELECT dst_ip AS victim_ip,
                       COUNT(*)                    AS flow_count,
                       COALESCE(SUM(bytes), 0)    AS total_bytes,
                       COALESCE(SUM(packets), 0)  AS total_packets,
                       MIN(tstamp)                 AS first_seen,
                       MAX(tstamp)                 AS last_seen,
                       COUNT(DISTINCT src_ip)      AS unique_sources,
                       COUNT(DISTINCT protocol)    AS protocol_count
                FROM events WHERE {where}
                GROUP BY dst_ip
                HAVING flow_count >= ?
                ORDER BY total_bytes DESC
                LIMIT ?""",
            [*params, min_events, limit],
        ).fetchall()

        results = []
        for row in rows:
            victim_ip = row["victim_ip"]
            r = dict(row)
            duration = (r["last_seen"] - r["first_seen"]) if r["first_seen"] and r["last_seen"] else 0
            r["event_count"] = r.pop("flow_count")
            r["duration_s"]  = duration

            # Severity heuristic: distributed (many sources) OR high volume → critical
            unique_src = r["unique_sources"]
            bytes_total = r["total_bytes"]
            mbps = bytes_total * 8 / 1_000_000 / max(duration, 1)
            r["max_severity"] = "critical" if unique_src >= 10 or mbps >= 10 else "warning"

            # Protocols for this victim
            proto_rows = conn.execute(
                f"""SELECT protocol AS proto, COUNT(*) AS cnt, COALESCE(SUM(bytes), 0) AS bytes
                    FROM events WHERE {where} AND dst_ip = ?
                    GROUP BY protocol ORDER BY bytes DESC LIMIT 5""",
                [*params, victim_ip],
            ).fetchall()
            r["protocols"] = [dict(p) for p in proto_rows]

            # Top source IPs
            src_rows = conn.execute(
                f"""SELECT src_ip AS ip, COUNT(*) AS cnt, COALESCE(SUM(bytes), 0) AS bytes
                    FROM events WHERE {where} AND dst_ip = ? AND src_ip IS NOT NULL
                    GROUP BY src_ip ORDER BY bytes DESC LIMIT 5""",
                [*params, victim_ip],
            ).fetchall()
            r["top_sources"] = [dict(s) for s in src_rows]

            # Top source ASNs
            asn_rows = conn.execute(
                f"""SELECT src_as AS asn, COUNT(*) AS cnt, COALESCE(SUM(bytes), 0) AS bytes
                    FROM events WHERE {where} AND dst_ip = ? AND src_as IS NOT NULL AND src_as != 0
                    GROUP BY src_as ORDER BY bytes DESC LIMIT 5""",
                [*params, victim_ip],
            ).fetchall()
            r["top_asns"] = [dict(a) for a in asn_rows]

            results.append(r)

    return results


def get_alert_statuses(keys: list[str]) -> list[dict]:
    if not keys:
        return []
    with get_db() as conn:
        placeholders = ",".join("?" for _ in keys)
        rows = conn.execute(
            f"SELECT * FROM alert_status WHERE alert_key IN ({placeholders})", keys
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_alert_status(
    alert_key: str,
    status: str,
    assigned_to: str | None,
    note: str | None,
    updated_by: str,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO alert_status (alert_key, status, assigned_to, note, updated_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(alert_key) DO UPDATE SET
                   status=excluded.status,
                   assigned_to=excluded.assigned_to,
                   note=excluded.note,
                   updated_by=excluded.updated_by,
                   updated_at=excluded.updated_at""",
            (alert_key, status, assigned_to, note, updated_by, now),
        )
        row = conn.execute(
            "SELECT * FROM alert_status WHERE alert_key = ?", (alert_key,)
        ).fetchone()
    return dict(row)

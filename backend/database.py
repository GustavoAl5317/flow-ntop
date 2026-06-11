import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from classifier import classify_event, detect_volumetric_attacks

DB_PATH = Path(os.getenv("FLOW_DB_PATH", Path(__file__).parent / "flow.db"))


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
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
        """)
        _migrate_events_table(conn)


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
    now = datetime.now(timezone.utc).isoformat()
    netflow_cols = list(NETFLOW_COLUMNS.keys())
    inserted = 0
    max_tstamp = 0
    with get_db() as conn:
        for raw_ev in events:
            tstamp = raw_ev.get("tstamp")
            if tstamp is None:
                continue
            ev = normalize_netflow_event(raw_ev)
            alert_id = ev.get("alert_id") or 0
            max_tstamp = max(max_tstamp, int(tstamp))

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
                source,
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

        if source == "goflow2" and max_tstamp:
            detect_volumetric_attacks(conn, max_tstamp)

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

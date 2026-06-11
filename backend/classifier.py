"""Lightweight classification engine for raw NetFlow events.

Computes a `severity` (info/notice/warning/error/critical) and a numeric
`score` (0-100, higher = more suspicious) for flows coming from the GoFlow2
collector, based on:

  - Per-flow heuristics: protocol, destination port, packet/byte ratio
    (amplification/reflection signatures).
  - Per-destination volumetric analysis: total bytes/packets toward a single
    destination IP within a short time window (DDoS detection).

Thresholds are intentionally simple defaults and can be tuned later (e.g.
exposed via the existing `thresholds` table).
"""

from __future__ import annotations

import sqlite3

# UDP/TCP ports commonly abused for reflection/amplification DDoS attacks.
AMPLIFICATION_PORTS = {
    19,    # CHARGEN
    53,    # DNS
    123,   # NTP
    161,   # SNMP
    389,   # CLDAP
    1900,  # SSDP
    3702,  # WS-Discovery
    5353,  # mDNS
    11211, # Memcached
}

SEVERITY_ORDER = ["info", "notice", "warning", "error", "critical"]

# Volumetric thresholds (per destination IP, within WINDOW_SECONDS).
WINDOW_SECONDS = 60
BYTES_WARNING = 50_000_000        # ~6.6 Mbps sustained for 60s
BYTES_CRITICAL = 200_000_000      # ~26 Mbps sustained for 60s
PACKETS_WARNING = 50_000
PACKETS_CRITICAL = 200_000


def severity_from_score(score: int) -> str:
    if score >= 70:
        return "critical"
    if score >= 40:
        return "warning"
    if score >= 20:
        return "notice"
    return "info"


def classify_event(ev: dict) -> tuple[str, int]:
    """Per-flow heuristic classification. Returns (severity, score).

    Note: a single ~1400-1500 byte packet per flow is the *normal* signature
    of sampled HTTPS/TCP traffic (MTU-sized segments) and must NOT be scored
    on its own — otherwise virtually all web traffic gets flagged. The
    "single oversized packet" heuristic is only meaningful for UDP traffic on
    known amplification/reflection ports, where it indicates a reflected
    response (small request -> large single-packet reply).
    """
    score = 5
    protocol = str(ev.get("protocol") or ev.get("proto") or "").upper()
    dst_port = ev.get("dst_port")
    src_port = ev.get("src_port")
    num_bytes = ev.get("bytes") or 0
    packets = ev.get("packets") or 0

    is_amplification_flow = dst_port in AMPLIFICATION_PORTS or src_port in AMPLIFICATION_PORTS

    if is_amplification_flow:
        score += 30

        if protocol == "UDP" and packets == 1 and num_bytes > 1000:
            # Single large UDP packet from an amplification-prone port:
            # classic reflection/amplification reply signature.
            score += 25

    if protocol == "ICMP":
        score += 10

    score = max(0, min(100, score))
    return severity_from_score(score), score


def _max_severity(a: str, b: str) -> str:
    ia = SEVERITY_ORDER.index(a) if a in SEVERITY_ORDER else 0
    ib = SEVERITY_ORDER.index(b) if b in SEVERITY_ORDER else 0
    return SEVERITY_ORDER[max(ia, ib)]


def detect_volumetric_attacks(conn: sqlite3.Connection, now_tstamp: int) -> int:
    """Re-evaluate severity/score for flows toward IPs receiving abnormal
    traffic volume within the last WINDOW_SECONDS. Returns number of
    destination IPs flagged.
    """
    window_start = now_tstamp - WINDOW_SECONDS

    rows = conn.execute(
        """SELECT ip, SUM(bytes) AS total_bytes, SUM(packets) AS total_packets
           FROM events
           WHERE tstamp >= ? AND ip IS NOT NULL AND source = 'goflow2'
           GROUP BY ip
           HAVING total_bytes >= ? OR total_packets >= ?""",
        (window_start, BYTES_WARNING, PACKETS_WARNING),
    ).fetchall()

    flagged = 0
    for row in rows:
        total_bytes = row["total_bytes"] or 0
        total_packets = row["total_packets"] or 0

        if total_bytes >= BYTES_CRITICAL or total_packets >= PACKETS_CRITICAL:
            severity, score = "critical", 95
        else:
            severity, score = "warning", 60

        conn.execute(
            """UPDATE events
               SET severity = ?, score = MAX(IFNULL(score, 0), ?)
               WHERE ip = ? AND tstamp >= ? AND source = 'goflow2'
                 AND (severity IS NULL OR severity != 'critical')""",
            (severity, score, row["ip"], window_start),
        )
        flagged += 1

    return flagged

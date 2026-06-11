import csv
import io
from datetime import timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import authenticate_user, create_access_token, get_current_user
from database import (
    build_summary,
    delete_threshold,
    get_alert_statuses,
    init_db,
    insert_events,
    list_reports,
    list_thresholds,
    netflow_bandwidth_by_client,
    netflow_incidents,
    netflow_protocols,
    netflow_timeseries,
    netflow_top_asn,
    netflow_top_ports,
    netflow_top_talkers,
    query_events,
    save_report,
    upsert_alert_status,
    upsert_threshold,
)

app = FastAPI(title="Flow Guard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


# ─── Schemas ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


class EventBulkRequest(BaseModel):
    events: list[dict[str, Any]]
    source: str = "ntopng"


class ReportSaveRequest(BaseModel):
    name: str
    report_type: str = "ddos"
    epoch_begin: int
    epoch_end: int
    summary: dict[str, Any]


class ThresholdRequest(BaseModel):
    ifid: int
    metric: str
    label: str
    warning_value: float | None = None
    critical_value: float | None = None
    enabled: bool = True


class AlertStatusRequest(BaseModel):
    alert_key: str
    status: str
    assigned_to: str | None = None
    note: str | None = None


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    token = create_access_token(
        {"sub": user["username"], "role": user["role"]},
        expires_delta=timedelta(hours=24),
    )
    return TokenResponse(
        access_token=token,
        username=user["username"],
        role=user["role"],
    )


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    return user


# ─── Events ───────────────────────────────────────────────────────────────────

@app.post("/api/events/bulk")
def bulk_insert_events(
    body: EventBulkRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    count = insert_events(body.events, source=body.source)
    return {"inserted": count, "requested": len(body.events)}


@app.get("/api/events")
def get_events(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    alert_id: int | None = None,
    severity: str | None = None,
    ip: str | None = None,
    limit: int = Query(default=500, le=2000),
    offset: int = 0,
    user: dict = Depends(get_current_user),
) -> dict:
    records, total = query_events(
        epoch_begin=epoch_begin,
        epoch_end=epoch_end,
        alert_id=alert_id,
        severity=severity,
        ip=ip,
        limit=limit,
        offset=offset,
    )
    return {"records": records, "total": total}


# ─── NetFlow aggregations (GoFlow2 pipeline) ──────────────────────────────────

@app.get("/api/netflow/top-talkers")
def get_netflow_top_talkers(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    direction: str = Query(default="src", pattern="^(src|dst)$"),
    limit: int = Query(default=20, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_top_talkers(epoch_begin, epoch_end, direction, limit)}


@app.get("/api/netflow/top-ports")
def get_netflow_top_ports(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    port_type: str = Query(default="dst", pattern="^(src|dst)$"),
    limit: int = Query(default=20, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_top_ports(epoch_begin, epoch_end, port_type, limit)}


@app.get("/api/netflow/top-asn")
def get_netflow_top_asn(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    asn_type: str = Query(default="src", pattern="^(src|dst)$"),
    limit: int = Query(default=20, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_top_asn(epoch_begin, epoch_end, asn_type, limit)}


@app.get("/api/netflow/protocols")
def get_netflow_protocols(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_protocols(epoch_begin, epoch_end)}


@app.get("/api/netflow/bandwidth-by-client")
def get_netflow_bandwidth_by_client(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    limit: int = Query(default=20, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_bandwidth_by_client(epoch_begin, epoch_end, limit)}


@app.get("/api/netflow/timeseries")
def get_netflow_timeseries(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    bucket_seconds: int = Query(default=60, ge=10, le=3600),
    ip: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_timeseries(epoch_begin, epoch_end, bucket_seconds, ip)}


@app.get("/api/netflow/incidents")
def get_netflow_incidents(
    epoch_begin: int | None = None,
    epoch_end: int | None = None,
    severity: str | None = None,
    limit: int = Query(default=200, le=1000),
    user: dict = Depends(get_current_user),
) -> dict:
    return {"records": netflow_incidents(epoch_begin, epoch_end, severity, limit)}


# ─── Reports ──────────────────────────────────────────────────────────────────

@app.get("/api/reports/summary")
def report_summary(
    epoch_begin: int,
    epoch_end: int,
    user: dict = Depends(get_current_user),
) -> dict:
    return build_summary(epoch_begin, epoch_end)


@app.get("/api/reports/export.csv")
def export_csv(
    epoch_begin: int,
    epoch_end: int,
    user: dict = Depends(get_current_user),
):
    from fastapi.responses import StreamingResponse

    records, _ = query_events(epoch_begin=epoch_begin, epoch_end=epoch_end, limit=5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Horário", "Alert ID", "Severidade", "IP Alvo", "IP Origem", "Score", "Duração", "Protocolo"])
    for r in records:
        ts = r.get("tstamp")
        horario = ""
        if ts:
            from datetime import datetime, timezone
            horario = datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%d/%m/%Y %H:%M:%S")
        writer.writerow([
            horario,
            r.get("alert_id", ""),
            r.get("severity", ""),
            r.get("ip", ""),
            r.get("cli_ip", ""),
            r.get("score", ""),
            r.get("duration", ""),
            r.get("proto", ""),
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=relatorio-{epoch_begin}-{epoch_end}.csv"},
    )


@app.post("/api/reports")
def create_report(
    body: ReportSaveRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    report_id = save_report(
        name=body.name,
        report_type=body.report_type,
        epoch_begin=body.epoch_begin,
        epoch_end=body.epoch_end,
        summary=body.summary,
        created_by=user["username"],
    )
    return {"id": report_id}


@app.get("/api/reports")
def get_saved_reports(
    limit: int = 20,
    user: dict = Depends(get_current_user),
) -> dict:
    return {"reports": list_reports(limit=limit)}


# ─── Thresholds ───────────────────────────────────────────────────────────────

@app.get("/api/thresholds")
def get_thresholds(
    ifid: int | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    return {"thresholds": list_thresholds(ifid=ifid)}


@app.post("/api/thresholds")
def save_threshold(
    body: ThresholdRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    return upsert_threshold(
        ifid=body.ifid,
        metric=body.metric,
        label=body.label,
        warning_value=body.warning_value,
        critical_value=body.critical_value,
        enabled=body.enabled,
    )


@app.delete("/api/thresholds/{threshold_id}")
def remove_threshold(
    threshold_id: int,
    user: dict = Depends(get_current_user),
) -> dict:
    ok = delete_threshold(threshold_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Threshold não encontrado")


# ─── Alert Status ─────────────────────────────────────────────────────────────

@app.get("/api/alert-status")
def get_alert_status(
    keys: str,
    user: dict = Depends(get_current_user),
) -> dict:
    key_list = [k for k in keys.split(",") if k]
    rows = get_alert_statuses(key_list)
    return {"statuses": {r["alert_key"]: r for r in rows}}


@app.post("/api/alert-status")
def save_alert_status(
    body: AlertStatusRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    return upsert_alert_status(
        alert_key=body.alert_key,
        status=body.status,
        assigned_to=body.assigned_to,
        note=body.note,
        updated_by=user["username"],
    )
    return {"deleted": True}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "flow-guard-api"}

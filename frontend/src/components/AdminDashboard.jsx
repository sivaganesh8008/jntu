import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, ChevronRight, ClipboardList, Crosshair, FileAudio, ImagePlus, MapPin, Radio, Search, Siren, ShieldAlert, Sparkles, Users } from "lucide-react";
import { Circle, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { Badge, ErrorBox, navigateTo, RefreshButton, StatCard, Topbar } from "./Common";
import IncidentDetailPage from "./IncidentDetailPage";
import ReportDetailPage from "./ReportDetailPage";

const URGENCY_COLORS = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#10b981",
};
const RESOLVED_COLOR = "#64748b";
const LIVE_COLOR = "#2563eb";
const URGENCY_LABEL = { critical: "Critical", high: "High", medium: "Moderate", low: "Low" };

const ZONE_RADIUS = { critical: 1000, high: 700, medium: 500, low: 300 };

const urgencyRank = { critical: 0, high: 1, medium: 2, low: 3 };
const statusRank = { active: 0, rescue_in_progress: 1, resolved: 2 };

const isResolved = (i) => i.status === "resolved";
const colorFor = (i) => (isResolved(i) ? RESOLVED_COLOR : URGENCY_COLORS[i.urgency] || URGENCY_COLORS.medium);
const urgencyLabel = (u) => URGENCY_LABEL[u] || u || "Moderate";
const zoneRadiusFor = (i) => Number(i.zone_radius_m) || ZONE_RADIUS[i.urgency] || ZONE_RADIUS.medium;
const formatRadius = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`);

const stateLabel = (s) => (s === "resolved" ? "RESCUED / RESOLVED" : s === "rescue_in_progress" ? "RESCUE IN PROGRESS" : "EMERGENCY / PENDING");
const progressFor = (i) => (i.progress_percent != null ? Number(i.progress_percent) : i.status === "resolved" ? 100 : i.status === "rescue_in_progress" ? 65 : 20);

function sortIncidents(items) {
  return [...items].sort((a, b) => {
    const r = (isResolved(a) ? 1 : 0) - (isResolved(b) ? 1 : 0);
    if (r) return r;
    const u = (urgencyRank[a.urgency] ?? 9) - (urgencyRank[b.urgency] ?? 9);
    if (u) return u;
    const s = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (s) return s;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
}

const iconCache = {};
function pinIcon(color, { pulse = false, dim = false } = {}) {
  const key = `${color}-${pulse}-${dim}`;
  if (iconCache[key]) return iconCache[key];
  iconCache[key] = L.divIcon({
    className: "pin-icon",
    html: `
      <div class="pin-wrap" style="opacity:${dim ? 0.6 : 1}">
        ${pulse ? `<span class="pin-ring" style="background:${color}"></span>` : ""}
        <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 1C7.3 1 1 7.2 1 14.8c0 10.4 14 26.2 14 26.2s14-15.8 14-26.2C29 7.2 22.7 1 15 1z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
          <circle cx="15" cy="15" r="5" fill="#ffffff"/>
        </svg>
      </div>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -38],
    tooltipAnchor: [14, -22],
  });
  return iconCache[key];
}
const incidentIcon = (i) => pinIcon(colorFor(i), { pulse: i.urgency === "critical" && !isResolved(i), dim: isResolved(i) });
const liveIcon = pinIcon(LIVE_COLOR);

function MapStyles() {
  return (
    <style>{`
      .pin-icon { background: transparent; border: 0; }
      .pin-wrap { position: relative; width: 30px; height: 42px; }
      .pin-wrap svg { position: relative; display: block; filter: drop-shadow(0 2px 5px rgba(0,0,0,.4)); }
      .pin-ring {
        position: absolute; left: 3px; top: 3px; width: 24px; height: 24px;
        border-radius: 50%; opacity: .6; animation: pin-pulse 1.6s ease-out infinite;
      }
      @keyframes pin-pulse { 0% { transform: scale(.8); opacity: .7; } 100% { transform: scale(2.6); opacity: 0; } }
      .list-divider {
        display: flex; align-items: center; gap: 12px; margin: 18px 0 10px; padding: 0 16px;
        font-size: 11px; font-weight: 800; letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase;
      }
      .list-divider::before, .list-divider::after { content: ""; flex: 1; height: 1px; background: var(--border-color); }
      .zone-tag { display: inline-flex; align-items: center; gap: 4px; }
    `}</style>
  );
}

function FitMap({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(points, { padding: [35, 35], maxZoom: 14 });
  }, [points, map]);
  return null;
}

function IncidentCard({ incident, onClick }) {
  const p = progressFor(incident);
  const color = colorFor(incident);
  const resolved = isResolved(incident);
  return (
    <button
      className="incident-card"
      onClick={() => onClick(incident.id)}
      style={{ borderLeft: `5px solid ${color}`, opacity: resolved ? 0.75 : 1 }}
    >
      <div className="incident-card-top">
        <div className="incident-title">
          <span className={`priority-dot ${incident.urgency}`} style={{ background: color }} />
          {incident.title}
        </div>
        <Badge kind={`urgency-${incident.urgency}`}>{urgencyLabel(incident.urgency)}</Badge>
      </div>
      <p>{incident.summary || "No summary available."}</p>
      <div className="incident-meta">
        <span><MapPin size={13} />{incident.location_text || "Location pending"}</span>
        <span><Users size={13} />{incident.people_affected ?? "?"} affected</span>
        {!resolved && incident.latitude != null && incident.longitude != null && (
          <span className="zone-tag"><Crosshair size={13} />Zone ≈ {formatRadius(zoneRadiusFor(incident))}</span>
        )}
        <Badge kind={`status-${incident.status}`}>{stateLabel(incident.status)}</Badge>
      </div>
      <div className="mini-progress"><div style={{ width: `${p}%`, background: color }} /></div>
      <div className="incident-progress-row">
        <span>{p}% progress</span>
        <span>{new Date(incident.updated_at).toLocaleString()}</span>
      </div>
    </button>
  );
}

function PendingReportCard({ report, onClick }) {
  const u = report.ai_urgency || "medium";
  return (
    <button className={`pending-report ${u}`} onClick={() => onClick(report.id)} style={{ borderLeft: `5px solid ${URGENCY_COLORS[u] || URGENCY_COLORS.medium}` }}>
      <div className="pending-report-icon"><ShieldAlert size={20} /></div>
      <div className="pending-report-body">
        <div className="pending-top">
          <strong>{report.ai_summary || report.message_text || "Media report"}</strong>
          <Badge kind={`urgency-${u}`}>{urgencyLabel(u)}</Badge>
        </div>
        <p>{report.ai_current_state || "AI analysis ready — responder review required."}</p>
        <div className="pending-meta">
          <span>{report.full_name}</span>
          <span>{new Date(report.created_at).toLocaleString()}</span>
          <span>{report.channel}</span>
        </div>
      </div>
      <ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
    </button>
  );
}

function ReportRow({ report, onClick }) {
  return (
    <button className="report-row" onClick={() => onClick(report.id)}>
      <div className="report-source">
        <strong>{report.full_name}</strong>
        <span>{new Date(report.created_at).toLocaleString()}</span>
      </div>
      <div className="report-content">
        <div className="report-type">
          <Badge>{report.channel}</Badge>
          {report.ai_urgency && <Badge kind={`urgency-${report.ai_urgency}`}>{urgencyLabel(report.ai_urgency)}</Badge>}
          {report.photo_path && <ImagePlus size={14} />} {report.audio_path && <FileAudio size={14} />}
        </div>
        <p>{report.ai_summary || report.message_text || "Media-only report"}</p>
      </div>
      <div><Badge kind={report.ai_status}>{report.ai_status}</Badge></div>
      <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>
        {report.incident_id ? `Incident #${report.incident_id}` : "Needs review"}
      </div>
      <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
    </button>
  );
}

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/g, "") || "/";
  let m = path.match(/^\/admin\/incidents\/(\d+)$/);
  if (m) return { type: "incident", id: Number(m[1]) };
  m = path.match(/^\/admin\/reports\/(\d+)$/);
  if (m) return { type: "report", id: Number(m[1]) };
  return { type: "dashboard" };
}

export default function AdminDashboard({ user, onLogout }) {
  const [route, setRoute] = useState(parseRoute());
  const [data, setData] = useState({ incidents: [], reports: [], locations: [], stats: {} });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (type, id) => {
    let path = "/admin";
    if (type === "incident") path = `/admin/incidents/${id}`;
    else if (type === "report") path = `/admin/reports/${id}`;

    navigateTo(path);
  };

  const back = () => navigate("dashboard");

  const load = async () => {
    setRefreshing(true);
    try {
      const r = await api(`/api/admin/dashboard?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`);
      r.incidents = sortIncidents(r.incidents);
      setData(r);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { if (route.type === "dashboard") load(); }, [status, route.type]);
  useEffect(() => {
    if (route.type !== "dashboard") return;
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, [status, search, route.type]);

  const pendingReports = useMemo(
    () =>
      data.reports
        .filter((r) => !r.incident_id && ["processed", "error", "pending"].includes(r.ai_status))
        .sort((a, b) => (urgencyRank[a.ai_urgency] ?? 4) - (urgencyRank[b.ai_urgency] ?? 4) || new Date(b.created_at) - new Date(a.created_at)),
    [data.reports]
  );

  const mappedIncidents = useMemo(
    () => data.incidents.filter((i) => i.latitude != null && i.longitude != null),
    [data.incidents]
  );
  const liveLocations = useMemo(
    () => data.locations.filter((x) => x.is_live && x.latitude != null && x.longitude != null),
    [data.locations]
  );
  const mapPoints = useMemo(
    () => [
      ...mappedIncidents.map((i) => [Number(i.latitude), Number(i.longitude)]),
      ...liveLocations.map((x) => [Number(x.latitude), Number(x.longitude)]),
    ],
    [mappedIncidents, liveLocations]
  );

  if (route.type === "incident") return <IncidentDetailPage user={user} onLogout={onLogout} incidentId={route.id} onBack={back} onOpenReport={(id) => navigate("report", id)} />;
  if (route.type === "report") return <ReportDetailPage user={user} onLogout={onLogout} reportId={route.id} onBack={back} onOpenIncident={(id) => navigate("incident", id)} />;

  const activeIncidents = data.incidents.filter((x) => !isResolved(x));
  const resolvedIncidents = data.incidents.filter(isResolved);

  const markerOrder = (i) => (isResolved(i) ? -1000 : 1000 - (urgencyRank[i.urgency] ?? 4) * 100);

  return (
    <div className="app-shell">
      <Topbar user={user} onLogout={onLogout} />
      <MapStyles />
      <main className="dashboard">
        <div className="page-heading">
          <div>
            <span className="eyebrow">CONTROL ROOM</span>
            <h1>Emergency Command Center</h1>
            <p>Monitor real-time evidence, prioritize active emergencies, and dispatch rescue teams.</p>
          </div>
          <RefreshButton loading={refreshing} onClick={load} />
        </div>
        <ErrorBox>{error}</ErrorBox>

        {/* PROMINENT QUICK STAGE & RESCUE NAVIGATION HERO */}
        <section className="dashboard-nav-hero">
          <div className="nav-hero-card rescue-hero" onClick={() => navigateTo("/rescue")}>
            <div className="nav-hero-icon"><Radio size={24} /></div>
            <div className="nav-hero-content">
              <span className="nav-hero-badge">Real-Time Dispatch</span>
              <h3>Rescue Dispatch Console</h3>
              <p>Automated unit dispatch, traffic corridors, and radio notification feeds.</p>
            </div>
            <div className="nav-hero-arrow"><ArrowRight size={20} /></div>
          </div>

          <div className="nav-hero-card stages-hero" onClick={() => navigateTo("/stages")}>
            <div className="nav-hero-icon"><BarChart3 size={24} /></div>
            <div className="nav-hero-content">
              <span className="nav-hero-badge ai-badge"><Sparkles size={12} /> Gemini Spatial Analysis</span>
              <h3>Emergency Stage Analyzer</h3>
              <p>Multi-stage incident tracking, audio call transcripts, and location heatmaps.</p>
            </div>
            <div className="nav-hero-arrow"><ArrowRight size={20} /></div>
          </div>
        </section>

        <section className="stats-grid">
          <StatCard label="Reports awaiting review" value={data.stats.pending_reports} icon={<ClipboardList size={20} />} tone="critical" />
          <StatCard label="Active emergencies" value={data.stats.active} icon={<AlertTriangle size={20} />} tone="critical" />
          <StatCard label="Critical incidents" value={data.stats.critical} icon={<Siren size={20} />} tone="critical" />
          <StatCard label="Rescue in progress" value={data.stats.rescue_in_progress} icon={<Crosshair size={20} />} />
          <StatCard label="People affected" value={data.stats.people} icon={<Users size={20} />} />
        </section>

        <section className="priority-strip">
          <div>
            <strong>Needs Immediate Attention</strong>
            <span>Review unconfirmed citizen evidence and assign official response teams.</span>
          </div>
          <div className="priority-count">{activeIncidents.length} active · {pendingReports.length} reports pending</div>
        </section>

        {pendingReports.length > 0 && (
          <section className="panel attention-panel">
            <div className="panel-header">
              <div>
                <h2>Incoming Community Reports</h2>
                <span>Review citizen reports and convert to official incidents.</span>
              </div>
              <Badge kind="urgency-critical">{pendingReports.length} pending</Badge>
            </div>
            <div className="pending-list">
              {pendingReports.slice(0, 8).map((r) => (
                <PendingReportCard key={r.id} report={r} onClick={(id) => navigate("report", id)} />
              ))}
            </div>
          </section>
        )}

        <section className="control-row">
          <div className="searchbox">
            <Search size={18} />
            <input placeholder="Search incident, location, keyword..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All Incidents</option>
            <option value="active">Emergency / Pending</option>
            <option value="rescue_in_progress">Rescue in Progress</option>
            <option value="resolved">Resolved / Rescued</option>
          </select>
        </section>

        <section className="dashboard-grid">
          <div className="panel map-panel" style={{ marginBottom: 0 }}>
            <div className="panel-header">
              <div>
                <h2>Live Situation Map</h2>
                <span>Pin colour indicates urgency level. Shaded area denotes danger zone.</span>
              </div>
            </div>
            <div className="map-wrap">
              <MapContainer center={[20, 78]} zoom={5} scrollWheelZoom>
                <FitMap points={mapPoints} />
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                {mappedIncidents.filter((i) => !isResolved(i)).map((i) => (
                  <Circle
                    key={`z-${i.id}`}
                    center={[Number(i.latitude), Number(i.longitude)]}
                    radius={zoneRadiusFor(i)}
                    pathOptions={{ color: colorFor(i), fillColor: colorFor(i), fillOpacity: 0.18, weight: 2, dashArray: i.status === "rescue_in_progress" ? "6 6" : undefined }}
                    eventHandlers={{ click: () => navigate("incident", i.id) }}
                  >
                    <Tooltip sticky>{urgencyLabel(i.urgency)} zone · ≈ {formatRadius(zoneRadiusFor(i))}</Tooltip>
                  </Circle>
                ))}

                {mappedIncidents.map((i) => (
                  <Marker
                    key={`i-${i.id}`}
                    position={[Number(i.latitude), Number(i.longitude)]}
                    icon={incidentIcon(i)}
                    zIndexOffset={markerOrder(i)}
                    eventHandlers={{ click: () => navigate("incident", i.id) }}
                  >
                    <Popup>
                      <strong>{i.title}</strong>
                      <br />
                      <span style={{ color: colorFor(i), fontWeight: 700 }}>{isResolved(i) ? "Resolved" : urgencyLabel(i.urgency)}</span> · {stateLabel(i.status)}
                      {!isResolved(i) && (<><br />Zone ≈ {formatRadius(zoneRadiusFor(i))}</>)}
                      <br />
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Click to open details</span>
                    </Popup>
                  </Marker>
                ))}

                {liveLocations.map((x) => (
                  <Marker key={`u-${x.user_id}`} position={[Number(x.latitude), Number(x.longitude)]} icon={liveIcon} zIndexOffset={-500}>
                    <Popup><strong>{x.full_name}</strong><br />Shared live location</Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <div className="map-legend">
              <span><i className="legend-swatch" style={{ background: URGENCY_COLORS.critical }} />Critical</span>
              <span><i className="legend-swatch" style={{ background: URGENCY_COLORS.high }} />High</span>
              <span><i className="legend-swatch" style={{ background: URGENCY_COLORS.medium }} />Moderate</span>
              <span><i className="legend-swatch" style={{ background: URGENCY_COLORS.low }} />Low</span>
              <span><i className="legend-swatch" style={{ background: RESOLVED_COLOR }} />Resolved</span>
              <span><i className="legend-swatch" style={{ background: LIVE_COLOR }} />Live User</span>
              <span>{mapPoints.length} active markers</span>
            </div>
          </div>

          <div className="panel incident-panel" style={{ marginBottom: 0 }}>
            <div className="panel-header">
              <div>
                <h2>Priority Emergencies</h2>
                <span>Sorted by urgency. Click to manage response.</span>
              </div>
            </div>
            <div className="incident-list">
              {data.incidents.length === 0 ? (
                <div className="empty">No official incidents found.</div>
              ) : (
                <>
                  {activeIncidents.map((i) => (
                    <IncidentCard key={i.id} incident={i} onClick={(id) => navigate("incident", id)} />
                  ))}
                  {resolvedIncidents.length > 0 && (
                    <>
                      <div className="list-divider">Resolved / Rescued ({resolvedIncidents.length})</div>
                      {resolvedIncidents.map((i) => (
                        <IncidentCard key={i.id} incident={i} onClick={(id) => navigate("incident", id)} />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>All Community Evidence Reports</h2>
              <span>Comprehensive log of incoming reports with evidence status.</span>
            </div>
          </div>
          <div className="reports-list">
            {data.reports.length === 0 ? (
              <div className="empty">No reports available.</div>
            ) : (
              data.reports.slice(0, 60).map((r) => <ReportRow key={r.id} report={r} onClick={(id) => navigate("report", id)} />)
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Shared Live User Locations</h2>
              <span>Real-time location sharing enabled by active community members.</span>
            </div>
          </div>
          <div className="location-list">
            {data.locations.length === 0 ? (
              <div className="empty">No live location feeds active.</div>
            ) : (
              data.locations.map((x) => (
                <div className="location-item" key={x.id}>
                  <MapPin size={18} style={{ color: "var(--brand-primary)" }} />
                  <div>
                    <strong>{x.full_name}</strong>
                    <span>{Number(x.latitude).toFixed(6)}, {Number(x.longitude).toFixed(6)}</span>
                  </div>
                  <Badge kind={x.is_live ? "live" : ""}>{x.is_live ? "LIVE" : "STOPPED"}</Badge>
                  <small>{new Date(x.updated_at).toLocaleString()}</small>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
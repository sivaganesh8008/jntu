import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, Clock, Crosshair, FileAudio, ImagePlus, MapPin, Mic, Navigation, Send, ShieldAlert, Square, StopCircle, X } from "lucide-react";
import { Marker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { api } from "../api";
import { Badge, ErrorBox, SuccessBox, Topbar } from "./Common";

const trackingUrl = (incidentId) => `/api/user/incidents/${incidentId}/tracking`;
const POLL_MS = 5000;
const LIST_POLL_MS = 10000;

const SHOW_DEMO = true;
const DEMO_REPORT_ID = "demo-1";
const DEMO_INCIDENT_ID = "demo";
const DEMO_SITE = { latitude: 19.076, longitude: 72.8777 };
const demoStart = Date.now();
const demoCreatedAt = new Date(Date.now() - 12 * 60000).toISOString();

const buildDemoReport = () => ({
  id: DEMO_REPORT_ID,
  is_demo: true,
  created_at: demoCreatedAt,
  message_text: "DEMO: Road accident near the market junction. Two people injured, one trapped in a car. Smoke from the engine. Please send ambulance and fire engine.",
  ai_status: "processed",
  status: "rescue_in_progress",
  incident_id: DEMO_INCIDENT_ID,
  channel: "app",
  latitude: DEMO_SITE.latitude + 0.0004,
  longitude: DEMO_SITE.longitude - 0.0003,
});

function buildDemoTracking() {
  const elapsed = (Date.now() - demoStart) / 1000;
  const lerp = (a, b, t) => a + (b - a) * t;
  const move = (from, secs) => {
    const t = Math.min(1, elapsed / secs);
    return {
      t,
      latitude: lerp(DEMO_SITE.latitude + from[0], DEMO_SITE.latitude + 0.0006, t),
      longitude: lerp(DEMO_SITE.longitude + from[1], DEMO_SITE.longitude + 0.0006, t),
    };
  };
  const amb = move([0.018, -0.016], 90);
  const fire = move([-0.015, 0.022], 150);
  const now = new Date().toISOString();

  const unitState = (m, secs) => ({
    status: m.t >= 1 ? "on_scene" : "en_route",
    eta_minutes: m.t >= 1 ? 0 : Math.max(1, Math.ceil(((1 - m.t) * secs) / 60 * 4)),
  });

  const avgT = (amb.t + fire.t) / 2;
  return {
    incident: {
      id: DEMO_INCIDENT_ID,
      title: "Road accident with trapped person (demo)",
      summary: "Two injured, one person trapped. Smoke reported from a vehicle engine.",
      urgency: "critical",
      status: avgT >= 1 ? "rescue_in_progress" : "rescue_in_progress",
      progress_percent: Math.round(25 + avgT * 55),
      people_affected: 3,
      location_text: "Market junction (demo location)",
      latitude: DEMO_SITE.latitude,
      longitude: DEMO_SITE.longitude,
      updated_at: now,
    },
    units: [
      { id: 1, name: "AMB-07", unit_type: "ambulance", ...unitState(amb, 90), latitude: amb.latitude, longitude: amb.longitude, updated_at: now },
      { id: 2, name: "FIRE-03", unit_type: "fire_engine", ...unitState(fire, 150), latitude: fire.latitude, longitude: fire.longitude, updated_at: now },
      { id: 3, name: "PCR-12", unit_type: "police", status: "on_scene", eta_minutes: 0, latitude: DEMO_SITE.latitude + 0.0008, longitude: DEMO_SITE.longitude + 0.0005, updated_at: now },
    ],
  };
}

const URGENCY_COLORS = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#10b981" };
const URGENCY_LABEL = { critical: "Critical", high: "High", medium: "Moderate", low: "Low" };

const UNIT_STATUS = {
  dispatched: { label: "Dispatched", color: "#eab308" },
  en_route: { label: "On the way", color: "#f97316" },
  on_scene: { label: "On scene", color: "#10b981" },
  returning: { label: "Returning", color: "#64748b" },
  available: { label: "Available", color: "#2563eb" },
};
const unitStatus = (s) => UNIT_STATUS[s] || { label: String(s || "Unknown").replaceAll("_", " "), color: "#64748b" };

function unitKind(type = "") {
  const t = String(type).toLowerCase();
  if (t.includes("ambul") || t.includes("medic")) return { emoji: "🚑", label: "Ambulance" };
  if (t.includes("fire")) return { emoji: "🚒", label: "Fire engine" };
  if (t.includes("police")) return { emoji: "🚓", label: "Police" };
  if (t.includes("heli") || t.includes("air")) return { emoji: "🚁", label: "Helicopter" };
  if (t.includes("boat") || t.includes("water")) return { emoji: "🚤", label: "Rescue boat" };
  if (t.includes("ndrf") || t.includes("sdrf") || t.includes("rescue")) return { emoji: "🛟", label: "Rescue team" };
  return { emoji: "🚨", label: type ? String(type).replaceAll("_", " ") : "Response unit" };
}

const iconCache = {};
function unitIcon(type, status) {
  const { emoji } = unitKind(type);
  const color = unitStatus(status).color;
  const key = `${emoji}-${color}`;
  if (iconCache[key]) return iconCache[key];
  iconCache[key] = L.divIcon({
    className: "unit-icon",
    html: `<div style="width:34px;height:34px;border-radius:50%;background:#fff;border:3px solid ${color};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 6px rgba(0,0,0,.35)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
  return iconCache[key];
}

function pinIcon(color) {
  const key = `pin-${color}`;
  if (iconCache[key]) return iconCache[key];
  iconCache[key] = L.divIcon({
    className: "unit-icon",
    html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M15 1C7.3 1 1 7.2 1 14.8c0 10.4 14 26.2 14 26.2s14-15.8 14-26.2C29 7.2 22.7 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -38],
  });
  return iconCache[key];
}

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const hasCoords = (o) => o && Number.isFinite(num(o.latitude)) && Number.isFinite(num(o.longitude));

function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(num(b.latitude) - num(a.latitude));
  const dLon = rad(num(b.longitude) - num(a.longitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(num(a.latitude))) * Math.cos(rad(num(b.latitude))) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function timeAgo(value) {
  if (!value) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

function getMediaUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const p = String(path).replace(/^\/+/, "");
  return p.startsWith("uploads/") ? `${window.location.origin}/${p}` : `${window.location.origin}/uploads/${p}`;
}

function FitMap({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  const key = points.length;
  useEffect(() => {
    if (!points.length) return;
    if (fitted.current === key) return;
    fitted.current = key;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }, [key, points, map]);
  return null;
}

function ReportDrawer({ report, onClose }) {
  const incidentId = report.incident_id;
  const [track, setTrack] = useState(null);
  const [trackError, setTrackError] = useState("");
  const [loadingTrack, setLoadingTrack] = useState(Boolean(incidentId));
  const [updatedAt, setUpdatedAt] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!incidentId) return undefined;
    let stopped = false;
    let timer = null;

    const fetchTracking = async () => {
      if (document.hidden) return;
      try {
        const result = incidentId === DEMO_INCIDENT_ID ? buildDemoTracking() : await api(trackingUrl(incidentId));
        if (stopped) return;
        setTrack(result);
        setTrackError("");
        setUpdatedAt(new Date());
        if (result?.incident?.status === "resolved" && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch (e) {
        if (!stopped) setTrackError(e.message);
      } finally {
        if (!stopped) setLoadingTrack(false);
      }
    };

    setLoadingTrack(true);
    fetchTracking();
    timer = setInterval(fetchTracking, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [incidentId]);

  const incident = track?.incident || null;
  const units = useMemo(() => (Array.isArray(track?.units) ? track.units : track?.rescue_units || []), [track]);
  const resolved = incident?.status === "resolved";

  const incidentPoint = hasCoords(incident) ? incident : hasCoords(report) ? report : null;
  const reportPoint = hasCoords(report) ? report : null;
  const mappedUnits = units.filter(hasCoords);

  const mapPoints = useMemo(() => {
    const pts = [];
    if (incidentPoint) pts.push([num(incidentPoint.latitude), num(incidentPoint.longitude)]);
    if (reportPoint) pts.push([num(reportPoint.latitude), num(reportPoint.longitude)]);
    mappedUnits.forEach((u) => pts.push([num(u.latitude), num(u.longitude)]));
    return pts;
  }, [incidentPoint?.latitude, incidentPoint?.longitude, reportPoint?.latitude, reportPoint?.longitude, mappedUnits.length]);

  const urgencyColor = URGENCY_COLORS[incident?.urgency] || URGENCY_COLORS.medium;
  const progress = incident?.progress_percent != null ? Number(incident.progress_percent) : resolved ? 100 : null;
  const photoUrl = getMediaUrl(report.photo_path);
  const audioUrl = getMediaUrl(report.audio_path);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Report details">
        <header className="drawer-head">
          <div>
            <span className="drawer-eyebrow">REPORT #{report.id}</span>
            <h2>Evidence & Rescue Details</h2>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="drawer-body">
          {report.is_demo && (
            <div style={{ background: "var(--brand-primary-light)", border: "1px solid var(--brand-primary-border)", color: "var(--brand-primary)", borderRadius: 12, padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>
              <strong>Demo mode:</strong> Simulated incident tracking with animated response units.
            </div>
          )}
          <section className="drawer-section">
            <div className="drawer-row">
              <Badge kind={report.ai_status}>{report.ai_status}</Badge>
              {report.status && <Badge kind={`status-${report.status}`}>{String(report.status).replaceAll("_", " ")}</Badge>}
              <span className="drawer-muted"><Clock size={14} /> {new Date(report.created_at).toLocaleString()}</span>
            </div>
            <p className="drawer-message">{report.message_text || "Media report"}</p>
            {photoUrl && (
              <a href={photoUrl} target="_blank" rel="noreferrer">
                <img className="drawer-photo" src={photoUrl} alt="Report evidence" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </a>
            )}
            {audioUrl && <audio controls preload="metadata" src={audioUrl} style={{ width: "100%", marginTop: 12 }} />}
            {reportPoint && (
              <p className="drawer-muted" style={{ marginTop: 12 }}>
                <MapPin size={14} /> {num(reportPoint.latitude).toFixed(6)}, {num(reportPoint.longitude).toFixed(6)}
              </p>
            )}
          </section>

          {!incidentId && (
            <section className="drawer-section drawer-note">
              <ShieldAlert size={20} />
              <div>
                <strong>Awaiting Responder Confirmation</strong>
                <p>Responders are reviewing your report evidence. Assigned emergency units and live tracking will display here once confirmed.</p>
              </div>
            </section>
          )}

          {incidentId && (
            <section className="drawer-section">
              <div className="drawer-title-row">
                <h3>Incident #{incidentId}</h3>
                {incident?.urgency && (
                  <span className="drawer-urgency" style={{ background: urgencyColor }}>{URGENCY_LABEL[incident.urgency] || incident.urgency}</span>
                )}
              </div>
              {incident ? (
                <>
                  <strong style={{ fontSize: "15px", color: "var(--text-main)" }}>{incident.title}</strong>
                  {incident.summary && <p className="drawer-muted" style={{ margin: "6px 0 0" }}>{incident.summary}</p>}
                  <div className="drawer-row" style={{ marginTop: 12 }}>
                    <Badge kind={`status-${incident.status}`}>
                      {incident.status === "resolved" ? "RESCUED / RESOLVED" : incident.status === "rescue_in_progress" ? "RESCUE IN PROGRESS" : "EMERGENCY / PENDING"}
                    </Badge>
                    {incident.people_affected != null && <span className="drawer-muted">{incident.people_affected} affected</span>}
                    {incident.location_text && <span className="drawer-muted"><MapPin size={14} /> {incident.location_text}</span>}
                  </div>
                  {progress != null && (
                    <>
                      <div className="drawer-progress"><div style={{ width: `${progress}%`, background: urgencyColor }} /></div>
                      <span className="drawer-muted" style={{ fontWeight: 700 }}>{progress}% progress</span>
                    </>
                  )}
                </>
              ) : (
                <p className="drawer-muted">{loadingTrack ? "Loading incident details..." : "Incident details unavailable."}</p>
              )}
            </section>
          )}

          {incidentId && (
            <section className="drawer-section">
              <div className="drawer-title-row">
                <h3><Navigation size={16} /> Live Response Units</h3>
                {!resolved ? (
                  <span className="live-pill"><i /> LIVE{updatedAt ? ` · ${updatedAt.toLocaleTimeString()}` : ""}</span>
                ) : (
                  <span className="drawer-muted">Incident resolved</span>
                )}
              </div>

              {trackError && <div className="drawer-error">Could not refresh unit locations: {trackError}</div>}

              {mapPoints.length > 0 ? (
                <div className="drawer-map">
                  <MapContainer center={mapPoints[0]} zoom={14} scrollWheelZoom style={{ height: 320, width: "100%" }}>
                    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <FitMap points={mapPoints} />

                    {incidentPoint && (
                      <Marker position={[num(incidentPoint.latitude), num(incidentPoint.longitude)]} icon={pinIcon(urgencyColor)}>
                        <Popup><strong>Incident location</strong>{incident?.title ? <><br />{incident.title}</> : null}</Popup>
                      </Marker>
                    )}
                    {reportPoint && incidentPoint && (num(reportPoint.latitude) !== num(incidentPoint.latitude) || num(reportPoint.longitude) !== num(incidentPoint.longitude)) && (
                      <Marker position={[num(reportPoint.latitude), num(reportPoint.longitude)]} icon={pinIcon("#2563eb")}>
                        <Popup>Your reported location</Popup>
                      </Marker>
                    )}

                    {mappedUnits.map((u) => {
                      const st = unitStatus(u.status);
                      const kind = unitKind(u.unit_type);
                      const pos = [num(u.latitude), num(u.longitude)];
                      return (
                        <React.Fragment key={u.id}>
                          {incidentPoint && ["dispatched", "en_route"].includes(u.status) && (
                            <Polyline positions={[pos, [num(incidentPoint.latitude), num(incidentPoint.longitude)]]} pathOptions={{ color: st.color, weight: 3, dashArray: "6 8", opacity: 0.8 }} />
                          )}
                          <Marker position={pos} icon={unitIcon(u.unit_type, u.status)} zIndexOffset={500}>
                            <Tooltip direction="top" offset={[0, -16]}>{kind.label}{u.name ? ` · ${u.name}` : ""}</Tooltip>
                            <Popup>
                              <strong>{kind.label}{u.name ? ` · ${u.name}` : ""}</strong>
                              <br />{st.label}
                              {u.eta_minutes != null && !["on_scene", "returning"].includes(u.status) && <><br />ETA ≈ {u.eta_minutes} min</>}
                              {u.updated_at && <><br /><small>Updated {timeAgo(u.updated_at)}</small></>}
                            </Popup>
                          </Marker>
                        </React.Fragment>
                      );
                    })}
                  </MapContainer>
                </div>
              ) : (
                <div className="drawer-empty">
                  <MapPin size={24} />
                  <p>{loadingTrack ? "Loading map..." : "No location data is available yet."}</p>
                </div>
              )}

              <div className="unit-list">
                {units.length === 0 ? (
                  <div className="drawer-empty">
                    <p>{loadingTrack ? "Loading units..." : resolved ? "No rescue units were assigned." : "Dispatched rescue units will appear here shortly."}</p>
                  </div>
                ) : (
                  units.map((u) => {
                    const st = unitStatus(u.status);
                    const kind = unitKind(u.unit_type);
                    const km = hasCoords(u) && incidentPoint ? distanceKm(u, incidentPoint) : null;
                    const stale = u.updated_at && Date.now() - new Date(u.updated_at).getTime() > 120000;
                    return (
                      <div className="unit-item" key={u.id}>
                        <div className="unit-emoji" style={{ borderColor: st.color }}>{kind.emoji}</div>
                        <div className="unit-main">
                          <strong>{kind.label}{u.name ? ` · ${u.name}` : ""}</strong>
                          <span>
                            <i className="unit-dot" style={{ background: st.color }} />{st.label}
                            {km != null && !["on_scene"].includes(u.status) ? ` · ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away` : ""}
                            {u.eta_minutes != null && !["on_scene", "returning"].includes(u.status) ? ` · ETA ${u.eta_minutes} min` : ""}
                          </span>
                          {!hasCoords(u) && <span className="drawer-muted">Location not shared</span>}
                          {stale && <span className="drawer-muted">Last location {timeAgo(u.updated_at)}</span>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <p className="drawer-muted" style={{ marginTop: 14 }}>Live positions update every {POLL_MS / 1000}s. In an emergency, dial local emergency services immediately.</p>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerStyles() {
  return (
    <style>{`
      .unit-icon { background: transparent; border: 0; }
      .drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 2000; display: flex; justify-content: flex-end; backdrop-filter: blur(4px); }
      .drawer { width: min(600px, 100%); height: 100%; background: var(--bg-app); color: var(--text-main); display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: drawer-in .2s ease-out; }
      @keyframes drawer-in { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
      .drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: var(--bg-surface); border-bottom: 1px solid var(--border-color); }
      .drawer-head h2 { margin: 2px 0 0; font-size: 18px; font-weight: 800; color: var(--text-main); }
      .drawer-eyebrow { font-size: 11px; letter-spacing: .08em; font-weight: 800; color: var(--brand-primary); }
      .drawer-close { border: 1px solid var(--border-color); background: var(--bg-surface); border-radius: var(--radius-md); width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted); }
      .drawer-body { padding: 20px 24px 32px; overflow-y: auto; display: grid; gap: 16px; align-content: start; }
      .drawer-section { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; }
      .drawer-section h3 { margin: 0; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px; color: var(--text-main); }
      .drawer-title-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
      .drawer-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
      .drawer-muted { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
      .drawer-message { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 12px 0 0; font-size: 14px; color: var(--text-main); }
      .drawer-photo { display: block; max-width: 100%; max-height: 300px; object-fit: contain; border-radius: var(--radius-md); margin-top: 12px; background: var(--bg-subtle); border: 1px solid var(--border-color); }
      .drawer-note { display: flex; gap: 12px; background: var(--color-medium-bg); border-color: var(--color-medium-border); color: var(--color-medium-text); }
      .drawer-note svg { flex-shrink: 0; margin-top: 2px; }
      .drawer-note p { margin: 4px 0 0; font-size: 13px; line-height: 1.5; }
      .drawer-urgency { color: #fff; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: var(--radius-full); letter-spacing: .03em; }
      .drawer-progress { height: 8px; background: var(--bg-subtle); border-radius: var(--radius-full); overflow: hidden; margin: 12px 0 6px; }
      .drawer-progress div { height: 100%; border-radius: var(--radius-full); transition: width .4s ease; }
      .drawer-map { border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-color); margin-top: 12px; }
      .drawer-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 16px; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border: 1px dashed var(--border-color); border-radius: var(--radius-md); }
      .drawer-empty p { margin: 0; font-size: 13px; font-weight: 600; }
      .drawer-error { background: var(--color-critical-bg); border: 1px solid var(--color-critical-border); color: var(--color-critical-text); border-radius: var(--radius-md); padding: 10px 14px; font-size: 12px; margin-bottom: 12px; font-weight: 600; }
      .live-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; color: var(--color-low-text); background: var(--color-low-bg); border: 1px solid var(--color-low-border); padding: 3px 10px; border-radius: var(--radius-full); }
      .live-pill i { width: 8px; height: 8px; border-radius: 50%; background: var(--color-low-text); animation: live-blink 1.2s ease-in-out infinite; }
      @keyframes live-blink { 50% { opacity: .25; } }
      .unit-list { display: grid; gap: 10px; margin-top: 14px; }
      .unit-item { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); }
      .unit-emoji { width: 42px; height: 42px; border-radius: 50%; border: 3px solid; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; background: var(--bg-surface); }
      .unit-main { display: grid; gap: 2px; min-width: 0; font-size: 13px; }
      .unit-main strong { color: var(--text-main); font-weight: 700; }
      .unit-main span { color: var(--text-muted); font-size: 12px; }
      .unit-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
      .row-chevron { display: flex; align-items: center; color: var(--text-muted); }
    `}</style>
  );
}

export default function UserDashboard({ user, onLogout }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [audio, setAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [coords, setCoords] = useState(null);
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [openReportId, setOpenReportId] = useState(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const watchId = useRef(null);

  const withDemo = (list) => (SHOW_DEMO ? [buildDemoReport(), ...list.filter((r) => r.id !== DEMO_REPORT_ID)] : list);

  const loadReports = async () => {
    try {
      const list = (await api("/api/user/reports")).reports || [];
      setReports(withDemo(list));
    } catch (e) {
      setError(e.message);
      if (SHOW_DEMO) setReports((prev) => withDemo(prev.filter((r) => !r.is_demo)));
    }
  };

  useEffect(() => {
    loadReports();
    const t = setInterval(() => { if (!document.hidden) loadReports(); }, LIST_POLL_MS);
    return () => {
      clearInterval(t);
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      api("/api/location/stop", { method: "POST" }).catch(() => {});
    };
  }, []);

  const startLocation = () => {
    if (!navigator.geolocation) { setError("This browser does not support geolocation."); return; }
    setError("");
    watchId.current = navigator.geolocation.watchPosition(
      async (p) => {
        const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy };
        setCoords(c);
        try {
          await api("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
        } catch (e) {
          setError(e.message);
        }
      },
      (e) => setError(`Location error: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    setSharing(true);
  };

  const stopLocation = async () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
    await api("/api/location/stop", { method: "POST" }).catch(() => {});
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        setAudio(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach((t) => t.stop());
      };
      r.start();
      recorder.current = r;
      setRecording(true);
    } catch {
      setError("Microphone permission is required.");
    }
  };

  const stopRecording = () => { recorder.current?.stop(); setRecording(false); };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setStatus("");
    const form = new FormData();
    form.append("message_text", text);
    if (photo) form.append("photo", photo);
    if (audio) form.append("audio", audio);
    if (coords) { form.append("latitude", coords.latitude); form.append("longitude", coords.longitude); }
    try {
      const result = await api("/api/reports", { method: "POST", body: form });
      setStatus(result.message + (result.incident_id ? ` Incident #${result.incident_id}.` : ""));
      setText(""); setPhoto(null); setAudio(null);
      await loadReports();
    } catch (err) {
      setError(err.message);
    }
  };

  const openReport = reports.find((r) => r.id === openReportId) || null;

  return (
    <div className="app-shell">
      <Topbar user={user} onLogout={onLogout} />
      <DrawerStyles />
      <main className="dashboard user-dashboard">
        <div className="page-heading">
          <div><span className="eyebrow">COMMUNITY REPORTING</span><h1>Report an Emergency</h1><p>Provide clear details and live evidence to assist emergency responders.</p></div>
          <div className={`location-pill ${sharing ? "on" : ""}`}><MapPin size={16} />{sharing ? "Live location active" : "Location off"}</div>
        </div>

        <section className="user-grid">
          <div className="panel report-composer">
            <div className="panel-header"><div><h2>Submit Evidence Report</h2><span>Combine text, photo, audio recording, and live coordinates.</span></div></div>
            <form onSubmit={submit} className="report-form">
              <textarea placeholder="Describe the incident... Mention key landmarks, casualties, hazards, or immediate resources required." value={text} onChange={(e) => setText(e.target.value)} />
              <div className="upload-row">
                <label className="upload-btn"><Camera size={18} />{photo ? "Photo Selected" : "Add Photo"}<input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></label>
                {!recording
                  ? <button type="button" className="upload-btn" onClick={startRecording}><Mic size={18} />{audio ? "Record Again" : "Record Voice"}</button>
                  : <button type="button" className="upload-btn recording" onClick={stopRecording}><Square size={16} />Stop Recording</button>}
                {photo && <span className="file-chip"><ImagePlus size={14} />{photo.name}<button type="button" onClick={() => setPhoto(null)}><X size={14} /></button></span>}
                {audio && <span className="file-chip"><FileAudio size={14} />{audio.name}<button type="button" onClick={() => setAudio(null)}><X size={14} /></button></span>}
              </div>

              <div className="location-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
                <div className="location-card-main" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <Crosshair size={22} style={{ color: "var(--brand-primary)" }} />
                  <div>
                    <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>{sharing ? "Sharing Live Coordinates" : "Attach GPS Location"}</strong>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", display: "block", marginTop: "2px" }}>
                      {coords ? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}` : "No GPS signal shared"}
                    </span>
                  </div>
                </div>
                {!sharing
                  ? <button type="button" className="secondary-btn" onClick={startLocation}>Start Sharing</button>
                  : <button type="button" className="danger-btn" onClick={stopLocation}><StopCircle size={16} />Stop</button>}
              </div>

              <ErrorBox>{error}</ErrorBox>
              <SuccessBox>{status}</SuccessBox>
              <button className="primary-btn send-btn" style={{ width: "100%", padding: "12px" }}><Send size={18} />Send Emergency Report</button>
            </form>
          </div>

          <div className="panel guidance">
            <div className="panel-header"><div><h2>Best Practices</h2><span>Structured details help AI extract precise priorities.</span></div></div>
            <ul>
              <li><CheckCircle2 size={18} />Specify landmarks, street names, or prominent buildings nearby.</li>
              <li><CheckCircle2 size={18} />State estimated number of affected or injured individuals.</li>
              <li><CheckCircle2 size={18} />Note any vulnerable persons (children, elderly, medical needs).</li>
              <li><CheckCircle2 size={18} />List immediate needs (Ambulance, Fire, Rescue Boat, Medical).</li>
              <li><CheckCircle2 size={18} />Indicate if information is second-hand or unverified.</li>
            </ul>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>My Submitted Reports</h2><span>Click any report to track real-time rescue status and dispatched units.</span></div></div>
          <div className="reports-list">
            {reports.length === 0 ? <div className="empty">No reports submitted yet.</div> : reports.map((r) => (
              <div
                className="user-report-row clickable"
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenReportId(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenReportId(r.id); } }}
              >
                <div><strong>{new Date(r.created_at).toLocaleString()}{r.is_demo && <em style={{ marginLeft: 8, fontSize: 11, fontStyle: "normal", background: "var(--brand-primary-light)", color: "var(--brand-primary)", padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>DEMO</em>}</strong><span>{r.message_text || "Media report"}</span></div>
                <Badge kind={r.ai_status}>{r.ai_status}</Badge>
                <div>{r.incident_id ? <span style={{ color: "var(--brand-primary)", fontWeight: 700 }}>{`Incident #${r.incident_id}`} · Track</span> : "Review pending"}</div>
                <div>{r.status ? <Badge kind={`status-${r.status}`}>{r.status.replaceAll("_", " ")}</Badge> : "—"}</div>
                <span className="row-chevron"><ChevronRight size={18} /></span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {openReport && <ReportDrawer report={openReport} onClose={() => setOpenReportId(null)} />}
    </div>
  );
}
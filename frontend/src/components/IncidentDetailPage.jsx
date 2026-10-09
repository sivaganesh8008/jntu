import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Crosshair,
  MapPin,
  Save,
  Users,
} from "lucide-react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { Badge, ErrorBox, Topbar } from "./Common";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function CenterMap({ point }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView(point, 15);
  }, [point, map]);
  return null;
}

const stateLabel = (status) => {
  if (status === "resolved") return "RESCUED / RESOLVED";
  if (status === "rescue_in_progress") return "RESCUE IN PROGRESS";
  return "EMERGENCY / PENDING";
};

const progressFor = (incident) => {
  if (incident?.progress_percent != null) return Number(incident.progress_percent);
  if (incident?.status === "resolved") return 100;
  if (incident?.status === "rescue_in_progress") return 65;
  return 20;
};

export default function IncidentDetailPage({
  user,
  onLogout,
  incidentId,
  onBack,
  onOpenReport,
}) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [urgency, setUrgency] = useState("medium");
  const [progress, setProgress] = useState(20);

  const load = async () => {
    try {
      setError("");
      const data = await api(`/api/admin/incidents/${incidentId}`);
      setDetail(data);
      setUrgency(data.incident.urgency || "medium");
      setProgress(progressFor(data.incident));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [incidentId]);

  const update = async (payload) => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const changeState = (status) => {
    let newProgress = 20;
    if (status === "rescue_in_progress") newProgress = 65;
    if (status === "resolved") newProgress = 100;

    setProgress(newProgress);
    update({
      status,
      progress_percent: newProgress,
      admin_note: note || undefined,
    });
    setNote("");
  };

  if (!detail) {
    return (
      <div className="app-shell">
        <Topbar user={user} onLogout={onLogout} />
        <main className="detail-page">
          <div className="loading-card" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-lg)", padding: "48px", textAlign: "center", color: "var(--text-muted)" }}>
            Loading incident #{incidentId}...
          </div>
        </main>
      </div>
    );
  }

  const incident = detail.incident;
  const point =
    incident.latitude != null && incident.longitude != null
      ? [Number(incident.latitude), Number(incident.longitude)]
      : null;

  let vulnerable = [];
  try {
    vulnerable = JSON.parse(incident.vulnerable_people || "[]");
  } catch {
    vulnerable = [];
  }

  return (
    <div className="app-shell">
      <Topbar user={user} onLogout={onLogout} />
      <main className="detail-page">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Command Center
        </button>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="detail-header">
          <div>
            <span className="eyebrow">OFFICIAL INCIDENT #{incident.id}</span>
            <h1>{incident.title}</h1>
            <p>{incident.summary || "No summary available."}</p>
          </div>
          <div className="detail-header-badges">
            <Badge kind={`urgency-${incident.urgency}`}>{incident.urgency}</Badge>
            <Badge kind={`status-${incident.status}`}>{stateLabel(incident.status)}</Badge>
          </div>
        </div>

        <section className="state-hero">
          <div>
            <span className="section-label" style={{ color: "#94a3b8" }}>CURRENT RESPONSE STATE</span>
            <strong>{stateLabel(incident.status)}</strong>
            <span>Responder-controlled response tracking</span>
          </div>
          <div className="hero-progress">
            <div className="big-progress">
              <div style={{ width: `${progress}%` }} />
            </div>
            <b>{progress}%</b>
          </div>
        </section>

        <div className="detail-layout">
          <div className="detail-main">
            <section className="detail-card">
              <div className="section-heading">
                <div>
                  <span className="section-label">RESPONDER ACTION</span>
                  <h2>Update Incident Status</h2>
                </div>
                <Save size={20} style={{ color: "var(--brand-primary)" }} />
              </div>

              <div className="state-actions large">
                <button
                  disabled={saving}
                  className={incident.status === "active" ? "selected" : ""}
                  onClick={() => changeState("active")}
                >
                  <AlertTriangle size={16} /> Emergency / Pending
                </button>

                <button
                  disabled={saving}
                  className={incident.status === "rescue_in_progress" ? "selected" : ""}
                  onClick={() => changeState("rescue_in_progress")}
                >
                  <Crosshair size={16} /> Rescue in Progress
                </button>

                <button
                  disabled={saving}
                  className={incident.status === "resolved" ? "selected" : ""}
                  onClick={() => changeState("resolved")}
                >
                  <CheckCircle2 size={16} /> Rescued / Resolved
                </button>
              </div>

              <div className="form-grid-two">
                <label>
                  Urgency Level
                  <select
                    value={urgency}
                    onChange={(e) => {
                      const value = e.target.value;
                      setUrgency(value);
                      update({ urgency: value });
                    }}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>

                <label>
                  Progress %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => setProgress(Number(e.target.value))}
                    onBlur={() => update({ progress_percent: progress })}
                  />
                </label>
              </div>

              <label style={{ marginTop: 14 }}>
                Responder Log / Note
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Enter responder updates, squad status, or field notes..."
                />
              </label>

              <button
                className="primary-btn"
                style={{ marginTop: 14 }}
                disabled={saving || !note.trim()}
                onClick={() => {
                  update({ admin_note: note.trim() });
                  setNote("");
                }}
              >
                Save Field Note
              </button>
            </section>

            <section className="detail-card">
              <div className="section-heading">
                <div>
                  <span className="section-label">INCIDENT FACTS</span>
                  <h2>Field Intelligence Summary</h2>
                </div>
              </div>

              <div className="facts-grid">
                <div>
                  <span>Incident Category</span>
                  <strong>{incident.incident_type || "Other"}</strong>
                </div>
                <div>
                  <span>People Affected</span>
                  <strong><Users size={16} /> {incident.people_affected ?? "Unknown"}</strong>
                </div>
                <div>
                  <span>Resource Needed</span>
                  <strong>{incident.resource_needed || "Not specified"}</strong>
                </div>
                <div>
                  <span>AI Extraction Confidence</span>
                  <strong>
                    {incident.confidence != null
                      ? `${Math.round(Number(incident.confidence) * 100)}%`
                      : "—"}
                  </strong>
                </div>
              </div>

              <div className="fact-wide">
                <span>Vulnerable Individuals Reported</span>
                <strong>{vulnerable.length ? vulnerable.join(", ") : "None specified"}</strong>
              </div>
            </section>

            <section className="detail-card">
              <div className="section-heading">
                <div>
                  <span className="section-label">AI SUPPORT</span>
                  <h2>Latest AI Synthesis</h2>
                </div>
                <BrainCircuit size={20} style={{ color: "var(--brand-primary)" }} />
              </div>

              <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "18px", fontSize: 13, lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-main)", display: "block", marginBottom: 6 }}>AI advisory notice: Responder maintains final operational authority.</strong>
                <p style={{ margin: "6px 0", color: "var(--text-muted)" }}>{incident.summary || "No AI summary available."}</p>
                <p style={{ margin: "6px 0", color: "var(--text-muted)" }}>{incident.last_ai_note || "No additional AI notes."}</p>
              </div>
            </section>

            <section className="detail-card">
              <div className="section-heading">
                <div>
                  <span className="section-label">RESPONSE HISTORY</span>
                  <h2>Audit Log & Progress Timeline</h2>
                </div>
              </div>

              <div className="timeline">
                {(detail.events || []).length > 0 ? (
                  detail.events.map((event) => (
                    <div className="timeline-item" key={event.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--border-color)" }}>
                      <div className="timeline-time" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {new Date(event.created_at).toLocaleString()}
                      </div>
                      <div>
                        <strong style={{ color: "var(--text-main)", fontSize: 13 }}>{event.actor_name || "System"}</strong>
                        <p style={{ margin: "4px 0", color: "var(--text-muted)", fontSize: 13 }}>{event.message}</p>
                        {event.progress_percent != null && (
                          <small style={{ color: "var(--brand-primary)", fontWeight: 700 }}>{event.progress_percent}% progress</small>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty">No response timeline updates recorded.</p>
                )}
              </div>
            </section>

            <section className="detail-card">
              <div className="section-heading">
                <div>
                  <span className="section-label">SOURCE REPORTS</span>
                  <h2>Linked Evidence Reports</h2>
                </div>
              </div>

              {(detail.reports || []).length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {detail.reports.map((report) => (
                    <button
                      key={report.id}
                      className="linked-item"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "14px 18px",
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        textAlign: "left"
                      }}
                      onClick={() => onOpenReport(report.id)}
                    >
                      <div>
                        <strong style={{ color: "var(--text-main)", fontSize: 13 }}>Report #{report.id} — {report.full_name}</strong>
                        <span style={{ display: "block", color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{report.message_text || "Media report"}</span>
                      </div>
                      <Clock3 size={16} style={{ color: "var(--brand-primary)" }} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty">No linked reports.</p>
              )}
            </section>
          </div>

          <aside className="detail-side" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
              {point ? (
                <>
                  <div style={{ width: "100%", height: 380, overflow: "hidden" }}>
                    <MapContainer center={point} zoom={15} scrollWheelZoom style={{ width: "100%", height: "100%" }}>
                      <CenterMap point={point} />
                      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <Marker position={point} icon={markerIcon}>
                        <Popup>
                          <strong>{incident.title}</strong>
                          <br />{incident.location_text || "Coordinates"}
                        </Popup>
                      </Marker>
                    </MapContainer>
                  </div>
                  <div style={{ padding: "18px 20px", borderTop: "1px solid var(--border-color)" }}>
                    <span className="section-label">INCIDENT LOCATION</span>
                    <strong style={{ display: "block", fontSize: 15, color: "var(--text-main)", marginTop: 4 }}>{incident.location_text || "Reported coordinates"}</strong>
                    <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      {Number(incident.latitude).toFixed(6)}, {Number(incident.longitude).toFixed(6)}
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="secondary-btn"
                      style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
                    >
                      Open in Google Maps
                    </a>
                  </div>
                </>
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  <MapPin size={32} style={{ margin: "0 auto 10px", display: "block" }} />
                  <strong>No location coordinates attached</strong>
                </div>
              )}
            </section>

            <section className="detail-card">
              <span className="section-label">QUICK SUMMARY</span>
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>Urgency</span>
                  <Badge kind={`urgency-${incident.urgency}`}>{incident.urgency}</Badge>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>Progress</span>
                  <strong style={{ color: "var(--text-main)", fontSize: 14 }}>{progress}%</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>Last Updated</span>
                  <strong style={{ color: "var(--text-main)", fontSize: 12 }}>{new Date(incident.updated_at).toLocaleString()}</strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
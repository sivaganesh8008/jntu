import React, { useEffect, useRef, useState } from "react";
import {
  Ambulance,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  Flame,
  MapPin,
  Plus,
  Radio,
  Send,
  Siren,
  TrafficCone,
  Users,
} from "lucide-react";
import { Topbar, navigateTo } from "./Common";

const BASE = { lat: 19.076, lng: 72.8777 };

const INITIAL_UNITS = [
  { id: "AMB-01", type: "ambulance", name: "AMB-01", lat: BASE.lat + 0.012, lng: BASE.lng - 0.01, status: "available" },
  { id: "AMB-02", type: "ambulance", name: "AMB-02", lat: BASE.lat - 0.02, lng: BASE.lng + 0.015, status: "available" },
  { id: "AMB-03", type: "ambulance", name: "AMB-03", lat: BASE.lat + 0.03, lng: BASE.lng + 0.02, status: "available" },
  { id: "FIRE-01", type: "fire", name: "FIRE-01", lat: BASE.lat - 0.015, lng: BASE.lng - 0.02, status: "available" },
  { id: "FIRE-02", type: "fire", name: "FIRE-02", lat: BASE.lat + 0.025, lng: BASE.lng - 0.018, status: "available" },
];

const TRAFFIC_DESK = { id: "TRF-CTRL", name: "Traffic Control Room" };

const INCIDENT_TEMPLATES = [
  {
    title: "Road accident with trapped person",
    type: "accident",
    urgency: "critical",
    injured: 3,
    trapped: true,
    fireHazard: true,
    location: "Market Junction, Link Road",
    road: "Link Road",
    description: "Two cars collided. One person trapped, smoke from an engine.",
  },
  {
    title: "Apartment fire, 4th floor",
    type: "fire",
    urgency: "high",
    injured: 1,
    trapped: false,
    fireHazard: true,
    location: "Sunrise Apartments, Station Road",
    road: "Station Road",
    description: "Flames visible from a kitchen window. Residents evacuating.",
  },
  {
    title: "Chest pain, elderly patient",
    type: "medical",
    urgency: "medium",
    injured: 1,
    trapped: false,
    fireHazard: false,
    location: "Green Park Colony, Lane 5",
    road: "Lane 5",
    description: "Elderly man with chest pain and difficulty breathing.",
  },
  {
    title: "Minor fall at market",
    type: "medical",
    urgency: "low",
    injured: 1,
    trapped: false,
    fireHazard: false,
    location: "Central Market, Gate 2",
    road: "Market Road",
    description: "Person slipped and has a sprained ankle. Conscious and talking.",
  },
];

const URGENCY_COLORS = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#10b981" };
const URGENCY_LABEL = { critical: "Critical", high: "High", medium: "Moderate", low: "Low" };
const isHighEmergency = (u) => u === "critical" || u === "high";

function planResponse(inc) {
  const reasons = [];
  let ambulances = 0;
  let fireEngines = 0;

  if (inc.injured > 0) {
    ambulances = Math.max(1, Math.ceil(inc.injured / 2));
    reasons.push(`${inc.injured} injured → ${ambulances} ambulance${ambulances > 1 ? "s" : ""}`);
  }
  if (inc.fireHazard || inc.trapped) {
    fireEngines = inc.type === "fire" && isHighEmergency(inc.urgency) ? 2 : 1;
    reasons.push(
      inc.trapped
        ? `Person trapped → ${fireEngines} fire/rescue engine for extrication`
        : `Fire or smoke → ${fireEngines} fire engine${fireEngines > 1 ? "s" : ""}`
    );
  }
  const traffic = isHighEmergency(inc.urgency);
  if (traffic) reasons.push(`${URGENCY_LABEL[inc.urgency]} emergency → alert traffic control to clear a corridor`);
  else reasons.push("Not a high emergency → no traffic alert needed");

  return { ambulances, fireEngines, traffic, reasons };
}

function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const etaMinutes = (km) => Math.max(2, Math.round((km / 30) * 60));

const nowLabel = () => new Date().toLocaleTimeString();

function buildMessage(service, inc, eta, extra = {}) {
  const head = `INCIDENT #${inc.id} · ${URGENCY_LABEL[inc.urgency].toUpperCase()}`;
  if (service === "ambulance") {
    return `${head}. ${inc.title}. ${inc.injured} injured${inc.trapped ? ", one trapped" : ""}. Location: ${inc.location}. Respond code ${inc.urgency === "critical" ? "RED" : "AMBER"}. Target ETA ${eta} min.`;
  }
  if (service === "fire") {
    return `${head}. ${inc.title}. ${inc.trapped ? "Person trapped: bring cutting/extrication tools. " : ""}${inc.fireHazard ? "Fire/smoke reported. " : ""}Location: ${inc.location}. Target ETA ${eta} min.`;
  }
  return `${head} HIGH-EMERGENCY TRAFFIC ALERT. Clear a corridor on ${inc.road} toward ${inc.location} for ${extra.vehicles || 1} emergency vehicle(s). Divert traffic within 300 m of the scene and hold signals green on the approach route.`;
}

const SERVICE_META = {
  ambulance: { label: "Ambulance", Icon: Ambulance, color: "#ef4444" },
  fire: { label: "Fire engine", Icon: Flame, color: "#f97316" },
  traffic: { label: "Traffic control", Icon: TrafficCone, color: "#2563eb" },
};

const STATUS_LABEL = {
  notified: "Notified",
  acknowledged: "Acknowledged",
  en_route: "En route",
  active: "Diversion active",
  unavailable: "No unit available",
};

export default function RescueDispatchConsole({ user, onLogout }) {
  const [incidents, setIncidentsState] = useState([]);
  const [units, setUnitsState] = useState(INITIAL_UNITS);
  const [log, setLogState] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [autoDispatch, setAutoDispatch] = useState(true);

  const incRef = useRef([]);
  const unitsRef = useRef(INITIAL_UNITS);
  const logRef = useRef([]);
  const autoRef = useRef(true);
  const timers = useRef([]);
  const counters = useRef({ incident: 100, dispatch: 0, log: 0, template: 0 });
  const started = useRef(false);

  const setIncidents = (fn) => { incRef.current = fn(incRef.current); setIncidentsState(incRef.current); };
  const setUnits = (fn) => { unitsRef.current = fn(unitsRef.current); setUnitsState(unitsRef.current); };
  const setLog = (fn) => { logRef.current = fn(logRef.current); setLogState(logRef.current); };

  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  useEffect(() => { autoRef.current = autoDispatch; }, [autoDispatch]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const addLog = (entry) =>
    setLog((l) => [{ id: ++counters.current.log, time: nowLabel(), ...entry }, ...l].slice(0, 60));

  const patchDispatch = (incidentId, dispatchId, patch) =>
    setIncidents((list) =>
      list.map((i) =>
        i.id === incidentId
          ? { ...i, dispatches: i.dispatches.map((d) => (d.id === dispatchId ? { ...d, ...patch } : d)) }
          : i
      )
    );

  const dispatchService = (incidentId, service, count = 1) => {
    const inc = incRef.current.find((i) => i.id === incidentId);
    if (!inc) return;
    const site = { lat: inc.lat, lng: inc.lng };
    const newDispatches = [];

    if (service === "traffic") {
      const vehicles = inc.dispatches.filter((d) => d.service !== "traffic" && d.unitId).length || 1;
      const id = ++counters.current.dispatch;
      const message = buildMessage("traffic", inc, 0, { vehicles });
      newDispatches.push({ id, service, unitId: TRAFFIC_DESK.id, unitName: TRAFFIC_DESK.name, status: "notified", eta: null, message });
      addLog({ incidentId, service, to: TRAFFIC_DESK.name, channel: "Radio + Dashboard alert", message, tone: "alert" });

      later(() => {
        patchDispatch(incidentId, id, { status: "acknowledged" });
        addLog({ incidentId, service, to: TRAFFIC_DESK.name, channel: "Reply", message: "Alert received. Preparing diversion and green corridor.", tone: "ok" });
      }, 1500 + Math.random() * 1500);
      later(() => {
        patchDispatch(incidentId, id, { status: "active" });
        addLog({ incidentId, service, to: TRAFFIC_DESK.name, channel: "Reply", message: `Diversion active on ${inc.road}. Signals set to green toward scene.`, tone: "ok" });
      }, 4200 + Math.random() * 1500);
    } else {
      const candidates = unitsRef.current
        .filter((u) => u.type === service && u.status === "available")
        .map((u) => ({ u, km: distanceKm(u, site) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, count);

      for (let n = 0; n < count; n++) {
        const id = ++counters.current.dispatch;
        const pick = candidates[n];

        if (!pick) {
          const message = `No ${SERVICE_META[service].label.toLowerCase()} available. Request mutual aid from neighbouring station.`;
          newDispatches.push({ id, service, unitId: null, unitName: "—", status: "unavailable", eta: null, message });
          addLog({ incidentId, service, to: "Dispatcher", channel: "System", message, tone: "warn" });
          continue;
        }

        const eta = etaMinutes(pick.km);
        const message = buildMessage(service, inc, eta);
        newDispatches.push({ id, service, unitId: pick.u.id, unitName: pick.u.name, status: "notified", eta, distanceKm: pick.km, message });
        setUnits((list) => list.map((u) => (u.id === pick.u.id ? { ...u, status: "assigned" } : u)));
        addLog({ incidentId, service, to: pick.u.name, channel: "App push + Radio", message, tone: "alert" });

        later(() => {
          patchDispatch(incidentId, id, { status: "acknowledged" });
          addLog({ incidentId, service, to: pick.u.name, channel: "Reply", message: "Acknowledged. Crew is leaving the station.", tone: "ok" });
        }, 2000 + Math.random() * 3000);
        later(() => {
          patchDispatch(incidentId, id, { status: "en_route" });
          addLog({ incidentId, service, to: pick.u.name, channel: "Status", message: `En route. ETA ${eta} min.`, tone: "ok" });
        }, 5200 + Math.random() * 2000);
      }
    }

    setIncidents((list) =>
      list.map((i) =>
        i.id === incidentId ? { ...i, status: "dispatched", dispatches: [...i.dispatches, ...newDispatches] } : i
      )
    );
  };

  const runPlan = (incidentId) => {
    const inc = incRef.current.find((i) => i.id === incidentId);
    if (!inc) return;
    addLog({ incidentId, service: "system", to: "Dispatch", channel: "System", message: `Dispatching for incident #${incidentId}: ${inc.plan.reasons.join(" · ")}`, tone: "info" });
    if (inc.plan.ambulances) dispatchService(incidentId, "ambulance", inc.plan.ambulances);
    if (inc.plan.fireEngines) dispatchService(incidentId, "fire", inc.plan.fireEngines);
    if (inc.plan.traffic) dispatchService(incidentId, "traffic");
  };

  const createIncident = (template) => {
    const id = ++counters.current.incident;
    const jitter = () => (Math.random() - 0.5) * 0.01;
    const inc = {
      ...template,
      id,
      lat: BASE.lat + jitter(),
      lng: BASE.lng + jitter(),
      createdAt: new Date(),
      status: "awaiting",
      dispatches: [],
    };
    inc.plan = planResponse(inc);

    setIncidents((list) => [inc, ...list]);
    setSelectedId(id);
    addLog({ incidentId: id, service: "system", to: "Dispatch", channel: "System", message: `Incident #${id} created: ${inc.title} (${URGENCY_LABEL[inc.urgency]}).`, tone: "info" });

    if (autoRef.current) later(() => runPlan(id), 600);
    return id;
  };

  const simulateNext = () => {
    const t = INCIDENT_TEMPLATES[counters.current.template % INCIDENT_TEMPLATES.length];
    counters.current.template += 1;
    createIncident(t);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    simulateNext();
  }, []);

  const resolveIncident = (incidentId) => {
    const inc = incRef.current.find((i) => i.id === incidentId);
    if (!inc) return;
    const freed = inc.dispatches.map((d) => d.unitId).filter(Boolean);
    setUnits((list) => list.map((u) => (freed.includes(u.id) ? { ...u, status: "available" } : u)));
    setIncidents((list) => list.map((i) => (i.id === incidentId ? { ...i, status: "resolved" } : i)));
    addLog({ incidentId, service: "system", to: "Dispatch", channel: "System", message: `Incident #${incidentId} resolved. Units released.`, tone: "info" });
    if (inc.plan.traffic) addLog({ incidentId, service: "traffic", to: TRAFFIC_DESK.name, channel: "System", message: "Stand down: restore normal traffic flow.", tone: "info" });
  };

  const selected = incidents.find((i) => i.id === selectedId) || null;
  const hasTraffic = selected?.dispatches.some((d) => d.service === "traffic");
  const available = (type) => units.filter((u) => u.type === type && u.status === "available").length;

  return (
    <div className="app-shell">
      {user && <Topbar user={user} onLogout={onLogout} />}
      <div className="rd-page">
        <style>{STYLES}</style>

        <header className="rd-top">
          <div>
            <button className="back-button" onClick={() => navigateTo("/admin")} style={{ marginBottom: 12 }}>
              <ArrowLeft size={16} /> Back to Command Center
            </button>
            <span className="rd-eyebrow">RESCUE TEAM</span>
            <h1>Dispatch Console</h1>
            <p>Automated rules assign nearest units and notify traffic control rooms in real time.</p>
          </div>
          <div className="rd-actions">
            <label className="rd-toggle">
              <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} />
              <span>Auto-dispatch</span>
            </label>
            <button className="rd-btn primary" onClick={simulateNext}><Plus size={16} /> Simulate new incident</button>
          </div>
        </header>

        <section className="rd-stats">
          <div className="rd-stat"><Ambulance size={20} /><div><strong>{available("ambulance")}/{units.filter((u) => u.type === "ambulance").length}</strong><span>Ambulances available</span></div></div>
          <div className="rd-stat"><Flame size={20} /><div><strong>{available("fire")}/{units.filter((u) => u.type === "fire").length}</strong><span>Fire engines available</span></div></div>
          <div className="rd-stat"><Siren size={20} /><div><strong>{incidents.filter((i) => i.status !== "resolved").length}</strong><span>Open incidents</span></div></div>
          <div className="rd-stat"><TrafficCone size={20} /><div><strong>{incidents.filter((i) => i.status !== "resolved" && i.dispatches.some((d) => d.service === "traffic")).length}</strong><span>Traffic alerts active</span></div></div>
        </section>

        <div className="rd-layout">
          <section className="rd-panel">
            <h2>Incidents Queue</h2>
            <div className="rd-list">
              {incidents.map((i) => (
                <button
                  key={i.id}
                  className={`rd-incident ${i.id === selectedId ? "sel" : ""} ${i.status === "resolved" ? "done" : ""}`}
                  style={{ borderLeftColor: i.status === "resolved" ? "var(--color-resolved)" : URGENCY_COLORS[i.urgency] }}
                  onClick={() => setSelectedId(i.id)}
                >
                  <div className="rd-incident-top">
                    <strong>#{i.id} {i.title}</strong>
                    <span className="rd-chip" style={{ background: URGENCY_COLORS[i.urgency] }}>{URGENCY_LABEL[i.urgency]}</span>
                  </div>
                  <span className="rd-muted"><MapPin size={12} /> {i.location}</span>
                  <span className="rd-muted">
                    {i.status === "awaiting" ? "Awaiting approval" : i.status === "resolved" ? "Resolved" : `${i.dispatches.length} notification${i.dispatches.length === 1 ? "" : "s"} sent`}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rd-panel rd-main">
            {!selected ? (
              <div className="rd-empty">Select an incident to view dispatch details.</div>
            ) : (
              <>
                <div className="rd-detail-head">
                  <div>
                    <h2>#{selected.id} {selected.title}</h2>
                    <p className="rd-muted"><MapPin size={14} /> {selected.location} · <Clock size={14} /> {selected.createdAt.toLocaleTimeString()}</p>
                  </div>
                  <span className="rd-chip big" style={{ background: URGENCY_COLORS[selected.urgency] }}>{URGENCY_LABEL[selected.urgency]}</span>
                </div>

                <p className="rd-desc">{selected.description}</p>
                <div className="rd-facts">
                  <span><Users size={14} /> {selected.injured} injured</span>
                  {selected.trapped && <span>Person trapped</span>}
                  {selected.fireHazard && <span>Fire / smoke</span>}
                </div>

                <div className="rd-plan">
                  <strong>Recommended Response Plan</strong>
                  <ul>{selected.plan.reasons.map((r) => <li key={r}><CheckCircle2 size={16} /> {r}</li>)}</ul>
                </div>

                {selected.status === "awaiting" && (
                  <button className="rd-btn primary wide" onClick={() => runPlan(selected.id)}>
                    <Send size={16} /> Approve and notify units
                  </button>
                )}

                {selected.dispatches.length > 0 && (
                  <div className="rd-dispatches">
                    <strong>Active Notifications</strong>
                    {selected.dispatches.map((d) => {
                      const meta = SERVICE_META[d.service];
                      return (
                        <div className="rd-dispatch" key={d.id}>
                          <div className="rd-dispatch-icon" style={{ background: meta.color }}><meta.Icon size={18} /></div>
                          <div className="rd-dispatch-main">
                            <div className="rd-dispatch-top">
                              <strong>{meta.label} · {d.unitName}</strong>
                              <span className={`rd-status ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                            </div>
                            <span className="rd-muted">
                              {d.eta != null && `ETA ${d.eta} min · ${d.distanceKm.toFixed(1)} km away`}
                              {d.service === "traffic" && "Corridor & signal control request"}
                            </span>
                            <p>{d.message}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selected.status !== "resolved" && selected.status !== "awaiting" && (
                  <div className="rd-manual">
                    <strong>Manual Actions</strong>
                    <div className="rd-manual-row">
                      <button className="rd-btn" onClick={() => dispatchService(selected.id, "ambulance")}><Ambulance size={16} /> Add Ambulance</button>
                      <button className="rd-btn" onClick={() => dispatchService(selected.id, "fire")}><Flame size={16} /> Add Fire Engine</button>
                      <button className="rd-btn" disabled={hasTraffic} onClick={() => dispatchService(selected.id, "traffic")}><TrafficCone size={16} /> {hasTraffic ? "Traffic Alerted" : "Alert Traffic"}</button>
                      <button className="rd-btn ok" onClick={() => resolveIncident(selected.id)}><CheckCircle2 size={16} /> Mark Resolved</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="rd-panel">
            <h2><Bell size={18} /> Real-Time Radio Feed</h2>
            <div className="rd-log">
              {log.length === 0 && <div className="rd-empty">No notifications logged yet.</div>}
              {log.map((l) => (
                <div className={`rd-log-item ${l.tone}`} key={l.id}>
                  <div className="rd-log-top">
                    <span><Radio size={13} /> {l.to}</span>
                    <small>{l.time}</small>
                  </div>
                  <p>{l.message}</p>
                  <small className="rd-muted">#{l.incidentId} · {l.channel}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const STYLES = `
  .rd-page { min-height: 100vh; background: var(--bg-app); color: var(--text-main); padding: 28px; font-family: var(--font-sans); }
  .rd-page * { box-sizing: border-box; }
  .rd-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; max-width: 1500px; margin: 0 auto 20px; }
  .rd-top h1 { margin: 4px 0 4px; font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-main); }
  .rd-top p { margin: 0; color: var(--text-muted); font-size: 14px; max-width: 640px; }
  .rd-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .12em; color: var(--color-critical-text); text-transform: uppercase; }
  .rd-actions { display: flex; gap: 12px; align-items: center; }
  .rd-toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 14px; cursor: pointer; color: var(--text-main); }
  .rd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-main); border-radius: var(--radius-md); padding: 10px 16px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
  .rd-btn:hover:not(:disabled) { background: var(--bg-surface-hover); border-color: var(--border-color-hover); transform: translateY(-1px); }
  .rd-btn:disabled { opacity: .55; cursor: not-allowed; }
  .rd-btn.primary { background: var(--color-critical); border-color: var(--color-critical); color: #fff; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.25); }
  .rd-btn.primary:hover { background: #dc2626; }
  .rd-btn.ok { background: var(--color-low-text); border-color: var(--color-low-text); color: #fff; }
  .rd-btn.ok:hover { background: #059669; }
  .rd-btn.wide { width: 100%; margin-top: 16px; padding: 12px; }
  .rd-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; max-width: 1500px; margin: 0 auto 20px; }
  .rd-stat { display: flex; align-items: center; gap: 14px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px 20px; box-shadow: var(--shadow-sm); }
  .rd-stat svg { color: var(--brand-primary); }
  .rd-stat strong { display: block; font-size: 22px; font-weight: 800; color: var(--text-main); }
  .rd-stat span { font-size: 12px; color: var(--text-muted); font-weight: 600; }
  .rd-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr) 360px; gap: 20px; max-width: 1500px; margin: 0 auto; align-items: start; }
  .rd-panel { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 20px; min-width: 0; box-shadow: var(--shadow-sm); }
  .rd-panel h2 { margin: 0 0 16px; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 8px; color: var(--text-main); }
  .rd-list { display: grid; gap: 12px; }
  .rd-incident { text-align: left; display: grid; gap: 6px; padding: 14px 16px; border: 1px solid var(--border-color); border-left: 5px solid; border-radius: var(--radius-md); background: var(--bg-surface); cursor: pointer; font: inherit; transition: all 0.2s ease; }
  .rd-incident:hover { background: var(--bg-surface-hover); }
  .rd-incident.sel { background: var(--brand-primary-light); border-color: var(--brand-primary-border); }
  .rd-incident.done { opacity: .6; }
  .rd-incident-top { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 700; color: var(--text-main); }
  .rd-chip { color: #fff; font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: var(--radius-full); height: fit-content; white-space: nowrap; text-transform: uppercase; }
  .rd-chip.big { font-size: 12px; padding: 4px 12px; }
  .rd-muted { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
  .rd-detail-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .rd-detail-head h2 { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: var(--text-main); }
  .rd-desc { font-size: 14px; line-height: 1.6; margin: 14px 0 12px; color: var(--text-muted); }
  .rd-facts { display: flex; flex-wrap: wrap; gap: 10px; }
  .rd-facts span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 5px 12px; color: var(--text-main); }
  .rd-plan { margin-top: 18px; background: var(--color-medium-bg); border: 1px solid var(--color-medium-border); color: var(--color-medium-text); border-radius: var(--radius-md); padding: 16px; font-size: 13px; }
  .rd-plan strong { display: block; font-size: 14px; margin-bottom: 6px; }
  .rd-plan ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
  .rd-plan li { display: flex; gap: 8px; align-items: flex-start; line-height: 1.5; font-weight: 600; }
  .rd-plan li svg { color: var(--color-low-text); margin-top: 2px; flex-shrink: 0; }
  .rd-dispatches { margin-top: 20px; display: grid; gap: 12px; }
  .rd-dispatch { display: flex; gap: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; background: var(--bg-surface); }
  .rd-dispatch-icon { width: 38px; height: 38px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .rd-dispatch-main { min-width: 0; display: grid; gap: 4px; font-size: 13px; flex: 1; }
  .rd-dispatch-top { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
  .rd-dispatch-top strong { font-weight: 700; color: var(--text-main); }
  .rd-dispatch-main p { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-muted); overflow-wrap: anywhere; }
  .rd-status { font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: var(--radius-full); background: var(--bg-subtle); color: var(--text-muted); text-transform: uppercase; }
  .rd-status.notified { background: var(--color-medium-bg); color: var(--color-medium-text); }
  .rd-status.acknowledged { background: var(--brand-primary-light); color: var(--brand-primary); }
  .rd-status.en_route, .rd-status.active { background: var(--color-low-bg); color: var(--color-low-text); }
  .rd-status.unavailable { background: var(--color-critical-bg); color: var(--color-critical-text); }
  .rd-manual { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color); font-size: 13px; }
  .rd-manual strong { color: var(--text-main); font-weight: 700; }
  .rd-manual-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .rd-log { display: grid; gap: 10px; max-height: 640px; overflow-y: auto; }
  .rd-log-item { border-left: 4px solid var(--border-color); background: var(--bg-subtle); border-radius: var(--radius-md); padding: 12px 14px; font-size: 12px; }
  .rd-log-item.alert { border-left-color: var(--color-critical); background: var(--color-critical-bg); color: var(--color-critical-text); }
  .rd-log-item.ok { border-left-color: var(--color-low-text); background: var(--color-low-bg); color: var(--color-low-text); }
  .rd-log-item.warn { border-left-color: var(--color-medium-text); background: var(--color-medium-bg); color: var(--color-medium-text); }
  .rd-log-item.info { border-left-color: var(--brand-primary); background: var(--brand-primary-light); color: var(--brand-primary); }
  .rd-log-top { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 4px; }
  .rd-log-top span { display: inline-flex; gap: 6px; align-items: center; }
  .rd-log-item p { margin: 4px 0; line-height: 1.5; overflow-wrap: anywhere; }
  .rd-empty { padding: 36px 16px; text-align: center; color: var(--text-muted); font-size: 13px; font-weight: 600; }
  @media (max-width: 1100px) { .rd-layout { grid-template-columns: 1fr; } .rd-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
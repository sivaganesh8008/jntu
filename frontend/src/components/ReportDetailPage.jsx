import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileAudio,
  FileImage,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
  AlertTriangle,
  ClipboardCheck,
} from "lucide-react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_KEY || "YOUR_GEMINI_API_KEY";
const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];

const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const MAX_EVIDENCE_SIZE = 18 * 1024 * 1024;

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function getToken() {
  return localStorage.getItem("token") || "";
}

async function apiRequest(url, options = {}) {
  const token = getToken();

  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let result = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text };
  }

  if (!response.ok) {
    throw new Error(result.detail || result.message || result.error || `Request failed (${response.status})`);
  }

  return result;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getMediaUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = String(path).replace(/^\/+/, "");
  if (normalizedPath.startsWith("uploads/")) return `${window.location.origin}/${normalizedPath}`;
  return `${window.location.origin}/uploads/${normalizedPath}`;
}

function normalizeReportResponse(result) {
  return result?.report || result?.data?.report || result?.data || result;
}

function parseGeminiJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Gemini returned a response that could not be parsed as JSON.");
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGeminiWithRetry(body) {
  const retryable = [429, 500, 503, 504];
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(geminiUrl(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body,
      });

      let result = {};
      try { result = await response.json(); } catch { }

      if (response.ok) return result;

      lastError = new Error(result?.error?.message || `Gemini request failed with HTTP ${response.status}.`);

      if (response.status === 404) break;
      if (!retryable.includes(response.status)) throw lastError;

      await sleep(2000 * 2 ** attempt + Math.random() * 500);
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

async function analyzeWithGemini(report) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === GEMINI_API_KEY_PLACEHOLDER) {
    throw new Error("Add your Gemini API key to GEMINI_API_KEY.");
  }

  const messageText = report.message_text || report.message || "";
  if (!messageText.trim()) throw new Error("This report has no message text to analyze.");

  const hasPhoto = Boolean(report.photo_path);
  const hasAudio = Boolean(report.audio_path);

  const reportContext = {
    report_id: report.id ?? report.report_id ?? null,
    message: messageText,
    latitude: report.latitude ?? null,
    longitude: report.longitude ?? null,
    reporter_name: report.reporter_name || null,
    reporter_phone: report.reporter_phone || null,
    created_at: report.created_at || null,
    status: report.status || null,
    photo_attached: hasPhoto,
    audio_attached: hasAudio,
  };

  const photoNote = hasPhoto
    ? "A photo was attached to this report. Assume the photo is genuine."
    : "No photo was attached to this report.";

  const audioNote = hasAudio
    ? "An audio recording is attached."
    : "No audio recording was attached.";

  const prompt = `
You are assisting a human operator reviewing a reported incident.
Analyze ONLY the report text and metadata below. Do not invent facts.
${photoNote}
${audioNote}

Report information:
${JSON.stringify(reportContext, null, 2)}

Return only valid JSON using this structure:
{
  "summary": "Concise summary of the submitted report",
  "incident_type": "Likely category, or unknown",
  "severity": "low, medium, high, critical, or undetermined",
  "urgency": "Immediate, urgent, routine, or undetermined",
  "confidence": "low, medium, or high",
  "evidence_findings": [
    {
      "source": "report text, or attached photo",
      "finding": "What the text states or implies",
      "confidence": "low, medium, or high"
    }
  ],
  "risk_indicators": ["Potential risk indicators"],
  "missing_information": ["Information requiring confirmation"],
  "recommended_actions": ["Reasonable next steps"],
  "location_assessment": "Explain whether coordinates were provided",
  "requires_human_review": true
}
  `.trim();

  const result = await callGeminiWithRetry(
    JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    })
  );

  const candidate = result?.candidates?.[0];
  const generatedText = candidate?.content?.parts?.map((part) => part.text || "").join("\n") || "";

  if (!generatedText) throw new Error("Gemini did not return analysis text.");

  return parseGeminiJson(generatedText);
}

function Field({ label, value }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-value">{value || "Not provided"}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children, action }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          {Icon && <Icon size={18} style={{ color: "var(--brand-primary)" }} />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EvidenceMap({ latitude, longitude }) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (latitude == null || longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return (
      <div className="empty-state">
        <MapPin size={24} />
        <p>No valid coordinates were provided for this report.</p>
      </div>
    );
  }

  return (
    <div className="map-wrapper">
      <MapContainer center={[lat, lng]} zoom={15} scrollWheelZoom style={{ height: 300, width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]}>
          <Popup>Reported location coordinates</Popup>
        </Marker>
      </MapContainer>

      <div className="coordinates">
        <MapPin size={15} />
        <span>{lat.toFixed(6)}, {lng.toFixed(6)}</span>
        <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
          Open map <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}

export default function ReportDetailPage({ reportId: reportIdProp }) {
  const reportId =
    reportIdProp ||
    new URLSearchParams(window.location.search).get("id") ||
    window.location.pathname.split("/").filter(Boolean).pop();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [incidentError, setIncidentError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingIncident, setCreatingIncident] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    incident_type: "Other",
    severity: "medium",
    location: "",
  });

  const loadReport = useCallback(async () => {
    if (!reportId) {
      setPageError("No report ID was provided.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError("");

    try {
      const result = await apiRequest(`/api/admin/reports/${encodeURIComponent(reportId)}`);
      const loadedReport = normalizeReportResponse(result);

      if (!loadedReport || typeof loadedReport !== "object") {
        throw new Error("The server returned an invalid report.");
      }

      setReport(loadedReport);
      setForm((previous) => ({
        ...previous,
        title: loadedReport.title || loadedReport.message_text?.slice(0, 100) || `Incident from report ${reportId}`,
        description: loadedReport.message_text || "",
        location: loadedReport.location || (loadedReport.latitude != null && loadedReport.longitude != null ? `${loadedReport.latitude}, ${loadedReport.longitude}` : ""),
      }));
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const autoRanFor = useRef(null);

  useEffect(() => {
    if (!report || loading) return;
    if (!(report.message_text || report.message)) return;
    if (autoRanFor.current === reportId) return;

    autoRanFor.current = reportId;
    analyzeEvidence();
  }, [report, loading, reportId]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function analyzeEvidence(force = false) {
    if (!report) return;
    setAnalyzing(true);
    setAnalysisError("");
    setSuccessMessage("");

    try {
      const cacheKey = `ai-analysis-${reportId}`;
      let result = null;

      if (!force) {
        try { result = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { }
      }

      if (!result) {
        result = await analyzeWithGemini(report);
        try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch { }
      }

      setAiResult(result);
      setForm((prev) => ({
        ...prev,
        title: prev.title || result.summary || `Incident from report ${reportId}`,
        description: prev.description || result.summary || report.message_text || "",
        incident_type: result.incident_type && !["unknown", "undetermined"].includes(String(result.incident_type).toLowerCase()) ? result.incident_type : prev.incident_type,
        severity: ["low", "medium", "high", "critical"].includes(String(result.severity).toLowerCase()) ? String(result.severity).toLowerCase() : prev.severity,
      }));
      setSuccessMessage("Gemini analysis completed successfully.");
    } catch (error) {
      setAnalysisError(getErrorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  }

  async function createIncident(event) {
    event.preventDefault();
    if (!report) return;

    setCreatingIncident(true);
    setIncidentError("");
    setSuccessMessage("");

    try {
      const payload = { ...form, report_id: reportId, ai_analysis: aiResult };
      const result = await apiRequest(`/api/admin/reports/${encodeURIComponent(reportId)}/create-incident`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setSuccessMessage(result.message || `Incident created successfully${result.incident_id ? ` (ID: ${result.incident_id})` : ""}.`);
    } catch (error) {
      setIncidentError(getErrorMessage(error));
    } finally {
      setCreatingIncident(false);
    }
  }

  async function copyAnalysis() {
    if (!aiResult) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(aiResult, null, 2));
      setSuccessMessage("Analysis JSON copied to clipboard.");
    } catch {
      setAnalysisError("Could not access clipboard.");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state">
          <LoaderCircle className="spin" size={28} />
          <p>Loading report evidence...</p>
        </div>
        <PageStyles />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="page">
        <header className="topbar" style={{ marginBottom: 20 }}>
          <button className="secondary-button" onClick={() => window.history.back()}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1>Report Review</h1>
        </header>

        <div className="alert error">
          <AlertTriangle size={18} />
          {pageError}
        </div>

        <button className="primary-button" onClick={loadReport}>
          <RefreshCw size={16} /> Retry
        </button>
        <PageStyles />
      </div>
    );
  }

  const photoUrl = report?.photo_path ? getMediaUrl(report.photo_path) : "";
  const audioUrl = report?.audio_path ? getMediaUrl(report.audio_path) : "";

  return (
    <div className="page">
      <header className="topbar">
        <button className="secondary-button" onClick={() => window.history.back()}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="topbar-title">
          <h1>Report Evidence Review</h1>
          <span>Report ID: #{reportId}</span>
        </div>
        <button className="secondary-button" onClick={loadReport} title="Reload report">
          <RefreshCw size={16} />
          <span className="button-label">Refresh</span>
        </button>
      </header>

      {successMessage && (
        <div className="alert success">
          <CheckCircle2 size={18} />
          {successMessage}
        </div>
      )}

      <div className="layout">
        <main className="main-column">
          <Section title="Submitted Report Details" icon={ClipboardCheck}>
            <div className="field-grid">
              <Field label="Report ID" value={`#${report.id ?? report.report_id ?? reportId}`} />
              <Field label="AI Status" value={report.status || report.ai_status} />
              <Field label="Submitted At" value={report.created_at ? new Date(report.created_at).toLocaleString() : null} />
              <Field label="Reporter" value={report.reporter_name || report.full_name || report.name} />
              <Field label="Contact" value={report.reporter_phone || report.phone || "Not provided"} />
            </div>

            <div className="message-box">
              <div className="field-label">Report Message Text</div>
              <p>{report.message_text || report.message || "No message was provided."}</p>
            </div>
          </Section>

          <Section title="Photo Evidence" icon={FileImage}>
            {photoUrl ? (
              <div className="evidence">
                <a href={photoUrl} target="_blank" rel="noreferrer">
                  <img className="evidence-image" src={photoUrl} alt="Report evidence" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </a>
                <a className="text-link" href={photoUrl} target="_blank" rel="noreferrer">
                  Open original photo <ExternalLink size={14} />
                </a>
              </div>
            ) : (
              <div className="empty-state">
                <FileImage size={24} />
                <p>No photo was attached to this report.</p>
              </div>
            )}
          </Section>

          <Section title="Audio Evidence" icon={FileAudio}>
            {audioUrl ? (
              <div className="evidence">
                <audio controls preload="metadata" src={audioUrl} className="audio-player">
                  Your browser does not support audio playback.
                </audio>
                <a className="text-link" href={audioUrl} target="_blank" rel="noreferrer">
                  Open recording <ExternalLink size={14} />
                </a>
              </div>
            ) : (
              <div className="empty-state">
                <FileAudio size={24} />
                <p>No audio was attached to this report.</p>
              </div>
            )}
          </Section>

          <Section title="Reported Location Coordinates" icon={Navigation}>
            <EvidenceMap latitude={report.latitude} longitude={report.longitude} />
          </Section>

          <Section
            title="Gemini AI Evidence Extraction"
            icon={BrainCircuit}
            action={
              aiResult && (
                <button className="secondary-button small" onClick={copyAnalysis}>
                  <Copy size={14} /> Copy JSON
                </button>
              )
            }
          >
            <button className="primary-button" onClick={() => analyzeEvidence(true)} disabled={analyzing}>
              {analyzing ? (
                <><LoaderCircle className="spin" size={17} /> Analyzing evidence...</>
              ) : (
                <><Sparkles size={17} /> {aiResult ? "Re-run Gemini analysis" : "Analyze with Gemini"}</>
              )}
            </button>

            {analysisError && (
              <div className="alert error" style={{ marginTop: 16 }}>
                <AlertTriangle size={18} />
                <div><strong>Analysis Error</strong><p>{analysisError}</p></div>
              </div>
            )}

            {aiResult && (
              <div className="analysis-results">
                <div className="analysis-summary">
                  <span className="field-label">AI Summary</span>
                  <p>{aiResult.summary || "No summary returned."}</p>
                </div>

                <div className="field-grid" style={{ marginTop: 18 }}>
                  <Field label="Incident Type" value={aiResult.incident_type} />
                  <Field label="Severity" value={aiResult.severity} />
                  <Field label="Urgency" value={aiResult.urgency} />
                  <Field label="Confidence" value={aiResult.confidence} />
                </div>

                {Array.isArray(aiResult.evidence_findings) && aiResult.evidence_findings.length > 0 && (
                  <div className="result-group">
                    <h3>Extracted Evidence Findings</h3>
                    <ul>
                      {aiResult.evidence_findings.map((item, index) => (
                        <li key={index}>
                          <strong>{item.source || "Evidence"}:</strong> {item.finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(aiResult.recommended_actions) && aiResult.recommended_actions.length > 0 && (
                  <div className="result-group">
                    <h3>Recommended Operator Actions</h3>
                    <ul>
                      {aiResult.recommended_actions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="alert warning">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>Responder Review Required</strong>
                    <p>AI findings are advisory. Verify report evidence before dispatching teams.</p>
                  </div>
                </div>

                <details className="raw-json">
                  <summary>View Complete Gemini JSON Response</summary>
                  <pre>{JSON.stringify(aiResult, null, 2)}</pre>
                </details>
              </div>
            )}
          </Section>
        </main>

        <aside className="side-column">
          <Section title="Create Official Incident" icon={ShieldAlert}>
            {incidentError && (
              <div className="alert error">
                <AlertTriangle size={17} />
                {incidentError}
              </div>
            )}

            <form onSubmit={createIncident} className="incident-form">
              <label htmlFor="incident-title">Incident Title</label>
              <input id="incident-title" name="title" value={form.title} onChange={updateForm} required maxLength={200} />

              <label htmlFor="incident-description">Description</label>
              <textarea id="incident-description" name="description" value={form.description} onChange={updateForm} rows={5} required />

              <label htmlFor="incident-type">Incident Category</label>
              <select id="incident-type" name="incident_type" value={form.incident_type} onChange={updateForm}>
                {["Other", "Medical", "Fire", "Accident", "Crime", "Safety", "Natural Disaster", "Infrastructure"].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              <label htmlFor="incident-severity">Severity Level</label>
              <select id="incident-severity" name="severity" value={form.severity} onChange={updateForm}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>

              <label htmlFor="incident-location">Location Text / Coordinates</label>
              <input id="incident-location" name="location" value={form.location} onChange={updateForm} placeholder="Address or lat, lng" />

              <button className="primary-button submit-button" type="submit" disabled={creatingIncident}>
                {creatingIncident ? <><LoaderCircle className="spin" size={17} /> Submitting...</> : <><Upload size={17} /> Create Incident</>}
              </button>
            </form>
          </Section>

          <Section title="Review Checklist" icon={CheckCircle2}>
            <ul className="checklist">
              <li><CheckCircle2 size={16} /> Verify report text & reporter details</li>
              <li><CheckCircle2 size={16} /> Inspect photo & audio evidence</li>
              <li><CheckCircle2 size={16} /> Check coordinates on map</li>
              <li><CheckCircle2 size={16} /> Confirm severity & urgency category</li>
            </ul>
          </Section>
        </aside>
      </div>

      <PageStyles />
    </div>
  );
}

function PageStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      .page {
        min-height: 100vh;
        background: var(--bg-app);
        color: var(--text-main);
        padding: 28px;
        font-family: var(--font-sans);
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 16px;
        max-width: 1440px;
        margin: 0 auto 24px;
      }
      .topbar-title { flex: 1; }
      .topbar h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; color: var(--text-main); letter-spacing: -0.02em; }
      .topbar-title span { font-size: 13px; color: var(--text-muted); }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.65fr) minmax(320px, .85fr);
        gap: 24px;
        max-width: 1440px;
        margin: auto;
        align-items: start;
      }
      .main-column, .side-column {
        display: grid;
        gap: 20px;
        min-width: 0;
      }
      .panel {
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        padding: 22px;
        min-width: 0;
        box-shadow: var(--shadow-sm);
      }
      .panel-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }
      .panel-heading h2 {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 18px;
        font-weight: 800;
        margin: 0;
        color: var(--text-main);
      }
      .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .field { min-width: 0; }
      .field-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      .field-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-main);
        overflow-wrap: anywhere;
        line-height: 1.5;
      }
      .message-box, .analysis-summary {
        background: var(--bg-subtle);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: 16px;
        margin-top: 20px;
      }
      .message-box p, .analysis-summary p {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        margin: 6px 0 0;
        line-height: 1.6;
        color: var(--text-main);
      }
      .evidence { display: grid; gap: 12px; }
      .evidence-image {
        display: block;
        max-width: 100%;
        max-height: 480px;
        object-fit: contain;
        border-radius: var(--radius-md);
        background: var(--bg-subtle);
        border: 1px solid var(--border-color);
      }
      .audio-player { width: 100%; }
      .text-link, .coordinates a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        width: fit-content;
        color: var(--brand-primary);
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
      }
      .text-link:hover, .coordinates a:hover { text-decoration: underline; }
      .map-wrapper { overflow: hidden; border-radius: var(--radius-md); border: 1px solid var(--border-color); }
      .coordinates {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        padding: 14px 16px;
        background: var(--bg-surface);
        border-top: 1px solid var(--border-color);
        font-size: 13px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }
      .coordinates a { margin-left: auto; font-family: var(--font-sans); }
      .primary-button, .secondary-button {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        border-radius: var(--radius-md);
        padding: 10px 16px;
        min-height: 42px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all var(--transition-fast);
      }
      .primary-button {
        color: #fff;
        background: var(--brand-primary);
        border: 1px solid var(--brand-primary);
        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
      }
      .primary-button:hover:not(:disabled) { background: var(--brand-primary-hover); transform: translateY(-1px); }
      .primary-button:disabled { opacity: .65; cursor: not-allowed; }
      .secondary-button {
        background: var(--bg-surface);
        color: var(--text-main);
        border: 1px solid var(--border-color);
        box-shadow: var(--shadow-sm);
      }
      .secondary-button:hover { background: var(--bg-surface-hover); border-color: var(--border-color-hover); }
      .secondary-button.small { min-height: 34px; padding: 6px 12px; }
      .incident-form { display: grid; gap: 12px; }
      .incident-form label {
        font-size: 13px;
        font-weight: 700;
        color: var(--text-main);
      }
      .incident-form input, .incident-form textarea, .incident-form select {
        width: 100%;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        color: var(--text-main);
        background: var(--bg-input);
        font: inherit;
        font-size: 14px;
        outline: none;
      }
      .incident-form input:focus, .incident-form textarea:focus, .incident-form select:focus {
        border-color: var(--border-focus);
        box-shadow: 0 0 0 4px var(--brand-primary-light);
      }
      .incident-form textarea { resize: vertical; }
      .submit-button { width: 100%; margin-top: 12px; }
      .muted { font-size: 13px; color: var(--text-muted); line-height: 1.55; }
      .empty-state, .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 32px 16px;
        text-align: center;
        color: var(--text-muted);
        background: var(--bg-subtle);
        border: 1px dashed var(--border-color);
        border-radius: var(--radius-md);
      }
      .empty-state p, .loading-state p { margin: 0; font-size: 13px; font-weight: 600; }
      .loading-state { min-height: 240px; }
      .alert {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        border: 1px solid;
        border-radius: var(--radius-md);
        padding: 14px 16px;
        margin-bottom: 20px;
        font-size: 13px;
        line-height: 1.5;
        font-weight: 600;
      }
      .alert p { margin: 4px 0 0; font-weight: 400; }
      .alert.error { color: var(--color-critical-text); background: var(--color-critical-bg); border-color: var(--color-critical-border); }
      .alert.success { color: var(--color-low-text); background: var(--color-low-bg); border-color: var(--color-low-border); }
      .alert.warning { color: var(--color-medium-text); background: var(--color-medium-bg); border-color: var(--color-medium-border); margin-top: 18px; }
      .analysis-results { margin-top: 20px; }
      .result-group { margin-top: 20px; }
      .result-group h3 { font-size: 14px; font-weight: 800; margin: 0 0 8px; color: var(--text-main); }
      .result-group ul { margin: 0; padding-left: 20px; }
      .result-group li { padding: 4px 0; font-size: 13px; line-height: 1.55; color: var(--text-muted); }
      .raw-json { margin-top: 20px; font-size: 13px; }
      .raw-json summary { cursor: pointer; font-weight: 700; color: var(--text-main); }
      .raw-json pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: var(--bg-code);
        color: var(--text-main);
        padding: 16px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        overflow-x: auto;
        font-size: 12px;
        margin-top: 8px;
        font-family: var(--font-mono);
      }
      .checklist { display: grid; gap: 12px; padding: 0; margin: 0; list-style: none; }
      .checklist li { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.45; color: var(--text-muted); font-weight: 600; }
      .checklist svg { color: var(--color-low-text); flex-shrink: 0; }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (max-width: 950px) { .layout { grid-template-columns: 1fr; } }
    `}</style>
  );
}
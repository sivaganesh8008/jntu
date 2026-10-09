import { useState, useMemo, useEffect, useRef } from "react";
import { ArrowLeft, BrainCircuit, CheckCircle2, FileAudio, MapPin, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { Topbar, navigateTo } from "./Common";
import { useLanguage, LANGUAGES } from "../LanguageContext";
import { api } from "../api";

const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || "YOUR_GEMINI_API_KEY";
const MODEL = "gemini-3.5-flash-lite";
const REGION = "Chennai, Tamil Nadu, India";
const MIME = { mp3: "audio/mp3", wav: "audio/wav", m4a: "audio/aac", aac: "audio/aac", ogg: "audio/ogg" };
const SYS = "You are an emergency-response data analyst. Answer ONLY from the DATA JSON below. Cite record ids and incident ids. If the data does not contain the answer, say so. Be concise and practical.\nDATA:\n";
const QUICK = ["Analyze everything and rank incidents by priority", "Which incident needs help first and why?", "What did the audio calls say?", "Which reports are noise or rumours?"];
const SC = { ACTIVE: "#ef4444", RESOLVED: "#10b981", IGNORED: "#64748b" };

const CSS = `
.ed {
  --bg: var(--bg-app);
  --card: var(--bg-surface);
  --tx: var(--text-main);
  --mu: var(--text-muted);
  --bd: var(--border-color);
  --ac: var(--brand-primary);
  --red: var(--color-critical);
  --grn: var(--color-low-text);
  background: var(--bg);
  color: var(--tx);
  font-family: var(--font-sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.ed * { box-sizing: border-box; }
.ed .main { flex: 1; min-width: 0; }
.ed .w { max-width: 1440px; margin: 0 auto; padding: 28px 32px 64px; }
.ed h1 { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.02em; color: var(--tx); }
.ed h2 { font-size: 17px; font-weight: 800; margin: 0 0 14px; color: var(--tx); }
.ed .mu { color: var(--mu); }
.ed .sm { font-size: 12px; }
.ed .top { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; }
.ed .tabs { display: flex; gap: 6px; background: var(--bg-subtle); padding: 4px; border-radius: var(--radius-md); flex-wrap: wrap; border: 1px solid var(--bd); }
.ed .tabs button { border: 0; background: none; padding: 8px 16px; border-radius: var(--radius-sm); font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; color: var(--mu); transition: all 0.2s ease; }
.ed .tabs button.on { background: var(--card); color: var(--tx); box-shadow: var(--shadow-sm); }
.ed .g { display: grid; gap: 16px; }
.ed .k { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.ed .c3 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.ed .card { background: var(--card); border: 1px solid var(--bd); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-sm); transition: background-color 0.25s ease, border-color 0.25s ease; }
.ed .sec { margin-top: 20px; }
.ed .kv { font-size: 28px; font-weight: 800; line-height: 1.1; color: var(--tx); letter-spacing: -0.02em; }
.ed .kl { font-size: 12px; color: var(--mu); font-weight: 600; margin-top: 4px; }
.ed .badge { display: inline-block; padding: 3px 10px; border-radius: var(--radius-full); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.ed .ACTIVE { background: var(--color-critical-bg); color: var(--color-critical-text); border: 1px solid var(--color-critical-border); }
.ed .RESOLVED { background: var(--color-low-bg); color: var(--color-low-text); border: 1px solid var(--color-low-border); }
.ed .IGNORED { background: var(--bg-subtle); color: var(--mu); border: 1px solid var(--bd); }
.ed .bar { height: 8px; border-radius: var(--radius-full); background: var(--bg-subtle); overflow: hidden; margin: 4px 0 10px; }
.ed .bar i { display: block; height: 100%; background: var(--ac); border-radius: var(--radius-full); }
.ed .row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; align-items: center; }
.ed table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ed th, .ed td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--bd); vertical-align: middle; }
.ed th { color: var(--mu); font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; background: var(--bg-subtle); }
.ed td { color: var(--tx); }
.ed .sc { overflow-x: auto; max-height: 440px; overflow-y: auto; border: 1px solid var(--bd); border-radius: var(--radius-md); }
.ed .ins li { margin: 8px 0; line-height: 1.6; color: var(--tx); }
.ed .up { border: 2px dashed var(--border-color-hover); border-radius: var(--radius-xl); padding: 48px 24px; text-align: center; background: var(--card); }
.ed .up input, .ed .btn input { display: none; }
.ed .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--ac); color: #fff; padding: 10px 18px; border-radius: var(--radius-md); cursor: pointer; font-weight: 700; font-size: 13px; margin: 4px; border: none; transition: all 0.2s ease; }
.ed .btn.o { background: var(--card); color: var(--tx); border: 1px solid var(--bd); box-shadow: var(--shadow-sm); }
.ed .btn.o:hover { background: var(--bg-surface-hover); border-color: var(--border-color-hover); }
.ed button:disabled { opacity: 0.5; cursor: default; }
.ed .chip { display: inline-block; background: var(--brand-primary-light); color: var(--brand-primary); border-radius: var(--radius-sm); padding: 4px 10px; margin: 3px; font-size: 12px; font-weight: 700; border: 1px solid var(--brand-primary-border); }
.ed .tl { display: flex; align-items: flex-end; gap: 8px; height: 140px; padding-top: 10px; }
.ed .tl > div { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.ed .st { display: flex; flex-direction: column-reverse; width: 100%; justify-content: flex-start; flex: 1; border-radius: var(--radius-sm); overflow: hidden; }
.ed .st i { display: block; width: 100%; }
.ed input[type=text], .ed select { font-family: inherit; font-size: 13px; padding: 10px 14px; border: 1px solid var(--bd); border-radius: var(--radius-md); background: var(--bg-input); color: var(--tx); outline: none; }
.ed input[type=text]:focus, .ed select:focus { border-color: var(--ac); box-shadow: 0 0 0 4px var(--brand-primary-light); }
.ed audio { height: 32px; max-width: 240px; }
.ed .side { width: 420px; flex: none; position: fixed; right: 0; top: 0; bottom: 0; z-index: 2000; background: var(--card); border-left: 1px solid var(--bd); display: flex; flex-direction: column; box-shadow: var(--shadow-xl); transition: transform 0.25s ease; }
.ed .side.off { display: none; }
.ed .side-hd { padding: 16px 20px; border-bottom: 1px solid var(--bd); display: flex; justify-content: space-between; align-items: center; background: var(--card); }
.ed .side-ms { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-app); }
.ed .side-in { display: flex; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--bd); background: var(--card); }
.ed .side-in input { flex: 1; }
.ed .msg { padding: 10px 14px; border-radius: var(--radius-md); white-space: pre-wrap; max-width: 90%; font-size: 13px; line-height: 1.5; box-shadow: var(--shadow-sm); }
.ed .msg.user { align-self: flex-end; background: var(--ac); color: #fff; }
.ed .msg.model { align-self: flex-start; background: var(--card); border: 1px solid var(--bd); color: var(--tx); }
.ed .fab { position: fixed; right: 24px; bottom: 24px; z-index: 1000; margin: 0; box-shadow: var(--shadow-xl); padding: 12px 20px; border-radius: var(--radius-full); }
.ed .map { height: 440px; border-radius: var(--radius-md); margin-top: 12px; z-index: 0; border: 1px solid var(--bd); }
.ed .er { color: var(--color-critical-text); font-size: 12px; margin-top: 6px; font-weight: 700; background: var(--color-critical-bg); border: 1px solid var(--color-critical-border); padding: 8px 12px; border-radius: var(--radius-sm); }
.ed .trn { margin-top: 10px; font-size: 12px; background: var(--bg-subtle); border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 14px; white-space: pre-wrap; color: var(--tx); line-height: 1.6; }
.ed .trn-box { background: var(--bg-subtle); border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 10px 14px; font-size: 12px; line-height: 1.5; color: var(--tx); max-width: 420px; white-space: pre-wrap; word-break: break-word; }
.ed .trn-card { background: var(--card); border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 14px 18px; margin-top: 12px; box-shadow: var(--shadow-sm); }
.ed .trn-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 700; font-size: 13px; color: var(--tx); }
.ed .trn-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; background: var(--brand-primary-light); color: var(--brand-primary); padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--brand-primary-border); }
.ed .trn-structured-container { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; width: 100%; }
.ed .trn-section { background: var(--bg-subtle); border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 10px 14px; font-size: 12px; text-align: left; }
.ed .trn-section.orig { border-left: 3px solid var(--brand-primary); }
.ed .trn-section.eng { border-left: 3px solid var(--color-low-text); }
.ed .trn-section.lang { border-left: 3px solid #8b5cf6; }
.ed .trn-tag { font-size: 11px; font-weight: 800; letter-spacing: 0.03em; color: var(--mu); margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.ed .trn-body { color: var(--tx); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
@media(max-width:900px){ .ed .side { width: min(420px, 100vw); } }
`;

function FormattedTranscript({ text }) {
  if (!text) return null;
  const sections = text.split(/(?=\[(?:ORIGINAL|ENGLISH|[A-Z\s]+ TRANSLATION)\])/gi).filter(Boolean);
  if (sections.length <= 1) {
    return <div className="trn-body">{text}</div>;
  }
  return (
    <div className="trn-structured-container">
      {sections.map((sec, idx) => {
        const match = sec.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
        if (!match) return <div key={idx} className="trn-body">{sec}</div>;
        const header = match[1].trim();
        const content = match[2].trim();
        const isOriginal = header.toLowerCase().includes("original");
        const isEnglish = header.toLowerCase().includes("english");
        const typeClass = isOriginal ? "orig" : isEnglish ? "eng" : "lang";

        return (
          <div key={idx} className={`trn-section ${typeClass}`}>
            <div className="trn-tag">
              {isOriginal ? "🎙️ Original Voice Audio" : isEnglish ? "🇬🇧 English Translation" : `🇮🇳 ${header}`}
            </div>
            <div className="trn-body">{content}</div>
          </div>
        );
      })}
    </div>
  );
}

const COL = ["#2563eb", "#d97706", "#16a34a", "#9333ea", "#0891b2", "#db2777"];
const DEF = { I001: "Velachery medical (insulin)", I002: "Tambaram transformer fire", I003: "Medavakkam flood rescue" };
const KW = [["I001", /velachery|mrts|insulin|diabetic/], ["I002", /tambaram|transformer|sanatorium|electrical|fire/], ["I003", /medavakkam|boat|school|water tank/]];
const RESRE = /resolved|extinguished|completed|no further|no additional|fully controlled/;
const RESMAP = { I001: "MEDICAL_INSULIN", I002: "FIRE_TENDER", I003: "NDRF_BOAT" };
const STOP = new Set("is the a an of to in at for and or any what when are there near no".split(" "));

const mode = (a) => { const m = {}; a.forEach((x) => (m[x] = (m[x] || 0) + 1)); return Object.entries(m).sort((x, y) => y[1] - x[1])[0]?.[0]; };
const cnt = (a) => { const m = {}; a.forEach((x) => (m[x] = (m[x] || 0) + 1)); return Object.entries(m).sort((x, y) => y[1] - x[1]); };

async function gem(parts, { system, json, history } = {}) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [...(history || []), { role: "user", parts }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "Gemini error " + r.status);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}
const b64 = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result.split(",")[1]); f.onerror = rej; f.readAsDataURL(blob); });

function classify(t, stories) {
  const s = t.toLowerCase();
  const strong = /incident|rescue|insulin|fire tender|evacuat|extinguish|boat|fire near|ticket|diabetic|transformer/.test(s);
  const nz = /\?|forwarded|rumou|traffic|school|holiday|metro|weather|office|no emergency|supermarket|rain|train/.test(s);
  const al = stories.flatMap((x) => [x.canonical_location, ...(x.location_variants || [])].map((v) => [x.incident_id, v.toLowerCase()])).find((a) => s.includes(a[1]));
  const inc = al ? al[0] : (KW.find((k) => k[1].test(s)) || [])[0];
  if (!inc || (!strong && nz) || /no emergency/.test(s)) return { noise: true, st: "IGNORED", inc: null, alias: false };
  const p = s.match(/(\d+)\s+(people|persons|residents)/);
  return { noise: false, inc, st: RESRE.test(s) ? "RESOLVED" : "ACTIVE", ppl: p ? +p[1] : null, res: RESMAP[inc], alias: !!al };
}

function csvRows(t) {
  const L = t.trim().split(/\r?\n/).filter(Boolean);
  const d = L[0].includes("\t") ? "\t" : L[0].includes(",") ? "," : null;
  const sp = (l) => (d ? l.split(d) : l.split(/\s+/));
  const h = sp(L[0]).map((x) => x.trim().toLowerCase().replace(/"/g, ""));
  const n = h.length;
  return L.slice(1).map((l) => {
    const p = sp(l);
    const f = [...p.slice(0, n - 1), p.slice(n - 1).join(d || " ")].map((x) => x.trim().replace(/^"|"$/g, ""));
    const o = {}; h.forEach((k, i) => (o[k] = f[i])); return o;
  });
}

function toItem(o) {
  const id = String(o.id || "");
  const st = (id.match(/stage_(\d)/) || String(o.hint || o.file).match(/(\d)/) || [])[1] || "?";
  const src = /_wa_/.test(id) ? "whatsapp" : /_tw_/.test(id) ? "twitter" : /_sms_/.test(id) ? "sms" : (o.file || "file").replace(/\.\w+$/, "");
  return { id, stage: st, src, ts: o.ts || "", sender: o.sender || "", text: String(o.text || ""), file: o.file };
}

function buildItems(D) {
  const seen = new Set(); const byId = {};
  D.gt.forEach((r) => (byId[r.record_id] = r));
  const it = D.raw.filter((x) => (x.id && !seen.has(x.id) && seen.add(x.id)) || !x.id).map((x) => ({ ...x }));
  it.forEach((x) => { x.t = byId[x.id]; x.r = x.text ? classify(x.text, D.stories) : null; });
  D.gt.forEach((r) => {
    if (!seen.has(r.record_id)) it.push({ id: r.record_id, stage: r.stage.replace("stage_", ""), src: r.source_type === "audio" ? "audio" : r.source, ts: "", sender: "", text: r.source_type === "audio" ? "(audio call, no transcript)" : "", t: r, r: null });
  });
  it.forEach((x) => {
    const { t, r } = x;
    x.e = t ? { inc: t.incident_id, st: t.status, ppl: t.people_count, noise: t.intent === "NOISE" } : r || { noise: true, st: "IGNORED" };
  });
  return it;
}

function Bars({ rows, max }) {
  const mx = max || Math.max(1, ...rows.map((r) => r[1]));
  if (!rows.length) return <div className="mu">—</div>;
  return rows.map((r, i) => (
    <div key={i}>
      <div className="row"><span>{r[0]}</span><b>{r[1]}</b></div>
      <div className="bar"><i style={{ width: `${(r[1] / mx) * 100}%`, ...(r[2] ? { background: r[2] } : {}) }} /></div>
    </div>
  ));
}

export default function EmergencyDashboard({ user, onLogout }) {
  const [D, setD] = useState({ raw: [], gt: [], stories: [], audio: [], files: [] });
  const [stage, setStage] = useState("All");
  const [q, setQ] = useState("");
  const [fs, setFs] = useState("");
  const [tr, setTr] = useState({});
  const [geo, setGeo] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState("");
  const [savedCases, setSavedCases] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [dbSuccessNote, setDbSuccessNote] = useState("");

  async function pushCaseToAdmin(caseData) {
    setSavingId(caseData.key);
    setErr("");
    try {
      const matchedGeo = geo.find((g) => g.incident_id === caseData.incidentId || (caseData.place && g.place && g.place.toLowerCase().includes(caseData.place.toLowerCase())));

      const lat = matchedGeo ? matchedGeo.lat : (caseData.lat || null);
      const lng = matchedGeo ? matchedGeo.lng : (caseData.lng || null);
      const locText = matchedGeo ? (matchedGeo.place || caseData.location) : (caseData.location || REGION);

      const payload = {
        title: caseData.title || `Audio Call Incident #${caseData.incidentId || "New"}`,
        incident_type: caseData.type || "other",
        summary: caseData.transcript || caseData.summary || "Emergency reported via voice transcript",
        location_text: locText,
        latitude: lat,
        longitude: lng,
        people_affected: caseData.people_affected != null ? Number(caseData.people_affected) : 1,
        urgency: caseData.urgency || "high",
        status: "active",
        admin_note: `Created from Stage Analyzer (${caseData.name || caseData.key}). Location: ${locText} (GPS: ${lat ? lat.toFixed(4) : 'Pending'}, ${lng ? lng.toFixed(4) : 'Pending'}).`,
      };

      const res = await api("/api/admin/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setSavedCases((prev) => ({ ...prev, [caseData.key]: res.incident_id }));
      setDbSuccessNote(`Incident #${res.incident_id} successfully saved to MySQL database & added to Admin Dashboard!`);
      setTimeout(() => setDbSuccessNote(""), 6000);
    } catch (e) {
      setErr("Failed to save to Admin Dashboard: " + e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function load(fileList) {
    const add = { raw: [], gt: [], stories: null, audio: [], files: [] };
    for (const f of fileList) {
      const n = f.webkitRelativePath || f.name, ext = f.name.split(".").pop().toLowerCase();
      if (["mp3", "wav", "m4a", "ogg", "aac"].includes(ext)) {
        const a = { name: f.name, size: f.size, url: URL.createObjectURL(f), stage: (f.name.match(/stage_?(\d)/i) || [])[1] || "?" };
        const au = new Audio(a.url);
        au.onloadedmetadata = () => setD((p) => ({ ...p, audio: p.audio.map((x) => (x.url === a.url ? { ...x, dur: au.duration } : x)) }));
        add.audio.push(a); add.files.push([n, "audio"]); continue;
      }
      if (!["json", "csv", "tsv", "txt"].includes(ext)) continue;
      try {
        const t = await f.text();
        if (ext === "json") {
          const j = JSON.parse(t);
          if (j.stories || j.stage_records) {
            if (j.stories) add.stories = j.stories;
            const recs = Object.values(j.stage_records || {}).flat();
            add.gt.push(...recs); add.files.push([n, `ground-truth labels (${recs.length})`]);
          } else {
            const arr = Array.isArray(j) ? j : Object.values(j).find((v) => Array.isArray(v) && typeof v[0] === "object");
            let c = 0;
            (arr || []).forEach((m) => {
              const tx = m.text ?? m.message ?? m.body ?? m.content; if (tx == null) return; c++;
              add.raw.push(toItem({ id: m.message_id || m.id || m.sms_id || m.tweet_id, ts: m.timestamp || m.time, sender: m.sender || m.user, text: tx, file: f.name, hint: j.stage }));
            });
            add.files.push([n, `messages (${c})`]);
          }
        } else {
          const r = csvRows(t);
          r.forEach((m) => add.raw.push(toItem({ id: m.sms_id || m.id || m.message_id || m.tweet_id, ts: m.timestamp || m.time, sender: m.sender || m.user, text: m.message || m.text || m.body, file: f.name })));
          add.files.push([n, `table (${r.length} rows)`]);
        }
      } catch (e) { add.files.push([n, "error: " + e.message]); }
    }
    setD((p) => ({ raw: [...p.raw, ...add.raw], gt: [...p.gt, ...add.gt], stories: add.stories || p.stories, audio: [...p.audio, ...add.audio], files: [...p.files, ...add.files] }));
  }

  const items = useMemo(() => buildItems(D), [D.raw, D.gt, D.stories]);
  const S = useMemo(() => [...new Set(items.map((i) => i.stage))].sort(), [items]);
  const ids = useMemo(() => [...new Set(items.map((i) => i.e.inc).filter(Boolean))].sort(), [items]);
  const nm = (id) => (D.stories.find((s) => s.incident_id === id) || {}).name || DEF[id] || id;
  const lastStatus = (id) => items.filter((i) => i.e.inc === id).sort((a, b) => (a.stage > b.stage ? 1 : -1)).pop()?.e.st || "ACTIVE";

  const trFor = (i, trs) => {
    const s = (i.t?.source || "").split("/").pop(), base = (k) => k.split("/").pop().replace(/\.\w+$/, "");
    const k = Object.keys(trs).find((k) => k.split("/").pop() === s || base(k) === i.id || (i.id && i.id.includes(base(k))));
    return k ? trs[k] : undefined;
  };
  const mkCtx = (trs, g) => JSON.stringify({
    incidents: D.stories,
    audio_transcripts: trs,
    estimated_locations: g,
    records: items.map((i) => { const t = trFor(i, trs); return { id: i.id, stage: i.stage, src: i.src, time: i.ts, sender: i.sender, text: t ? "(audio call) " + t.slice(0, 500) : i.text.slice(0, 240), incident: i.e.inc, people: i.e.ppl, status: i.e.st, noise: i.e.noise }; }),
  });

  useEffect(() => {
    if (window.L) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(l);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = () => setReady(true); document.body.appendChild(s);
  }, []);

  useEffect(() => {
    if (!ready || !loaded || map.current || !mapEl.current) return;
    map.current = window.L.map(mapEl.current).setView([13.0, 80.2], 11);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map.current);
    layer.current = window.L.layerGroup().addTo(map.current);
  }, [ready, loaded]);

  useEffect(() => {
    const L = window.L;
    if (!map.current || !geo.length) return;
    layer.current.clearLayers();
    const pts = [];
    geo.forEach((g) => {
      if (typeof g.lat !== "number" || typeof g.lng !== "number") return;
      const st = lastStatus(g.incident_id), c = SC[st] || SC.ACTIVE, p = [g.lat, g.lng];
      pts.push(p);
      L.circle(p, { radius: g.radius_m || 500, color: c, weight: 1, fillOpacity: 0.12 }).addTo(layer.current);
      const el = document.createElement("div"), b = document.createElement("b"), p1 = document.createElement("div"), p2 = document.createElement("small");
      b.textContent = nm(g.incident_id) + " · " + st; p1.textContent = g.place || "";
      p2.textContent = `confidence ${Math.round((g.confidence || 0) * 100)}% — ${g.reason || ""}`;
      el.append(b, p1, p2);
      L.circleMarker(p, { radius: 9, color: "#fff", weight: 2, fillColor: c, fillOpacity: 1 }).bindPopup(el).addTo(layer.current);
    });
    if (pts.length) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }, [geo, ready, items]);

  const { language } = useLanguage();
  const currentLangObj = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function transcribeOne(a) {
    if (tr[a.name] || busy) return;
    setBusy("Transcribing " + a.name + "…");
    setErr("");
    try {
      const blob = await (await fetch(a.url)).blob();
      const ext = a.name.split(".").pop().toLowerCase();
      const langPrompt = `Transcribe this emergency voice call accurately.
Format the output EXACTLY into structured headers:

[ORIGINAL SPOKEN TRANSCRIPT]
(word-for-word transcript in the original spoken language)

[ENGLISH TRANSLATION]
(accurate translation into English)

${currentLangObj.code !== "en" ? `[${currentLangObj.name.toUpperCase()} TRANSLATION]
(accurate translation into ${currentLangObj.name} / ${currentLangObj.native})` : ""}

Output only these structured sections.`;

      const res = await gem([
        { inlineData: { mimeType: MIME[ext] || blob.type, data: await b64(blob) } },
        { text: langPrompt },
      ]);
      setTr((prev) => ({ ...prev, [a.name]: res }));
    } catch (e) {
      setErr(a.name + ": " + e.message);
    } finally {
      setBusy("");
    }
  }

  async function transcribeAll() {
    const out = { ...tr };
    const langPrompt = `Transcribe this emergency voice call accurately.
Format the output EXACTLY into structured headers:

[ORIGINAL SPOKEN TRANSCRIPT]
(word-for-word transcript in the original spoken language)

[ENGLISH TRANSLATION]
(accurate translation into English)

${currentLangObj.code !== "en" ? `[${currentLangObj.name.toUpperCase()} TRANSLATION]
(accurate translation into ${currentLangObj.name} / ${currentLangObj.native})` : ""}

Output only these structured sections.`;

    for (const a of D.audio) {
      if (out[a.name]) continue;
      setBusy("Transcribing " + a.name + "…");
      try {
        const blob = await (await fetch(a.url)).blob();
        const ext = a.name.split(".").pop().toLowerCase();
        out[a.name] = await gem([
          { inlineData: { mimeType: MIME[ext] || blob.type, data: await b64(blob) } },
          { text: langPrompt },
        ]);
        setTr({ ...out });
      } catch (e) { setErr(a.name + ": " + e.message); }
    }
    setBusy("");
    return out;
  }

  async function locate(trs = tr) {
    setBusy("Estimating coordinates…");
    try {
      const places = ids.map((id) => {
        const s = D.stories.find((x) => x.incident_id === id) || {};
        return { incident_id: id, name: nm(id), canonical_location: s.canonical_location, spoken_variants: s.location_variants, sample_reports: items.filter((i) => i.e.inc === id && i.text).slice(0, 5).map((i) => i.text) };
      });
      const out = await gem([{ text: `Estimate the most likely latitude/longitude of each incident. Region hint: ${REGION}.\nPlaces: ${JSON.stringify(places)}\nAudio transcripts: ${JSON.stringify(trs)}\nReturn a JSON array of {"incident_id","lat","lng","place","radius_m","confidence","reason"} with confidence 0-1.` }], { json: true });
      setGeo(JSON.parse(out.replace(/```json|```/g, "").trim()));
    } catch (e) { setErr("Location: " + e.message); }
    setBusy("");
  }

  async function runAll() { setErr(""); const t = D.audio.length ? await transcribeAll() : tr; await locate(t); }

  async function send(text) {
    const m0 = (text ?? input).trim();
    if (!m0 || busy) return;
    setInput(""); setErr("");
    const history = msgs.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    setMsgs((m) => [...m, { role: "user", text: m0 }]);
    try {
      let t = tr;
      if (D.audio.some((a) => !tr[a.name])) t = await transcribeAll();
      setBusy("Thinking…");
      const a = await gem([{ text: m0 }], { history, system: SYS + mkCtx(t, geo) });
      setMsgs((m) => [...m, { role: "model", text: a }]);
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  function pstat(id, s) {
    const st = D.stories.find((x) => x.incident_id === id), sg = st && st["stage_" + s];
    const its = items.filter((i) => i.e.inc === id && i.stage === s);
    return {
      ppl: sg ? sg.people : +mode(its.map((i) => i.e.ppl).filter(Boolean)) || 0,
      st: sg ? sg.status : mode(its.map((i) => i.e.st)) || "—",
      txt: mode(its.filter((i) => i.r && i.r.inc === id).map((i) => i.r.st)),
    };
  }

  const I = items.filter((i) => stage === "All" || i.stage === stage);
  const em = I.filter((i) => !i.e.noise), nz = I.length - em.length;
  const last = stage === "All" ? S[S.length - 1] : stage;
  const ps = ids.map((i) => pstat(i, last));
  const act = ps.filter((p) => p.st === "ACTIVE").length;
  const ppl = ps.reduce((a, p) => a + p.ppl, 0);
  const open = ps.filter((p) => p.st === "ACTIVE").reduce((a, p) => a + p.ppl, 0);
  const audio = D.audio.filter((a) => stage === "All" || a.stage === stage).map((a) => ({ ...a, t: D.gt.find((r) => r.source === a.name) }));
  const dur = D.audio.reduce((a, x) => a + (x.dur || 0), 0);

  const w = I.filter((i) => i.t && i.r);
  const im = w.filter((i) => i.r.inc === (i.t.incident_id || null)).length;
  const sm = w.filter((i) => i.r.st === i.t.status).length;

  const T = I.filter((i) => Date.parse(i.ts));
  const t0 = Math.min(...T.map((i) => Date.parse(i.ts)));
  const B = {}; T.forEach((i) => { const b = Math.floor((Date.parse(i.ts) - t0) / 3e5); (B[b] = B[b] || []).push(i); });
  const nb = Math.max(-1, ...Object.keys(B).map(Number)) + 1;
  const mxb = Math.max(1, ...Object.values(B).map((a) => a.length));

  const dups = cnt(em.filter((i) => i.text && !/^\(/.test(i.text)).map((i) => i.text.replace(/\s+/g, " ").slice(0, 90)));
  const noiseWords = cnt(I.filter((i) => i.e.noise && i.text).flatMap((i) => i.text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((x) => !STOP.has(x))).slice(0, 6);
  const senders = cnt(I.map((i) => i.sender).filter(Boolean));
  const res = I.filter((i) => /^resident/.test(i.sender)).length, us = I.filter((i) => /^user/.test(i.sender)).length;

  const insights = [];
  ids.forEach((id) => {
    const a = S.map((s) => pstat(id, s).ppl);
    if (a.length > 1 && a[0] && a[a.length - 1] > a[0]) insights.push([nm(id), `people grew ${a.join(" → ")} (+${Math.round((a[a.length - 1] / a[0] - 1) * 100)}%); early reports undercount.`]);
  });
  const lp = S[S.length - 1];
  const top = ids.map((i) => ({ i, ...pstat(i, lp) })).filter((p) => p.st === "ACTIVE").sort((a, b) => b.ppl - a.ppl)[0];
  if (top) { const v = (D.stories.find((s) => s.incident_id === top.i) || {}).vulnerable; insights.push(["Priority", `${nm(top.i)} is still ACTIVE at stage ${lp} with ${top.ppl} people${v ? " (" + v.join(", ") + ")" : ""}.`]); }
  const uniq = new Set(em.filter((i) => i.text).map((i) => i.text)).size;
  if (em.length) insights.push(["Duplicates", `${em.length} emergency records collapse to ${ids.length} incidents (${uniq} distinct texts). Cluster by location + resource to avoid duplicate dispatch.`]);
  const vc = D.stories.reduce((a, s) => a + (s.location_variants || []).length, 0), al = I.filter((i) => i.r && i.r.alias).length;
  if (vc) insights.push(["Location aliases", `${vc} spoken variants map to ${D.stories.length} canonical spots; ${al} messages matched via alias.`]);
  insights.push(["Noise", `${Math.round((nz / (I.length || 1)) * 100)}% of records are rumours or off-topic and should not open tickets.`]);
  const conflict = I.filter((i) => i.t && i.r && i.r.st !== i.t.status).length;
  if (conflict) insights.push(["Data check", `${conflict} records have message text whose status (resolved/active) disagrees with the label. Verify before auto-closing tickets.`]);
  const pk = Object.entries(B).sort((a, b) => b[1].length - a[1].length)[0];
  if (pk) insights.push(["Peak", `busiest 5-min window had ${pk[1].length} reports, around ${new Date(Date.parse(pk[1][0].ts)).toISOString().slice(11, 16)}.`]);
  if (D.audio.length) insights.push(["Audio", `${D.audio.length} calls detected${Object.keys(tr).length ? `; ${Object.keys(tr).length} transcribed by Gemini` : "; use Transcribe audio to add them to the analysis"}.`]);

  const rows = I.filter((i) => (!fs || i.e.st === fs) && (!q || (i.id + i.text + i.sender + (i.e.inc || "")).toLowerCase().includes(q.toLowerCase()))).slice(0, 300);
  const onPick = (e) => load([...e.target.files]);

  return (
    <div className="ed">
      <style>{CSS}</style>
      {user && <Topbar user={user} onLogout={onLogout} />}
      <div className="main">
        <div className="w">
          <button className="back-button" onClick={() => navigateTo("/admin")} style={{ marginBottom: 16 }}>
            <ArrowLeft size={16} /> Back to Command Center
          </button>
          <div className="top">
            <div>
              <h1>Emergency Stage Analyzer</h1>
              <div className="mu">Upload datasets or JSON files. Browser-based analytics + Gemini AI intelligence.</div>
            </div>
            {loaded && <div className="tabs">{["All", ...S].map((s) => <button key={s} className={s === stage ? "on" : ""} onClick={() => setStage(s)}>{s === "All" ? "All stages" : "Stage " + s}</button>)}</div>}
          </div>

          {!loaded && (
            <div className="up">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: "var(--tx)" }}>Select Emergency Data Folder</div>
              <div className="mu" style={{ marginBottom: 16 }}>Upload JSON (messages/labels), CSV (SMS), or audio files (.mp3, .wav, .m4a).</div>
              <label className="btn">Choose folder<input type="file" webkitdirectory="" directory="" multiple onChange={onPick} /></label>
              <label className="btn o">Choose files<input type="file" multiple onChange={onPick} /></label>
            </div>
          )}

          {loaded && (<>
            <div className="sm">{D.files.map((f, i) => <span className="chip" key={i}>{f[0].split("/").pop()} · {f[1]}</span>)}</div>
            {dbSuccessNote && (
              <div className="success-box" style={{ marginTop: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={16} /> {dbSuccessNote}
              </div>
            )}

            <div className="g k sec">
              {[[I.length, "Records"], [em.length, "Emergency reports"], [Math.round((nz / (I.length || 1)) * 100) + "%", "Noise"], [ids.length, "Incidents"], [act, "Active"], [ids.length - act, "Resolved"], [ppl, "People affected"], [open, "Still need help"], [D.audio.length, "Audio calls" + (dur ? ` (${Math.round(dur)}s)` : "")]].map(([v, l], i) => (
                <div className="card" key={i}><div className="kv">{v}</div><div className="kl">{l}</div></div>
              ))}
            </div>

            <div className="sec"><h2>Active Incidents & Response State</h2>
              <div className="g c3">
                {ids.map((id, k) => {
                  const p = pstat(id, last), s = D.stories.find((x) => x.incident_id === id) || {};
                  const isSaved = savedCases[`incident-${id}`];
                  return (
                    <div className="card" key={id} style={{ borderTop: `4px solid ${COL[k % 6]}` }}>
                      <div className="row"><b>{nm(id)}</b><span className={`badge ${p.st}`}>{p.st}</span></div>
                      <div className="mu sm" style={{ marginTop: 4 }}>{s.canonical_location || ""}</div>
                      <div className="row sec"><span>People (stage {last})</span><b>{p.ppl}</b></div>
                      <div className="row"><span>Resource</span><b>{s.resource || RESMAP[id] || "—"}</b></div>
                      <div className="row"><span>Vulnerable</span><b>{(s.vulnerable || []).join(", ") || "—"}</b></div>
                      <div className="row"><span>Reports in view</span><b>{I.filter((i) => i.e.inc === id).length}</b></div>
                      <div className="row"><span>Location aliases</span><b>{(s.location_variants || []).length || "—"}</b></div>
                      <button
                        className="btn o"
                        style={{ width: "100%", marginTop: 12, fontSize: "12px" }}
                        disabled={savingId === `incident-${id}`}
                        onClick={() => {
                          const gMatch = geo.find((g) => g.incident_id === id);
                          pushCaseToAdmin({
                            key: `incident-${id}`,
                            incidentId: id,
                            title: nm(id),
                            summary: `${nm(id)} - ${s.canonical_location || REGION}. ${p.ppl} people affected. Resource: ${s.resource || 'Emergency team'}`,
                            location: s.canonical_location || gMatch?.place || REGION,
                            lat: gMatch?.lat,
                            lng: gMatch?.lng,
                            people_affected: p.ppl,
                            urgency: p.ppl > 10 ? "critical" : "high",
                            type: id === "I001" ? "medical" : id === "I002" ? "fire" : "flood"
                          });
                        }}
                      >
                        {isSaved ? `✓ In Database (#${isSaved})` : savingId === `incident-${id}` ? "Saving..." : "+ Push to Admin Dashboard"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card sec">
              <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>AI Spatial Analysis & Transcripts</h2>
                <div>
                  <button className="btn o" disabled={!!busy || !D.audio.length} onClick={() => { setErr(""); transcribeAll(); }}>Transcribe audio ({D.audio.length})</button>
                  <button className="btn o" disabled={!!busy || !ids.length} onClick={() => { setErr(""); locate(); }}>Locate incidents</button>
                  <button className="btn" disabled={!!busy} onClick={runAll}><Sparkles size={16} /> Run AI Analysis</button>
                </div>
              </div>
              {err && <div className="er">{err}</div>}
              {busy && <div className="mu sm" style={{ marginTop: 6 }}>{busy}</div>}
              <div ref={mapEl} className="map" />
              <div className="mu sm" style={{ marginTop: 8 }}>Estimated GPS coordinates extracted from emergency call audio and text logs.</div>
              {Object.entries(tr).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, margin: "16px 0 8px" }}>Call Transcripts & Translations ({Object.entries(tr).length})</h3>
                  {Object.entries(tr).map(([k, v]) => (
                    <div key={k} className="trn-card">
                      <div className="trn-header">
                        <span><FileAudio size={14} style={{ color: "var(--ac)" }} /> {k}</span>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            className="btn o"
                            style={{ padding: "4px 10px", fontSize: "11px", margin: 0 }}
                            disabled={savingId === k}
                            onClick={() =>
                              pushCaseToAdmin({
                                key: k,
                                name: k,
                                title: `Emergency Voice Call: ${k}`,
                                transcript: v,
                                location: REGION
                              })
                            }
                          >
                            {savedCases[k] ? `✓ Saved to DB (#${savedCases[k]})` : savingId === k ? "Saving..." : "+ Save Case to DB"}
                          </button>
                          <span className="trn-badge">Voice Transcript</span>
                        </div>
                      </div>
                      <FormattedTranscript text={v} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="g c3 sec">
              <div className="card"><h2>Source Channels</h2><Bars rows={cnt(I.map((i) => i.src))} /></div>
              <div className="card"><h2>Signal vs Noise Breakdown</h2>
                <Bars rows={[["Emergency", em.length, "var(--grn)"], ["Noise", nz, "var(--mu)"]]} max={I.length} />
                <div className="mu sm">Noise includes non-urgent queries and unverified rumours.</div></div>
              <div className="card"><h2>Validation Accuracy</h2>
                {w.length ? (<><Bars rows={[["Incident match", Math.round((im / w.length) * 100)], ["Status match", Math.round((sm / w.length) * 100)]]} max={100} />
                  <div className="mu sm">{w.length} labeled records evaluated.</div></>) : <div className="mu">Upload ground-truth file to validate.</div>}
              </div>
            </div>

            <div className="card sec"><h2>Report Volume Timeline (5-min intervals)</h2>
              {nb > 0 ? (<div className="tl">
                {Array.from({ length: nb }, (_, b) => {
                  const a = B[b] || [];
                  return (
                    <div key={b}>
                      <div className="sm mu">{a.length}</div>
                      <div className="st" style={{ height: `${(a.length / mxb) * 100}%` }}>
                        {[...ids, null].map((id, k) => { const c = a.filter((i) => (i.e.inc || null) === id).length; return c ? <i key={k} style={{ height: `${(c / a.length) * 100}%`, background: id ? COL[k % 6] : "var(--border-color-hover)" }} /> : null; })}
                      </div>
                      <div className="sm mu">{new Date(t0 + b * 3e5).toISOString().slice(11, 16)}</div>
                    </div>
                  );
                })}
              </div>) : <div className="mu">No timestamp data available.</div>}
              <div className="sm sec">{ids.map((id, k) => <span key={id} className="chip" style={{ background: COL[k % 6] + "22", borderColor: COL[k % 6] }}>{nm(id)}</span>)}<span className="chip" style={{ background: "var(--bg-subtle)" }}>noise</span></div>
            </div>

            <div className="card sec"><h2>Multi-Stage Incident Progression</h2>
              <div className="sc"><table>
                <thead><tr><th>Incident</th>{S.map((s) => <th key={s}>Stage {s}</th>)}</tr></thead>
                <tbody>{ids.map((id) => (
                  <tr key={id}><td><b>{nm(id)}</b></td>{S.map((s) => {
                    const p = pstat(id, s); return (
                      <td key={s}><b>{p.ppl}</b> people <span className={`badge ${p.st}`}>{p.st}</span>{p.txt && p.txt !== p.st && <div className="sm mu">text says {p.txt}</div>}</td>);
                  })}</tr>
                ))}</tbody></table></div>
            </div>

            <div className="g c3 sec">
              <div className="card"><h2>Most Repeated Reports</h2>
                {dups.slice(0, 6).map((d, i) => <div className="row" key={i}><span className="sm">{d[0]}</span><b>{d[1]}×</b></div>)}{!dups.length && <div className="mu">—</div>}</div>
              <div className="card"><h2>Common Noise Keywords</h2><Bars rows={noiseWords} /></div>
              <div className="card"><h2>Reporter Demographics</h2>
                {senders.length ? (<><Bars rows={[["Unique senders", senders.length], ["Residents", res], ["Anonymous users", us]]} />
                  <div className="mu sm">Residents produce ~{Math.round((res / (res + us || 1)) * 100)}% actionable signals.</div></>) : <div className="mu">No sender metadata.</div>}</div>
            </div>

            <div className="card sec"><h2>Key Automated Insights</h2>
              <ul className="ins">{insights.map((x, i) => <li key={i}><b>{x[0]}:</b> {x[1]}</li>)}</ul></div>

            {D.audio.length > 0 && (
              <div className="card sec">
                <div className="row" style={{ alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
                  <h2 style={{ margin: 0 }}>Emergency Audio Calls ({D.audio.length})</h2>
                  <button
                    className="btn o"
                    style={{ margin: 0 }}
                    disabled={!!busy || D.audio.every((a) => tr[a.name])}
                    onClick={() => { setErr(""); transcribeAll(); }}
                  >
                    <FileAudio size={14} /> Transcribe All Audio Calls
                  </button>
                </div>
                <div className="sc">
                  <table>
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Stage</th>
                        <th>Duration</th>
                        <th>Associated Incident</th>
                        <th>Individual Transcript</th>
                        <th>Actions & Playback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audio.map((a) => (
                        <tr key={a.url}>
                          <td><b>{a.name}</b></td>
                          <td>Stage {a.stage}</td>
                          <td>{a.dur ? Math.round(a.dur) + "s" : "…"}</td>
                          <td>{a.t ? `${nm(a.t.incident_id)} · ${a.t.people_count} ppl · ${a.t.status}` : "—"}</td>
                          <td style={{ maxWidth: 420 }}>
                            {tr[a.name] ? (
                              <FormattedTranscript text={tr[a.name]} />
                            ) : (
                              <span className="mu sm">No transcript available</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
                              <audio controls preload="none" src={a.url} style={{ height: 32, width: "100%" }} />
                              {tr[a.name] && (
                                <button
                                  className="btn"
                                  style={{ padding: "6px 12px", fontSize: "12px", margin: 0, width: "100%", background: "var(--brand-primary)", color: "#fff" }}
                                  disabled={savingId === a.name}
                                  onClick={() =>
                                    pushCaseToAdmin({
                                      key: a.name,
                                      name: a.name,
                                      incidentId: a.t?.incident_id,
                                      title: a.t ? `${nm(a.t.incident_id)} (Audio Call)` : `Voice Call: ${a.name}`,
                                      transcript: tr[a.name],
                                      people_affected: a.t?.people_count || 1,
                                      location: a.t ? nm(a.t.incident_id) : REGION,
                                      type: a.t?.incident_id === "I001" ? "medical" : a.t?.incident_id === "I002" ? "fire" : a.t?.incident_id === "I003" ? "flood" : "other",
                                      urgency: "high"
                                    })
                                  }
                                >
                                  {savedCases[a.name] ? `✓ Added (Incident #${savedCases[a.name]})` : savingId === a.name ? "Saving to DB..." : "Push to Admin Dashboard"}
                                </button>
                              )}
                              {!tr[a.name] ? (
                                <button
                                  className="btn o"
                                  style={{ padding: "6px 12px", fontSize: "12px", margin: 0, width: "100%" }}
                                  disabled={!!busy}
                                  onClick={() => transcribeOne(a)}
                                >
                                  <FileAudio size={13} /> Transcribe This Call
                                </button>
                              ) : (
                                <span className="trn-badge"><FileAudio size={12} /> Transcribed</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card sec"><h2>All Raw Emergency Records</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <input type="text" placeholder="Search text / id / location..." value={q} onChange={(e) => setQ(e.target.value)} />
                <select value={fs} onChange={(e) => setFs(e.target.value)}><option value="">All status</option><option>ACTIVE</option><option>RESOLVED</option><option>IGNORED</option></select>
                <label className="btn o" style={{ margin: 0 }}>Add files<input type="file" multiple onChange={onPick} /></label>
              </div>
              <div className="sc"><table>
                <thead><tr><th>ID</th><th>Stage</th><th>Source</th><th>Time</th><th>Text Content</th><th>Incident</th><th>People</th><th>Status</th></tr></thead>
                <tbody>{rows.map((i, k) => (
                  <tr key={i.id + k}><td><b>{i.id}</b></td><td>{i.stage}</td><td>{i.src}</td><td>{i.ts.slice(11, 19)}</td><td>{i.text}</td><td>{i.e.inc || "—"}</td><td>{i.e.ppl ?? "—"}</td>
                    <td><span className={`badge ${i.e.st}`}>{i.e.st}</span></td></tr>
                ))}</tbody></table></div>
            </div>
          </>)}
        </div>
      </div>

      {loaded && (<>
        {!sideOpen && <button className="btn fab" onClick={() => setSideOpen(true)}><MessageSquare size={16} /> Ask Gemini</button>}
        <aside className={"side" + (sideOpen ? "" : " off")}>
          <div className="side-hd">
            <b style={{ display: "flex", alignItems: "center", gap: "6px" }}><BrainCircuit size={18} style={{ color: "var(--ac)" }} /> Ask the Assistant</b>
            <span>
              {msgs.length > 0 && <button className="btn o" style={{ margin: "0 6px 0 0", padding: "4px 10px", fontSize: "11px" }} onClick={() => setMsgs([])}>Clear</button>}
              <button className="btn o" style={{ margin: 0, padding: "4px 10px", fontSize: "11px" }} onClick={() => setSideOpen(false)}><X size={14} /></button>
            </span>
          </div>
          <div className="side-ms">
            {!msgs.length && (<>
              <div className="mu sm">Gemini analyzes all emergency records, transcripts, and spatial data. Select a prompt or type below:</div>
              {QUICK.map((s) => <span key={s} className="chip" style={{ cursor: "pointer", padding: "8px 12px", display: "block" }} onClick={() => send(s)}>{s}</span>)}
            </>)}
            {msgs.map((m, i) => <div key={i} className={"msg " + m.role}>{m.text}</div>)}
            {busy && <div className="mu sm">{busy}</div>}
            {err && <div className="er">{err}</div>}
            <div ref={end} />
          </div>
          <div className="side-in">
            <input type="text" placeholder="Ask about priorities, audio calls, timing..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn" style={{ margin: 0 }} disabled={!!busy} onClick={() => send()}><Send size={15} /></button>
          </div>
        </aside>
      </>)}
    </div>
  );
}
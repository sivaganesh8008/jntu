import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pymysql
from dotenv import load_dotenv
from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / os.getenv("UPLOAD_DIR", "uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")
app.secret_key = os.getenv("SESSION_SECRET", "CHANGE_ME")
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024

MYSQL_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DB", "ai_emergency_response"),
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
}

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"

ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
ALLOWED_AUDIO_EXT = {"webm", "wav", "mp3", "m4a", "ogg", "mp4"}

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None


def db():
    return pymysql.connect(**MYSQL_CONFIG)


def ensure_incident_workflow_schema():
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW COLUMNS FROM incidents LIKE 'progress_percent'")
            if not cur.fetchone():
                cur.execute("ALTER TABLE incidents ADD COLUMN progress_percent INT NOT NULL DEFAULT 20")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS incident_events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    incident_id INT NOT NULL,
                    actor_user_id INT NULL,
                    event_type VARCHAR(80) NOT NULL,
                    message TEXT NOT NULL,
                    old_status VARCHAR(40) NULL,
                    new_status VARCHAR(40) NULL,
                    progress_percent INT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_event_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
                    CONSTRAINT fk_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
                    INDEX idx_event_incident (incident_id),
                    INDEX idx_event_created (created_at)
                ) ENGINE=InnoDB
            """)
    finally:
        conn.close()


def log_incident_event(incident_id, actor_user_id, event_type, message, old_status=None, new_status=None, progress_percent=None):
    ensure_incident_workflow_schema()
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO incident_events
                (incident_id, actor_user_id, event_type, message, old_status, new_status, progress_percent)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (incident_id, actor_user_id, event_type, message, old_status, new_status, progress_percent))
    finally:
        conn.close()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, full_name, email, role, created_at FROM users WHERE id=%s",
                (user_id,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def require_login(role=None):
    user = current_user()
    if not user:
        return None, (jsonify({"error": "Authentication required"}), 401)
    if role and user["role"] != role:
        return None, (jsonify({"error": "Forbidden"}), 403)
    return user, None


def clean_text(value, max_len=5000):
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def parse_json_object(text):
    if not text:
        raise ValueError("Empty Gemini response")
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Gemini did not return a JSON object")
    return json.loads(text[start : end + 1])


def gemini_available():
    return bool(GEMINI_API_KEY and genai is not None and types is not None)


def upload_to_gemini(path):
    client = genai.Client(api_key=GEMINI_API_KEY)
    return client.files.upload(file=str(path))


def analyze_report_with_gemini(message_text, photo_path=None, audio_path=None):
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is missing. Copy .env.example to .env and add your real Gemini API key."
        )
    if genai is None or types is None:
        raise RuntimeError(
            "google-genai is not installed. Run: pip install -r requirements.txt"
        )

    client = genai.Client(api_key=GEMINI_API_KEY)

    prompt = """
You are the AI analysis layer of an Emergency Response Assistant.
You assist trained human responders and never make autonomous dispatch decisions.

Analyze this incoming report. It may contain text, a photo, audio, or all three.
Extract only information supported by the evidence.

Return ONLY a JSON object with these keys:
{
  "is_emergency": true,
  "is_noise": false,
  "incident_type": "flood|fire|medical|accident|crime|missing_person|building|weather|other",
  "summary": "one concise factual summary",
  "location_text": "best-known location or landmark, empty if absent",
  "people_affected": null,
  "vulnerable_people": [],
  "resource_needed": "primary resource or empty string",
  "urgency": "low|medium|high|critical",
  "suggested_status": "active|rescue_in_progress|resolved",
  "confidence": 0.0,
  "verified": false,
  "state_change": "new|update|escalation|rescue_in_progress|resolved|none",
  "current_state": "one short current-state sentence",
  "next_action": "one short suggested human-review action",
  "evidence": ["short evidence points"],
  "reason": "brief explanation for the responder"
}

Rules:
- Never invent missing facts.
- Use null/[]/"" when information is unavailable.
- "verified" should be false unless the report itself provides credible confirmation.
- A rumor or forwarded/unverified claim is not confirmed truth.
- If the report says rescue has arrived, use rescue_in_progress.
- If everyone is rescued / the emergency is handled, use resolved.
- Use Indian landmark-style descriptions exactly enough for a responder to recognize them.
- If a photo is attached, use visible evidence from it.
- If audio is attached, understand the spoken content.
"""

    contents = [prompt, f"REPORT TEXT:\n{message_text or '(no text)'}"]

    for media_path in (photo_path, audio_path):
        if media_path:
            uploaded = client.files.upload(file=media_path)
            contents.append(uploaded)

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=1600,
            ),
        )
    except Exception as exc:
        raise RuntimeError(f"Gemini request failed using model '{GEMINI_MODEL}': {exc}") from exc

    text = getattr(response, "text", None)
    if not text:
        raise RuntimeError("Gemini returned an empty response")

    try:
        return parse_json_object(text)
    except Exception as exc:
        raise RuntimeError(f"Gemini returned invalid JSON: {text[:500]}") from exc

def get_active_incidents(limit=25):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, incident_type, summary, location_text,
                       latitude, longitude, people_affected, vulnerable_people,
                       resource_needed, urgency, status, confidence, verified,
                       updated_at
                FROM incidents
                WHERE status <> 'resolved'
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            return cur.fetchall()
    finally:
        conn.close()


def candidate_incidents(report_lat, report_lng, limit=12):
    incidents = get_active_incidents(25)
    if report_lat is None or report_lng is None:
        return incidents[:limit]

    def dist_sq(item):
        if item["latitude"] is None or item["longitude"] is None:
            return 10**9
        return (
            float(item["latitude"]) - float(report_lat)
        ) ** 2 + (
            float(item["longitude"]) - float(report_lng)
        ) ** 2

    return sorted(incidents, key=dist_sq)[:limit]


def choose_incident_with_gemini(analysis, report_text, report_lat, report_lng):
    candidates = candidate_incidents(report_lat, report_lng)
    if not candidates:
        return {"match": "new", "incident_id": None, "confidence": 0.0, "reason": "No active candidates"}

    if not gemini_available():
        return {"match": "new", "incident_id": None, "confidence": 0.0, "reason": "Gemini unavailable"}

    compact = []
    for item in candidates:
        compact.append({
            "id": item["id"],
            "title": item["title"],
            "type": item["incident_type"],
            "summary": item["summary"],
            "location": item["location_text"],
            "lat": float(item["latitude"]) if item["latitude"] is not None else None,
            "lng": float(item["longitude"]) if item["longitude"] is not None else None,
            "people": item["people_affected"],
            "urgency": item["urgency"],
            "status": item["status"],
        })

    prompt = f"""
You are clustering emergency reports for a human responder dashboard.
Do not merge incidents just because they are both emergencies.
Use location, incident type, event description and evidence.
If there is insufficient evidence, create a new incident.

NEW REPORT:
{report_text}

NEW REPORT AI ANALYSIS:
{json.dumps(analysis, ensure_ascii=False)}

NEW REPORT COORDINATES:
lat={report_lat}, lng={report_lng}

ACTIVE INCIDENT CANDIDATES:
{json.dumps(compact, ensure_ascii=False)}

Return ONLY JSON:
{{
  "match": "existing" or "new",
  "incident_id": integer or null,
  "confidence": 0.0,
  "reason": "short explanation"
}}
"""

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
            max_output_tokens=600,
        ),
    )
    result = parse_json_object(response.text)
    if result.get("match") != "existing":
        return {"match": "new", "incident_id": None, "confidence": float(result.get("confidence") or 0), "reason": result.get("reason", "")}

    valid_ids = {int(x["id"]) for x in candidates}
    incident_id = result.get("incident_id")
    try:
        incident_id = int(incident_id)
    except Exception:
        incident_id = None

    if incident_id not in valid_ids:
        return {"match": "new", "incident_id": None, "confidence": 0.0, "reason": "Gemini selected an invalid candidate"}

    return {
        "match": "existing",
        "incident_id": incident_id,
        "confidence": float(result.get("confidence") or 0),
        "reason": result.get("reason", ""),
    }


def merge_incident(analysis, report, cluster_result):
    conn = db()
    try:
        with conn.cursor() as cur:
            incident_id = cluster_result.get("incident_id")

            if cluster_result.get("match") == "existing" and incident_id:
                cur.execute("SELECT * FROM incidents WHERE id=%s", (incident_id,))
                incident = cur.fetchone()
                if not incident:
                    incident_id = None

            if not incident_id:
                title = clean_text(analysis.get("title") or analysis.get("summary") or analysis.get("incident_type") or "Emergency incident", 255)
                cur.execute(
                    """
                    INSERT INTO incidents
                    (title, incident_type, summary, location_text, latitude, longitude,
                     people_affected, vulnerable_people, resource_needed, urgency,
                     status, progress_percent, confidence, verified, last_ai_note)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        title,
                        clean_text(analysis.get("incident_type"), 100) or "other",
                        clean_text(analysis.get("summary")),
                        clean_text(analysis.get("location_text"), 500),
                        report["latitude"],
                        report["longitude"],
                        analysis.get("people_affected"),
                        json.dumps(analysis.get("vulnerable_people") or [], ensure_ascii=False),
                        clean_text(analysis.get("resource_needed"), 255),
                        analysis.get("urgency") if analysis.get("urgency") in {"low","medium","high","critical"} else "low",
                        analysis.get("suggested_status") if analysis.get("suggested_status") in {"active","rescue_in_progress","resolved"} else "active",
                        int(analysis.get("progress_percent") or (100 if analysis.get("suggested_status") == "resolved" else 65 if analysis.get("suggested_status") == "rescue_in_progress" else 20)),
                        min(max(float(analysis.get("confidence") or 0), 0), 1),
                        1 if analysis.get("verified") else 0,
                        clean_text(analysis.get("reason"), 2000),
                    ),
                )
                incident_id = cur.lastrowid
            else:
                # Only overwrite fields when the new report contains useful information.
                cur.execute("SELECT * FROM incidents WHERE id=%s", (incident_id,))
                incident = cur.fetchone()

                old_people = incident["people_affected"]
                new_people = analysis.get("people_affected")
                people = new_people if new_people is not None else old_people

                old_vulnerable = incident["vulnerable_people"]
                vulnerable = analysis.get("vulnerable_people")
                if vulnerable:
                    vulnerable_json = json.dumps(vulnerable, ensure_ascii=False)
                else:
                    vulnerable_json = old_vulnerable

                urgency_order = {"low": 1, "medium": 2, "high": 3, "critical": 4}
                old_urgency = incident["urgency"] or "low"
                new_urgency = analysis.get("urgency") if analysis.get("urgency") in urgency_order else old_urgency
                urgency = new_urgency if urgency_order[new_urgency] >= urgency_order[old_urgency] else old_urgency

                status = analysis.get("suggested_status") if analysis.get("suggested_status") in {"active","rescue_in_progress","resolved"} else incident["status"]

                cur.execute(
                    """
                    UPDATE incidents
                    SET incident_type=%s,
                        summary=%s,
                        location_text=%s,
                        latitude=COALESCE(%s, latitude),
                        longitude=COALESCE(%s, longitude),
                        people_affected=%s,
                        vulnerable_people=%s,
                        resource_needed=COALESCE(NULLIF(%s,''), resource_needed),
                        urgency=%s,
                        status=%s,
                        progress_percent=%s,
                        confidence=%s,
                        verified=GREATEST(verified, %s),
                        last_ai_note=%s,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE id=%s
                    """,
                    (
                        clean_text(analysis.get("incident_type"), 100) or incident["incident_type"],
                        clean_text(analysis.get("summary")) or incident["summary"],
                        clean_text(analysis.get("location_text"), 500) or incident["location_text"],
                        report["latitude"],
                        report["longitude"],
                        people,
                        vulnerable_json,
                        clean_text(analysis.get("resource_needed"), 255),
                        urgency,
                        status,
                        int(analysis.get("progress_percent") or (100 if status == "resolved" else 65 if status == "rescue_in_progress" else incident.get("progress_percent") or 20)),
                        min(max(float(analysis.get("confidence") or incident["confidence"] or 0), 0), 1),
                        1 if analysis.get("verified") else 0,
                        clean_text(analysis.get("reason"), 2000),
                        incident_id,
                    ),
                )

            cur.execute("UPDATE reports SET incident_id=%s WHERE id=%s", (incident_id, report["id"]))
            return incident_id
    finally:
        conn.close()


def save_uploaded(file_obj, kind):
    if not file_obj or not file_obj.filename:
        return None

    original = secure_filename(file_obj.filename)
    ext = original.rsplit(".", 1)[1].lower() if "." in original else ""
    allowed = ALLOWED_IMAGE_EXT if kind == "image" else ALLOWED_AUDIO_EXT
    if ext not in allowed:
        raise ValueError(f"Unsupported {kind} file type: {ext or 'unknown'}")

    filename = f"{uuid.uuid4().hex}.{ext}"
    path = UPLOAD_DIR / filename
    file_obj.save(path)
    return filename



@app.get("/api/ai/status")
def ai_status():
    configured = bool(GEMINI_API_KEY)
    sdk = genai is not None
    return jsonify({
        "configured": configured,
        "sdk_installed": sdk,
        "model": GEMINI_MODEL,
        "ready": configured and sdk,
    })


@app.post("/api/ai/test")
def ai_test():
    admin, error = require_login("admin")
    if error:
        return error
    try:
        if not gemini_available():
            raise RuntimeError("Gemini is not configured. Check GEMINI_API_KEY and google-genai.")
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents="Reply with exactly: GEMINI_OK",
            config=types.GenerateContentConfig(temperature=0, max_output_tokens=20),
        )
        return jsonify({"ok": True, "model": GEMINI_MODEL, "reply": response.text})
    except Exception as exc:
        return jsonify({"ok": False, "model": GEMINI_MODEL, "error": str(exc)}), 502


@app.get("/api/health")
def health():
    result = {"ok": True, "mysql": False, "gemini": gemini_available()}
    try:
        conn = db()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            cur.fetchone()
        conn.close()
        result["mysql"] = True
    except Exception as exc:
        result["mysql_error"] = str(exc)
    return jsonify(result)


@app.post("/api/auth/register")
def register():
    data = request.form if request.form else (request.get_json(silent=True) or {})
    name = clean_text(data.get("full_name"), 120)
    email = clean_text(data.get("email"), 190).lower()
    password = data.get("password") or ""

    if not name or not email or len(password) < 6:
        return jsonify({"error": "Name, email and password (minimum 6 characters) are required"}), 400

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            if cur.fetchone():
                return jsonify({"error": "Email is already registered"}), 409
            cur.execute(
                "INSERT INTO users (full_name,email,password_hash,role) VALUES (%s,%s,%s,'user')",
                (name, email, generate_password_hash(password)),
            )
        return jsonify({"message": "Registration successful"})
    finally:
        conn.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = clean_text(data.get("email"), 190).lower()
    password = data.get("password") or ""
    role = data.get("role")

    if role not in {"admin", "user"}:
        return jsonify({"error": "Invalid role"}), 400

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id,full_name,email,password_hash,role FROM users WHERE email=%s AND role=%s",
                (email, role),
            )
            user = cur.fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid credentials"}), 401
        session.clear()
        session["user_id"] = user["id"]
        return jsonify({
            "user": {
                "id": user["id"],
                "full_name": user["full_name"],
                "email": user["email"],
                "role": user["role"],
            }
        })
    finally:
        conn.close()


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@app.get("/api/auth/me")
def me():
    user = current_user()
    if not user:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "user": user})


@app.post("/api/setup-admin")
def setup_admin():
    data = request.get_json(silent=True) or {}
    name = clean_text(data.get("full_name"), 120)
    email = clean_text(data.get("email"), 190).lower()
    password = data.get("password") or ""

    if not name or not email or len(password) < 8:
        return jsonify({"error": "Name, email and password (minimum 8 characters) are required"}), 400

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS count FROM users WHERE role='admin'")
            if cur.fetchone()["count"] > 0:
                return jsonify({"error": "An admin already exists"}), 409
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            if cur.fetchone():
                return jsonify({"error": "Email is already registered"}), 409
            cur.execute(
                "INSERT INTO users (full_name,email,password_hash,role) VALUES (%s,%s,%s,'admin')",
                (name, email, generate_password_hash(password)),
            )
        return jsonify({"message": "Admin created"})
    finally:
        conn.close()


@app.get("/api/admin/setup-available")
def setup_available():
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS count FROM users WHERE role='admin'")
            return jsonify({"available": cur.fetchone()["count"] == 0})
    finally:
        conn.close()


@app.post("/api/location")
def update_location():
    user, error = require_login("user")
    if error:
        return error

    data = request.get_json(silent=True) or {}
    try:
        lat = float(data["latitude"])
        lng = float(data["longitude"])
        accuracy = float(data.get("accuracy")) if data.get("accuracy") is not None else None
    except Exception:
        return jsonify({"error": "Valid latitude and longitude are required"}), 400

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "Invalid coordinates"}), 400

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_locations (user_id,latitude,longitude,accuracy,is_live)
                VALUES (%s,%s,%s,%s,1)
                ON DUPLICATE KEY UPDATE
                    latitude=VALUES(latitude),
                    longitude=VALUES(longitude),
                    accuracy=VALUES(accuracy),
                    is_live=1,
                    updated_at=CURRENT_TIMESTAMP
                """,
                (user["id"], lat, lng, accuracy),
            )
        return jsonify({"message": "Location updated"})
    finally:
        conn.close()


@app.post("/api/location/stop")
def stop_location():
    user, error = require_login("user")
    if error:
        return error
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE user_locations SET is_live=0 WHERE user_id=%s", (user["id"],))
        return jsonify({"message": "Live location stopped"})
    finally:
        conn.close()


@app.post("/api/reports")
def create_report():
    user, error = require_login("user")
    if error:
        return error

    message_text = clean_text(request.form.get("message_text"), 10000)
    lat_raw = request.form.get("latitude")
    lng_raw = request.form.get("longitude")

    try:
        latitude = float(lat_raw) if lat_raw not in (None, "") else None
        longitude = float(lng_raw) if lng_raw not in (None, "") else None
    except Exception:
        return jsonify({"error": "Invalid coordinates"}), 400

    try:
        photo_filename = save_uploaded(request.files.get("photo"), "image")
        audio_filename = save_uploaded(request.files.get("audio"), "audio")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not message_text and not photo_filename and not audio_filename:
        return jsonify({"error": "Send a message, photo or voice recording"}), 400

    if photo_filename and audio_filename:
        channel = "multimodal"
    elif photo_filename:
        channel = "photo"
    elif audio_filename:
        channel = "voice"
    else:
        channel = "text"

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO reports
                (user_id,channel,message_text,photo_path,audio_path,latitude,longitude,ai_status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,'pending')
                """,
                (user["id"], channel, message_text, photo_filename, audio_filename, latitude, longitude),
            )
            report_id = cur.lastrowid
    finally:
        conn.close()

    report = {"id": report_id, "latitude": latitude, "longitude": longitude}
    photo_path = str(UPLOAD_DIR / photo_filename) if photo_filename else None
    audio_path = str(UPLOAD_DIR / audio_filename) if audio_filename else None

    try:
        analysis = analyze_report_with_gemini(
            message_text,
            photo_path=photo_path,
            audio_path=audio_path,
        )

        if not analysis.get("is_emergency", False) or analysis.get("is_noise", False):
            ai_payload = {"analysis": analysis, "workflow": "filtered_non_emergency"}
            conn = db()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE reports SET ai_json=%s, ai_status='rejected' WHERE id=%s",
                        (json.dumps(ai_payload, ensure_ascii=False), report_id),
                    )
            finally:
                conn.close()
            return jsonify({
                "message": "Report received and AI classified it as non-emergency/noise.",
                "report_id": report_id,
                "ai": analysis,
                "requires_admin_review": False,
            })

        # Human-in-the-loop: AI extracts and proposes; responder creates/links the incident.
        ai_payload = {
            "analysis": analysis,
            "workflow": "awaiting_admin_incident_review",
            "clustering": None,
        }
        conn = db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE reports SET ai_json=%s, ai_status='processed' WHERE id=%s",
                    (json.dumps(ai_payload, ensure_ascii=False), report_id),
                )
        finally:
            conn.close()

        return jsonify({
            "message": "Report received. AI analysis is ready for responder review.",
            "report_id": report_id,
            "ai": analysis,
            "requires_admin_review": True,
        })
    except Exception as exc:
        conn = db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE reports SET ai_status='error', ai_json=%s WHERE id=%s",
                    (json.dumps({"error": str(exc)}), report_id),
                )
        finally:
            conn.close()
        return jsonify({
            "error": "Report was saved, but AI processing failed",
            "report_id": report_id,
            "details": str(exc),
        }), 502


@app.get("/api/user/reports")
def user_reports():
    user, error = require_login("user")
    if error:
        return error

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id,r.channel,r.message_text,r.photo_path,r.audio_path,
                       r.latitude,r.longitude,r.ai_status,r.created_at,
                       r.incident_id,i.title,i.status,i.urgency
                FROM reports r
                LEFT JOIN incidents i ON i.id=r.incident_id
                WHERE r.user_id=%s
                ORDER BY r.created_at DESC
                LIMIT 100
                """,
                (user["id"],),
            )
            rows = cur.fetchall()
            return jsonify({"reports": serialize_rows(rows)})
    finally:
        conn.close()


def serialize_rows(rows):
    output = []
    for row in rows:
        item = dict(row)
        for key, value in list(item.items()):
            if isinstance(value, datetime):
                item[key] = value.isoformat()
        output.append(item)
    return output



@app.post("/api/admin/incidents")
def admin_create_incident():
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error
    data = request.get_json(silent=True) or {}

    title = clean_text(data.get("title"), 255)
    if not title:
        return jsonify({"error": "Incident title is required"}), 400

    status = data.get("status") if data.get("status") in {"active", "rescue_in_progress", "resolved"} else "active"
    urgency = data.get("urgency") if data.get("urgency") in {"low", "medium", "high", "critical"} else "medium"

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO incidents
                (title, incident_type, summary, location_text, latitude, longitude,
                 people_affected, vulnerable_people, resource_needed, urgency,
                 status, progress_percent, confidence, verified, last_ai_note)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    title,
                    clean_text(data.get("incident_type"), 100) or "other",
                    clean_text(data.get("summary")),
                    clean_text(data.get("location_text"), 500),
                    data.get("latitude"),
                    data.get("longitude"),
                    data.get("people_affected"),
                    json.dumps(data.get("vulnerable_people") or [], ensure_ascii=False),
                    clean_text(data.get("resource_needed"), 255),
                    urgency,
                    status,
                    int(data.get("progress_percent") or (100 if status == "resolved" else 65 if status == "rescue_in_progress" else 20)),
                    float(data.get("confidence") or 0),
                    1 if data.get("verified") else 0,
                    clean_text(data.get("admin_note"), 2000),
                ),
            )
            incident_id = cur.lastrowid
        log_incident_event(incident_id, admin["id"], "created", "Incident created from responder action.", None, status, int(data.get("progress_percent") or (100 if status == "resolved" else 65 if status == "rescue_in_progress" else 20)))
        return jsonify({"incident_id": incident_id, "message": "Incident created"})
    finally:
        conn.close()


@app.patch("/api/admin/incidents/<int:incident_id>")
def admin_update_incident(incident_id):
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error
    data = request.get_json(silent=True) or {}

    allowed = {
        "title", "incident_type", "summary", "location_text", "latitude", "longitude",
        "people_affected", "resource_needed", "urgency", "status", "progress_percent", "admin_note"
    }
    updates = []
    params = []

    for key in allowed:
        if key in data:
            value = data[key]
            if key == "urgency" and value not in {"low", "medium", "high", "critical"}:
                continue
            if key == "status" and value not in {"active", "rescue_in_progress", "resolved"}:
                continue
            if key == "progress_percent":
                try:
                    value = max(0, min(100, int(value)))
                except Exception:
                    continue
            if key in {"title", "incident_type", "location_text", "resource_needed"}:
                value = clean_text(value, 500)
            if key in {"summary", "admin_note"}:
                value = clean_text(value, 5000)
            updates.append(f"{key}=%s")
            params.append(value)

    if not updates:
        return jsonify({"error": "No valid fields supplied"}), 400

    if "admin_note" in data:
        updates.append("last_ai_note=%s")
        params.append(clean_text(data.get("admin_note"), 5000))
        updates = [x for x in updates if x != "admin_note=%s"]

    updates.append("updated_at=CURRENT_TIMESTAMP")
    params.append(incident_id)

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status, progress_percent FROM incidents WHERE id=%s", (incident_id,))
            before = cur.fetchone()
            if not before:
                return jsonify({"error": "Incident not found"}), 404
            cur.execute(f"UPDATE incidents SET {', '.join(updates)} WHERE id=%s", params)
            cur.execute("SELECT status, progress_percent FROM incidents WHERE id=%s", (incident_id,))
            after = cur.fetchone()
    finally:
        conn.close()

    if after:
        changed = []
        if before["status"] != after["status"]:
            changed.append(f"State changed from {before['status'].replace('_',' ')} to {after['status'].replace('_',' ')}.")
        if before["progress_percent"] != after["progress_percent"]:
            changed.append(f"Progress updated to {after['progress_percent']}%.")
        if "urgency" in data:
            changed.append(f"Urgency set to {data['urgency']}.")
        if "admin_note" in data and clean_text(data.get("admin_note")):
            changed.append(clean_text(data.get("admin_note"), 500))
        if changed:
            log_incident_event(incident_id, admin["id"], "responder_update", " ".join(changed), before["status"], after["status"], after["progress_percent"])
    return jsonify({"message": "Incident updated"})



@app.post("/api/admin/reports/<int:report_id>/create-incident")
def admin_create_incident_from_report(report_id):
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error

    data = request.get_json(silent=True) or {}
    force_new = bool(data.get("force_new", False))

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM reports WHERE id=%s", (report_id,))
            report = cur.fetchone()
            if not report:
                return jsonify({"error": "Report not found"}), 404
            if report["incident_id"]:
                return jsonify({"error": f"Report is already linked to incident #{report['incident_id']}"}), 409
            payload = {}
            analysis = {}
            if report["ai_json"]:
                try:
                    payload = json.loads(report["ai_json"])
                    analysis = payload.get("analysis", payload)
                except Exception:
                    payload = {}
                    analysis = {}

        # Allow the responder to correct/confirm extracted information.
        if data.get("title") not in (None, ""):
            analysis["title"] = clean_text(data.get("title"), 255)
        for key in [
            "summary", "location_text", "resource_needed", "incident_type",
            "urgency", "suggested_status", "people_affected", "verified"
        ]:
            if key in data and data[key] not in ("", None):
                analysis[key] = data[key]

        if "vulnerable_people" in data:
            analysis["vulnerable_people"] = data["vulnerable_people"]
        if "progress_percent" in data and data["progress_percent"] not in ("", None):
            try:
                analysis["progress_percent"] = max(0, min(100, int(data["progress_percent"])))
            except Exception:
                pass

        # Default action is a NEW incident created by the human responder.
        # AI is advisory and never silently creates or merges incidents.
        cluster = {
            "match": "new",
            "incident_id": None,
            "confidence": 1.0,
            "reason": "Responder explicitly created a new incident",
        }

        incident_id = merge_incident(
            analysis,
            {
                "id": report["id"],
                "latitude": report["latitude"],
                "longitude": report["longitude"],
            },
            cluster,
        )
        log_incident_event(incident_id, admin["id"], "created_from_report", f"Incident created from report #{report_id} by responder.", None, analysis.get("suggested_status") or "active", int(data.get("progress_percent") or (100 if analysis.get("suggested_status") == "resolved" else 65 if analysis.get("suggested_status") == "rescue_in_progress" else 20)))

        conn = db()
        try:
            with conn.cursor() as cur:
                payload["analysis"] = analysis
                payload["clustering"] = cluster
                payload["workflow"] = "incident_created_or_linked_by_admin"
                cur.execute(
                    "UPDATE reports SET ai_json=%s, incident_id=%s WHERE id=%s",
                    (json.dumps(payload, ensure_ascii=False), incident_id, report_id),
                )
        finally:
            conn.close()

        return jsonify({
            "message": f"Report linked to incident #{incident_id}",
            "incident_id": incident_id,
            "clustering": cluster,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.get("/api/admin/incidents/<int:incident_id>")
def admin_incident_detail(incident_id):
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM incidents WHERE id=%s", (incident_id,))
            incident = cur.fetchone()
            if not incident:
                return jsonify({"error": "Incident not found"}), 404

            cur.execute(
                """
                SELECT r.*, u.full_name, u.email
                FROM reports r
                JOIN users u ON u.id=r.user_id
                WHERE r.incident_id=%s
                ORDER BY r.created_at ASC
                """,
                (incident_id,),
            )
            reports = serialize_rows(cur.fetchall())
            cur.execute(
                """
                SELECT e.*, u.full_name AS actor_name
                FROM incident_events e
                LEFT JOIN users u ON u.id=e.actor_user_id
                WHERE e.incident_id=%s
                ORDER BY e.created_at ASC
                """,
                (incident_id,),
            )
            events = serialize_rows(cur.fetchall())

            return jsonify({
                "incident": serialize_rows([incident])[0],
                "reports": reports,
                "events": events,
            })
    finally:
        conn.close()


@app.get("/api/admin/reports/<int:report_id>")
def admin_report_detail(report_id):
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error

    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.*, u.full_name, u.email
                FROM reports r
                JOIN users u ON u.id=r.user_id
                WHERE r.id=%s
                """,
                (report_id,),
            )
            report = cur.fetchone()
            if not report:
                return jsonify({"error": "Report not found"}), 404

            report = serialize_rows([report])[0]
            try:
                payload = json.loads(report.get("ai_json") or "{}")
                analysis = payload.get("analysis", payload) if isinstance(payload, dict) else {}
                report["ai_analysis"] = analysis
                report["ai_urgency"] = analysis.get("urgency")
                report["ai_summary"] = analysis.get("summary")
                report["ai_current_state"] = analysis.get("current_state")
                report["ai_next_action"] = analysis.get("next_action")
                report["ai_confidence"] = analysis.get("confidence")
            except Exception:
                report["ai_analysis"] = {}

            return jsonify({"report": report})
    finally:
        conn.close()


@app.get("/api/admin/dashboard")
def admin_dashboard():
    admin, error = require_login("admin")
    ensure_incident_workflow_schema()
    if error:
        return error

    status_filter = request.args.get("status", "all")
    search = clean_text(request.args.get("search"), 200)

    conn = db()
    try:
        with conn.cursor() as cur:
            where = ["1=1"]
            params = []
            if status_filter in {"active", "rescue_in_progress", "resolved"}:
                where.append("i.status=%s")
                params.append(status_filter)
            if search:
                where.append(
                    "(i.title LIKE %s OR i.location_text LIKE %s OR i.summary LIKE %s OR i.resource_needed LIKE %s)"
                )
                term = f"%{search}%"
                params.extend([term, term, term, term])

            cur.execute(
                f"""
                SELECT i.*
                FROM incidents i
                WHERE {' AND '.join(where)}
                ORDER BY
                  CASE i.urgency
                    WHEN 'critical' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    ELSE 4
                  END,
                  i.updated_at DESC
                LIMIT 300
                """,
                params,
            )
            incidents = serialize_rows(cur.fetchall())

            cur.execute(
                """
                SELECT r.id,r.incident_id,r.channel,r.message_text,r.photo_path,r.audio_path,
                       r.latitude,r.longitude,r.ai_status,r.ai_json,r.created_at,
                       u.full_name,u.email
                FROM reports r
                JOIN users u ON u.id=r.user_id
                ORDER BY
                  CASE WHEN r.incident_id IS NULL THEN 0 ELSE 1 END,
                  CASE JSON_UNQUOTE(JSON_EXTRACT(r.ai_json, '$.analysis.urgency'))
                    WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                  r.created_at DESC
                LIMIT 300
                """
            )
            reports = serialize_rows(cur.fetchall())
            for report in reports:
                try:
                    payload = json.loads(report.get("ai_json") or "{}")
                    analysis = payload.get("analysis", payload) if isinstance(payload, dict) else {}
                    report["ai_analysis"] = analysis
                    report["ai_urgency"] = analysis.get("urgency")
                    report["ai_summary"] = analysis.get("summary")
                    report["ai_current_state"] = analysis.get("current_state")
                    report["ai_next_action"] = analysis.get("next_action")
                    report["ai_confidence"] = analysis.get("confidence")
                except Exception:
                    report["ai_analysis"] = {}
                    report["ai_urgency"] = None

            cur.execute(
                """
                SELECT ul.id,ul.user_id,ul.latitude,ul.longitude,ul.accuracy,
                       ul.is_live,ul.updated_at,u.full_name,u.email
                FROM user_locations ul
                JOIN users u ON u.id=ul.user_id
                ORDER BY ul.updated_at DESC
                """
            )
            locations = serialize_rows(cur.fetchall())

            cur.execute(
                """
                SELECT
                  COUNT(*) AS total,
                  SUM(status='active') AS active,
                  SUM(status='rescue_in_progress') AS rescue_in_progress,
                  SUM(status='resolved') AS resolved,
                  SUM(urgency='critical') AS critical,
                  SUM(urgency='high') AS high,
                  COALESCE(SUM(people_affected),0) AS people
                FROM incidents
                """
            )
            stats = cur.fetchone()
            cur.execute("SELECT COUNT(*) AS pending_reports FROM reports WHERE incident_id IS NULL AND ai_status IN ('pending','processed','error')")
            stats["pending_reports"] = cur.fetchone()["pending_reports"]

            return jsonify({
                "incidents": incidents,
                "reports": reports,
                "locations": locations,
                "stats": stats,
            })
    finally:
        conn.close()


@app.get("/uploads/<path:filename>")
def uploaded_file(filename):
    # Only generated filenames are served from the upload directory.
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/")
def index():
    dist_index = BASE_DIR / "frontend" / "dist" / "index.html"
    if dist_index.exists():
        return send_from_directory(dist_index.parent, "index.html")
    return jsonify({
        "message": "React build not found. Run `cd frontend && npm install && npm run build`, then start app.py."
    })


@app.get("/<path:path>")
def spa_fallback(path):
    # Let React handle client-side detail URLs such as /admin/incidents/12.
    if path.startswith("api/") or path.startswith("uploads/"):
        return jsonify({"error": "Not found"}), 404
    dist_index = BASE_DIR / "frontend" / "dist" / "index.html"
    if dist_index.exists():
        return send_from_directory(dist_index.parent, "index.html")
    return jsonify({
        "message": "React build not found. Run `cd frontend && npm install && npm run build`, then start app.py."
    })


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "Uploaded files exceed the configured size limit"}), 413


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)

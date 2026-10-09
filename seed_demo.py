"""Seed realistic demo data for the AI Emergency Response Assistant.

Run after schema.sql has been imported and Python dependencies are installed:
    python seed_demo.py

Demo credentials:
    Admin: admin.demo@example.com / Admin@123
    User:  citizen.demo@example.com / User@123

The script is idempotent for the demo records: running it again will not create
another copy of the same demo users, incidents, reports, or live locations.
"""

import json

from werkzeug.security import generate_password_hash

from app import db, ensure_incident_workflow_schema, log_incident_event


ADMIN_EMAIL = "admin.demo@example.com"
USER_EMAIL = "citizen.demo@example.com"
ADMIN_PASSWORD = "Admin@123"
USER_PASSWORD = "User@123"


INCIDENTS = [
    {
        "title": "Critical flooding near Metro Junction",
        "incident_type": "flood",
        "summary": "Water has entered several ground-floor buildings and residents are requesting immediate rescue support.",
        "location_text": "Metro Junction, Sector 4",
        "latitude": 12.971600,
        "longitude": 77.594600,
        "people_affected": 18,
        "vulnerable_people": ["2 children", "1 elderly person"],
        "resource_needed": "Rescue boat and medical team",
        "urgency": "critical",
        "status": "active",
        "progress_percent": 20,
        "confidence": 0.96,
        "verified": 1,
        "last_ai_note": "Multiple reports indicate rising water and people trapped on lower floors.",
    },
    {
        "title": "Building fire — rescue team en route",
        "incident_type": "fire",
        "summary": "Smoke and flames reported on the second floor. Residents are evacuating while responders move toward the location.",
        "location_text": "12th Cross, Industrial Layout",
        "latitude": 12.984800,
        "longitude": 77.603300,
        "people_affected": 9,
        "vulnerable_people": ["1 injured person"],
        "resource_needed": "Fire engine and ambulance",
        "urgency": "high",
        "status": "rescue_in_progress",
        "progress_percent": 65,
        "confidence": 0.91,
        "verified": 1,
        "last_ai_note": "Responder update: evacuation and fire suppression are in progress.",
    },
    {
        "title": "Road accident at Ring Road",
        "incident_type": "accident",
        "summary": "Two vehicles collided at the junction. One person required medical assistance.",
        "location_text": "Ring Road Junction",
        "latitude": 12.956900,
        "longitude": 77.585700,
        "people_affected": 3,
        "vulnerable_people": ["1 injured adult"],
        "resource_needed": "Ambulance",
        "urgency": "high",
        "status": "resolved",
        "progress_percent": 100,
        "confidence": 0.94,
        "verified": 1,
        "last_ai_note": "Incident resolved after medical evacuation and road clearance.",
    },
    {
        "title": "Medical emergency at bus terminal",
        "incident_type": "medical",
        "summary": "A passenger reported a serious medical emergency and requested an ambulance.",
        "location_text": "Central Bus Terminal, Gate 2",
        "latitude": 12.978400,
        "longitude": 77.570900,
        "people_affected": 1,
        "vulnerable_people": ["1 adult"],
        "resource_needed": "Ambulance",
        "urgency": "medium",
        "status": "active",
        "progress_percent": 20,
        "confidence": 0.88,
        "verified": 0,
        "last_ai_note": "Location is specific but responder verification is still pending.",
    },
    {
        "title": "Missing person report near public park",
        "incident_type": "missing_person",
        "summary": "Family reports that a teenager has not returned home and was last seen near the public park.",
        "location_text": "Lake View Public Park",
        "latitude": 12.965500,
        "longitude": 77.601200,
        "people_affected": 1,
        "vulnerable_people": ["1 teenager"],
        "resource_needed": "Search team",
        "urgency": "medium",
        "status": "active",
        "progress_percent": 35,
        "confidence": 0.82,
        "verified": 1,
        "last_ai_note": "Search team requested; last-known location is available.",
    },
]

REPORTS = [
    {
        "message_text": "Flood water is entering the houses near Metro Junction. Around 18 people are stuck and we need a rescue boat.",
        "channel": "multimodal",
        "latitude": 12.971600,
        "longitude": 77.594600,
        "incident_title": "Critical flooding near Metro Junction",
        "ai_status": "processed",
        "ai": {
            "is_emergency": True,
            "is_noise": False,
            "incident_type": "flood",
            "summary": "Residents report flooding with people trapped on lower floors.",
            "location_text": "Metro Junction, Sector 4",
            "people_affected": 18,
            "vulnerable_people": ["2 children", "1 elderly person"],
            "resource_needed": "Rescue boat and medical team",
            "urgency": "critical",
            "suggested_status": "active",
            "confidence": 0.96,
            "verified": False,
            "state_change": "new",
            "current_state": "Emergency / Pending rescue",
            "next_action": "Verify the exact building and dispatch rescue resources through the responder workflow.",
            "evidence": ["18 people reported", "water entering buildings", "rescue boat requested"],
            "reason": "High-confidence emergency indicators with a specific location and immediate resource need.",
        },
    },
    {
        "message_text": "Smoke and flames are visible from the second floor at 12th Cross. People are leaving the building.",
        "channel": "text",
        "latitude": 12.984800,
        "longitude": 77.603300,
        "incident_title": "Building fire — rescue team en route",
        "ai_status": "processed",
        "ai": {
            "is_emergency": True,
            "is_noise": False,
            "incident_type": "fire",
            "summary": "Building fire reported with active evacuation.",
            "location_text": "12th Cross, Industrial Layout",
            "people_affected": 9,
            "vulnerable_people": ["1 injured person"],
            "resource_needed": "Fire engine and ambulance",
            "urgency": "high",
            "suggested_status": "rescue_in_progress",
            "confidence": 0.91,
            "verified": True,
            "state_change": "rescue_in_progress",
            "current_state": "Rescue in progress",
            "next_action": "Continue evacuation and confirm fire suppression status.",
            "evidence": ["smoke", "flames", "second floor", "people evacuating"],
            "reason": "The report contains direct indicators of an active building fire.",
        },
    },
    {
        "message_text": "Two cars collided at Ring Road Junction. One person is injured and needs an ambulance.",
        "channel": "voice",
        "latitude": 12.956900,
        "longitude": 77.585700,
        "incident_title": "Road accident at Ring Road",
        "ai_status": "processed",
        "ai": {
            "is_emergency": True,
            "is_noise": False,
            "incident_type": "accident",
            "summary": "Vehicle collision with one injured person.",
            "location_text": "Ring Road Junction",
            "people_affected": 3,
            "vulnerable_people": ["1 injured adult"],
            "resource_needed": "Ambulance",
            "urgency": "high",
            "suggested_status": "resolved",
            "confidence": 0.94,
            "verified": True,
            "state_change": "resolved",
            "current_state": "Resolved",
            "next_action": "No further emergency action required; retain incident history.",
            "evidence": ["two vehicles", "collision", "injured person"],
            "reason": "The emergency response was completed and the incident was resolved.",
        },
    },
    {
        "message_text": "Need an ambulance at Central Bus Terminal Gate 2. A passenger has collapsed.",
        "channel": "text",
        "latitude": 12.978400,
        "longitude": 77.570900,
        "incident_title": "Medical emergency at bus terminal",
        "ai_status": "processed",
        "ai": {
            "is_emergency": True,
            "is_noise": False,
            "incident_type": "medical",
            "summary": "Passenger reported unconscious or collapsed and needs urgent medical assistance.",
            "location_text": "Central Bus Terminal, Gate 2",
            "people_affected": 1,
            "vulnerable_people": ["1 adult"],
            "resource_needed": "Ambulance",
            "urgency": "medium",
            "suggested_status": "active",
            "confidence": 0.88,
            "verified": False,
            "state_change": "new",
            "current_state": "Emergency / Pending rescue",
            "next_action": "Verify the passenger condition and confirm ambulance response.",
            "evidence": ["passenger collapsed", "specific gate", "ambulance requested"],
            "reason": "Specific location and medical emergency are reported, but responder verification is pending.",
        },
    },
    {
        "message_text": "My family has not seen a teenager since this afternoon. Last seen near Lake View Public Park.",
        "channel": "text",
        "latitude": 12.965500,
        "longitude": 77.601200,
        "incident_title": "Missing person report near public park",
        "ai_status": "processed",
        "ai": {
            "is_emergency": True,
            "is_noise": False,
            "incident_type": "missing_person",
            "summary": "Teenager reported missing with a last-known location near the public park.",
            "location_text": "Lake View Public Park",
            "people_affected": 1,
            "vulnerable_people": ["1 teenager"],
            "resource_needed": "Search team",
            "urgency": "medium",
            "suggested_status": "active",
            "confidence": 0.82,
            "verified": True,
            "state_change": "new",
            "current_state": "Search pending",
            "next_action": "Start search workflow and collect the last-known details.",
            "evidence": ["teenager", "not seen since afternoon", "last seen at park"],
            "reason": "The report describes a potentially vulnerable missing person with a last-known location.",
        },
    },
]


def get_or_create_user(email, name, password, role):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            row = cur.fetchone()
            if row:
                return row["id"]
            cur.execute(
                "INSERT INTO users (full_name,email,password_hash,role) VALUES (%s,%s,%s,%s)",
                (name, email, generate_password_hash(password), role),
            )
            return cur.lastrowid
    finally:
        conn.close()


def get_or_create_incident(data, admin_id):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM incidents WHERE title=%s", (data["title"],))
            row = cur.fetchone()
            if row:
                return row["id"]
            cur.execute(
                """
                INSERT INTO incidents
                (title, incident_type, summary, location_text, latitude, longitude,
                 people_affected, vulnerable_people, resource_needed, urgency,
                 status, progress_percent, confidence, verified, last_ai_note)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    data["title"], data["incident_type"], data["summary"], data["location_text"],
                    data["latitude"], data["longitude"], data["people_affected"],
                    json.dumps(data["vulnerable_people"]), data["resource_needed"], data["urgency"],
                    data["status"], data["progress_percent"], data["confidence"],
                    data["verified"], data["last_ai_note"],
                ),
            )
            incident_id = cur.lastrowid
        log_incident_event(
            incident_id, admin_id, "demo_seed",
            "Demo incident created by seed_demo.py.",
            None, data["status"], data["progress_percent"],
        )
        return incident_id
    finally:
        conn.close()


def create_report(data, user_id, incident_id):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM reports WHERE user_id=%s AND message_text=%s",
                (user_id, data["message_text"]),
            )
            row = cur.fetchone()
            if row:
                return row["id"]
            cur.execute(
                """
                INSERT INTO reports
                (user_id, incident_id, channel, message_text, latitude, longitude, ai_json, ai_status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    user_id, incident_id, data["channel"], data["message_text"],
                    data["latitude"], data["longitude"], json.dumps(data["ai"], ensure_ascii=False),
                    data["ai_status"],
                ),
            )
            return cur.lastrowid
    finally:
        conn.close()


def seed_locations(user_id):
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_locations (user_id, latitude, longitude, accuracy, is_live)
                VALUES (%s,%s,%s,%s,1)
                ON DUPLICATE KEY UPDATE latitude=VALUES(latitude), longitude=VALUES(longitude), accuracy=VALUES(accuracy), is_live=1
                """,
                (user_id, 12.972200, 77.592900, 12.0),
            )
    finally:
        conn.close()


def main():
    ensure_incident_workflow_schema()

    admin_id = get_or_create_user(ADMIN_EMAIL, "Demo Admin", ADMIN_PASSWORD, "admin")
    user_id = get_or_create_user(USER_EMAIL, "Demo Citizen", USER_PASSWORD, "user")

    incident_ids = {}
    for item in INCIDENTS:
        incident_ids[item["title"]] = get_or_create_incident(item, admin_id)

    for item in REPORTS:
        create_report(item, user_id, incident_ids[item["incident_title"]])

    seed_locations(user_id)

    print("\nDemo data is ready.")
    print("Admin login :", ADMIN_EMAIL, "/", ADMIN_PASSWORD)
    print("User login  :", USER_EMAIL, "/", USER_PASSWORD)
    print("Incidents   :", len(INCIDENTS))
    print("Reports     :", len(REPORTS))
    print("Live user   : Demo Citizen")
    print("\nTip: login as admin first to see the command dashboard, incident states, progress, reports, AI analysis, and timeline.")


if __name__ == "__main__":
    main()

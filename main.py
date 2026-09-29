import json
import uuid
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List
import jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="ABHA Health Record System")
BASE_DIR = Path(__file__).resolve().parent

JWT_SECRET = "abha_super_secret_python_key_2026"
ALGORITHM = "HS256"

# In-memory storage for active consents
# Key: consent_id, Value: dict containing consent metadata
active_consents: Dict[str, dict] = {}

# Mock Patient ABHA Record
PATIENT_DB = {
    "abha_id": "91-8472-1049-3829",
    "name": "Rameshwar Sharma",
    "age": 48,
    "gender": "Male",
    "blood_group": "B+ve",
    "allergies": [
        {"substance": "Amoxicillin / Penicillin Group", "reaction": "Anaphylactic rash & Angioedema", "severity": "HIGH"}
    ],
    "medications": [
        {"drug": "Metformin 500mg", "dosage": "1 tab twice daily (After food)", "facility": "PHC Narsingi", "date": "2026-03-24"},
        {"drug": "Telmisartan 40mg", "dosage": "1 tab morning", "facility": "City Heart Care", "date": "2026-02-15"},
        {"drug": "Atorvastatin 10mg", "dosage": "1 tab at bedtime", "facility": "District Hospital", "date": "2026-01-10"}
    ],
    "diagnostics": [
        {"test": "HbA1c (Glycated Hemoglobin)", "value": "7.4 %", "normal_range": "< 5.7 %", "date": "2026-03-12", "facility": "Dr. PathLabs PHC"},
        {"test": "Serum Creatinine", "value": "1.05 mg/dL", "normal_range": "0.7 - 1.3 mg/dL", "date": "2026-03-12", "facility": "Dr. PathLabs PHC"},
        {"test": "Total Cholesterol", "value": "198 mg/dL", "normal_range": "< 200 mg/dL", "date": "2026-01-09", "facility": "District Hospital Lab"}
    ],
    "notes": [
        {"date": "2026-03-24", "doctor": "Dr. S. K. Verma", "clinic": "Primary Health Centre (PHC)", "note": "Type-2 DM routine followup. Advised dietary control."}
    ]
}
PATIENT_RECORD_FILE = BASE_DIR / "patient_record.json"

if PATIENT_RECORD_FILE.is_file():
    saved_record = json.loads(PATIENT_RECORD_FILE.read_text(encoding="utf-8"))
    for record_section in ("allergies", "medications", "diagnostics", "notes"):
        if isinstance(saved_record.get(record_section), list):
            PATIENT_DB[record_section] = saved_record[record_section]

# WebSocket Connection Manager for instant screen lockout
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, consent_id: str, websocket: WebSocket):
        await websocket.accept()
        if consent_id not in self.active_connections:
            self.active_connections[consent_id] = []
        self.active_connections[consent_id].append(websocket)

    def disconnect(self, consent_id: str, websocket: WebSocket):
        if consent_id in self.active_connections:
            if websocket in self.active_connections[consent_id]:
                self.active_connections[consent_id].remove(websocket)

    async def broadcast_revocation(self, consent_id: str):
        if consent_id in self.active_connections:
            for connection in self.active_connections[consent_id]:
                await connection.send_json({
                    "type": "CONSENT_REVOKED",
                    "consent_id": consent_id,
                    "message": "Patient explicitly terminated record access."
                })

manager = ConnectionManager()

# Pydantic models (FastAPI automatically validates data into clean Python objects)
class ScopeModel(BaseModel):
    allergies: bool = True
    meds: bool = True
    labs: bool = True
    notes: bool = False

class ConsentCreateRequest(BaseModel):
    abha_id: str
    scopes: ScopeModel
    duration_minutes: int

class RevokeRequest(BaseModel):
    consent_id: str

class AllergyEntry(BaseModel):
    substance: str
    reaction: str = ""
    severity: str = "MODERATE"

class MedicationEntry(BaseModel):
    drug: str
    dosage: str = ""
    facility: str = ""
    date: str = ""

class DiagnosticEntry(BaseModel):
    test: str
    value: str = ""
    normal_range: str = ""
    date: str = ""
    facility: str = ""

class NoteEntry(BaseModel):
    date: str = ""
    doctor: str = ""
    clinic: str = ""
    note: str

class PatientRecordUpdate(BaseModel):
    allergies: List[AllergyEntry] = Field(default_factory=list)
    medications: List[MedicationEntry] = Field(default_factory=list)
    diagnostics: List[DiagnosticEntry] = Field(default_factory=list)
    notes: List[NoteEntry] = Field(default_factory=list)


@app.get("/api/patient/record")
def read_patient_record():
    return {"success": True, "record": PATIENT_DB}


@app.put("/api/patient/record")
def update_patient_record(req: PatientRecordUpdate):
    record_updates = req.model_dump()
    temporary_file = PATIENT_RECORD_FILE.with_suffix(".tmp")
    try:
        temporary_file.write_text(json.dumps(record_updates, indent=2), encoding="utf-8")
        temporary_file.replace(PATIENT_RECORD_FILE)
    except OSError as error:
        raise HTTPException(status_code=500, detail="Could not save patient record locally.") from error

    PATIENT_DB.update(record_updates)
    return {"success": True, "record": PATIENT_DB}


# 1. Create Dynamic Consent Token
@app.post("/api/consent/create")
def create_consent(req: ConsentCreateRequest):
    consent_id = f"CNS-{uuid.uuid4().hex[:8].upper()}"
    expiry_timestamp = int(time.time()) + (req.duration_minutes * 60)

    token_payload = {
        "consent_id": consent_id,
        "abha_id": req.abha_id,
        "scopes": req.scopes.model_dump(),
        "exp": expiry_timestamp
    }
    
    token = jwt.encode(token_payload, JWT_SECRET, algorithm=ALGORITHM)

    active_consents[consent_id] = {
        "consent_id": consent_id,
        "token": token,
        "abha_id": req.abha_id,
        "scopes": req.scopes.model_dump(),
        "status": "ACTIVE",
        "expires_at": expiry_timestamp
    }

    return {
        "success": True,
        "consent_id": consent_id,
        "token": token,
        "expires_at": expiry_timestamp,
        "qr_payload": token
    }


# 2. Doctor/Provider fetches records using the QR token
@app.get("/api/records/{token}")
def get_records(token: str):
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=403, detail="Consent duration has expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token signature.")

    consent_id = decoded.get("consent_id")
    consent = active_consents.get(consent_id)

    if not consent:
        raise HTTPException(status_code=404, detail="Consent record not found.")

    if consent["status"] == "REVOKED":
        raise HTTPException(status_code=403, detail="Access Denied: Revoked by patient.")

    scopes = consent["scopes"]
    
    # Filter record strictly by patient's choices
    filtered_data = {
        "abha_id": PATIENT_DB["abha_id"],
        "name": PATIENT_DB["name"],
        "age": PATIENT_DB["age"],
        "gender": PATIENT_DB["gender"],
        "blood_group": PATIENT_DB["blood_group"],
        "allergies": PATIENT_DB["allergies"] if scopes.get("allergies") else [],
        "medications": PATIENT_DB["medications"] if scopes.get("meds") else [],
        "diagnostics": PATIENT_DB["diagnostics"] if scopes.get("labs") else [],
        "notes": PATIENT_DB["notes"] if scopes.get("notes") else []
    }

    return {
        "success": True,
        "consent_id": consent_id,
        "scopes_granted": scopes,
        "record": filtered_data
    }


# 3. Patient revokes access
@app.post("/api/consent/revoke")
async def revoke_consent(req: RevokeRequest):
    consent = active_consents.get(req.consent_id)
    if not consent:
        raise HTTPException(status_code=404, detail="Consent not found")

    consent["status"] = "REVOKED"
    
    # Fire real-time lockout event to doctor's browser
    await manager.broadcast_revocation(req.consent_id)

    return {"success": True, "message": "Access revoked successfully."}


# 4. WebSocket route for doctor's phone
@app.websocket("/ws/{consent_id}")
async def websocket_endpoint(websocket: WebSocket, consent_id: str):
    await manager.connect(consent_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(consent_id, websocket)


# Serve frontend assets from the project root without exposing other project files.
@app.get("/static/{filename}")
def serve_static_file(filename: str):
    if filename not in {"style.css", "patient.js", "provider.js"}:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = BASE_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

@app.get("/")
def serve_login():
    return FileResponse(BASE_DIR / "login.html")

@app.get("/patient")
def serve_patient_app():
    return FileResponse(BASE_DIR / "index.html")

@app.get("/doctor")
def serve_doctor_app():
    return FileResponse(BASE_DIR / "index.html")
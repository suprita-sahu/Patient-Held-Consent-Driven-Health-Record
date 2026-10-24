# ArogyaKey: Patient-Held Consent-Driven Health Record System

A privacy-focused electronic health data management architecture designed to return record ownership to patients. ArogyaKey provides a secure mechanism for individuals to hold, manage, and share granular medical data with healthcare providers using time-delimited, consent-backed access tokens.

---

## Executive Summary

Contemporary Electronic Health Record (EHR) systems operate within fragmented provider silos, restricting patient mobility and complicating unified longitudinal care. ArogyaKey addresses these limitations by introducing a patient-directed data access layer. Under this architecture, records are maintained under the patient's sovereign control, with clinical providers receiving strictly scoped, ephemeral access on demand.

---

## Architecture and Core Functionality (MVP Scope)

The Minimum Viable Product establishes the core workflows required for secure, consent-based clinical data exchanges:

* Granular Consent Brokerage: Implements fine-grained access policies allowing patients to authorize visibility into specific record subsets (e.g., diagnostic reports, prescriptions, basic vitals) rather than disclosing full medical histories.
* Ephemeral Access Tokens: Facilitates dynamic session management via backend API token issuance, enforcing automatic session invalidation upon expiration.
* Dual-Portal Interface:
  * Patient Client (patient.js, index.html): Allows the patient to inspect local records, review active access grants, and authorize provider session requests.
  * Provider Client (provider.js): Ingests temporary authorization tokens to retrieve and render permitted health data within clinical consultation windows.
* Standardized Schema Validation: Models health observations, demographics, and clinical notes through a standardized format defined in patient_record.json.

---

## Repository Structure

├── index.html           # Patient dashboard and consent console
├── login.html           # Authentication portal for patient and provider profiles
├── style.css            # System-wide UI layout and typography specifications
├── patient.js           # Client-side consent lifecycle and record presentation logic
├── provider.js          # Provider-side session consumption and record rendering logic
├── patient_record.json  # Mock clinical record store matching data exchange schemas
├── main.py              # FastAPI application handling authorization, routes, and sessions
└── requirements.txt     # Python runtime dependencies

---

## System Requirements & Installation

### Prerequisites
* Python 3.9 or higher
* Modern web browser with ECMAScript 2020+ support

### 1. Repository Setup
git clone https://github.com/suprita-sahu/Patient-Held-Consent-Driven-Health-Record.git
cd Patient-Held-Consent-Driven-Health-Record

### 2. Virtual Environment Configuration
# Windows
python -m venv venv
.\venv\Scripts\activate

# Unix / macOS
python3 -m venv venv
source venv/bin/activate

### 3. Dependency Installation
pip install -r requirements.txt

---

## Execution and Operational Workflow

### 1. Backend Service Launch
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

The OpenAPI specifications and endpoints will be accessible at:
http://127.0.0.1:8000/docs

### 2. Frontend Dispatch
Serve the static client assets through a local HTTP server or open login.html directly in a browser environment:
python -m http.server 3000

### 3. User Procedures

#### Patient Workflow:
1. Access the application via login.html and select the Patient role.
2. Authenticate to enter the main overview (index.html).
3. View existing diagnostic files and clinical entries populated from patient_record.json.
4. Upon a consultation request, generate a time-bound consent grant specifying allowable record categories and validity duration.
5. Provide the generated session credentials to the consulting healthcare professional.

#### Healthcare Provider Workflow:
1. Open login.html and select the Provider role.
2. Submit the patient identifier along with the authorized consent token.
3. Access the read-only clinical view loaded via provider.js.
4. View authorized sections for the duration of the active window; access automatically revokes when the session expires.

---

## Security Model

* Principle of Least Privilege: Data transmission is constrained to explicitly approved sub-resources.
* Time-to-Live (TTL) Enforcement: Authorization tokens carry explicit expiry timestamps to prevent stale session exploits.
* Zero Persistent Third-Party Caching: Records are transferred strictly within direct, authenticated sessions between the patient store and the provider portal.

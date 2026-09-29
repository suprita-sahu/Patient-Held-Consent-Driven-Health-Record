window.patientState = {
  consentId: null,
  token: null
};

let countdownInterval = null;

function clearStoredConsentToken(token) {
  if (localStorage.getItem('activeConsentToken') === token) {
    localStorage.removeItem('activeConsentToken');
  }
}

function addAuditLog(text) {
  const list = document.getElementById('auditLogList');
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  list.prepend(li);
}

const recordEditors = {
  allergies: {
    container: 'allergyRows',
    fields: [
      { key: 'substance', label: 'Substance', placeholder: 'e.g. Penicillin', required: true },
      { key: 'reaction', label: 'Reaction', placeholder: 'e.g. Rash' },
      { key: 'severity', label: 'Severity', type: 'select', options: ['LOW', 'MODERATE', 'HIGH'] }
    ]
  },
  medications: {
    container: 'medicationRows',
    fields: [
      { key: 'drug', label: 'Medicine', placeholder: 'Name and strength', required: true },
      { key: 'dosage', label: 'Dose and schedule', placeholder: 'e.g. 1 tablet twice daily' },
      { key: 'facility', label: 'Prescriber / facility', placeholder: 'Optional' },
      { key: 'date', label: 'Date', type: 'date' }
    ]
  },
  diagnostics: {
    container: 'diagnosticRows',
    fields: [
      { key: 'test', label: 'Test', placeholder: 'e.g. HbA1c', required: true },
      { key: 'value', label: 'Result', placeholder: 'e.g. 7.4%' },
      { key: 'normal_range', label: 'Reference range', placeholder: 'Optional' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'facility', label: 'Facility', placeholder: 'Optional' }
    ]
  },
  notes: {
    container: 'noteRows',
    fields: [
      { key: 'note', label: 'Note', placeholder: 'Visit summary', required: true, multiline: true },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'doctor', label: 'Clinician', placeholder: 'Optional' },
      { key: 'clinic', label: 'Clinic', placeholder: 'Optional' }
    ]
  }
};

function appendRecordRow(category, values = {}) {
  const config = recordEditors[category];
  const row = document.createElement('div');
  row.className = 'record-entry';
  row.dataset.category = category;

  for (const field of config.fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'record-field';
    wrapper.append(document.createTextNode(field.label));

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      for (const option of field.options) {
        const choice = document.createElement('option');
        choice.value = option;
        choice.textContent = option;
        input.append(choice);
      }
    } else if (field.multiline) {
      input = document.createElement('textarea');
      input.rows = 2;
      input.placeholder = field.placeholder;
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      input.placeholder = field.placeholder || '';
    }

    input.dataset.field = field.key;
    input.required = Boolean(field.required);
    input.value = values[field.key] || (field.type === 'select' ? 'MODERATE' : '');
    wrapper.append(input);
    row.append(wrapper);
  }

  const removeButton = document.createElement('button');
  removeButton.className = 'record-remove-btn';
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';
  removeButton.setAttribute('aria-label', `Remove ${category} entry`);
  removeButton.addEventListener('click', () => row.remove());
  row.append(removeButton);
  document.getElementById(config.container).append(row);
}

function renderRecordEditors(record) {
  for (const [category, config] of Object.entries(recordEditors)) {
    const container = document.getElementById(config.container);
    container.replaceChildren();
    for (const entry of record[category] || []) appendRecordRow(category, entry);
    if (!container.childElementCount) appendRecordRow(category);
  }
}

function readRecordRows(category) {
  return [...document.getElementById(recordEditors[category].container).children]
    .map((row) => Object.fromEntries(
      [...row.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input.value.trim()])
    ))
    .filter((entry) => Object.values(entry).some(Boolean));
}

async function loadPatientRecord() {
  const status = document.getElementById('recordSaveStatus');
  try {
    const response = await fetch('/api/patient/record');
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not load patient record.');
    renderRecordEditors(data.record);
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelectorAll('[data-add-record]').forEach((button) => {
  button.addEventListener('click', () => appendRecordRow(button.dataset.addRecord));
});

document.getElementById('savePatientRecordBtn').addEventListener('click', async () => {
  const status = document.getElementById('recordSaveStatus');
  const saveButton = document.getElementById('savePatientRecordBtn');

  for (const [category, config] of Object.entries(recordEditors)) {
    const requiredFields = config.fields.filter((field) => field.required);
    for (const entry of readRecordRows(category)) {
      const missingField = requiredFields.find((field) => !entry[field.key]);
      if (missingField) {
        status.textContent = `Enter ${missingField.label.toLowerCase()} or remove that row.`;
        return;
      }
    }
  }

  const record = Object.fromEntries(Object.keys(recordEditors).map((category) => [category, readRecordRows(category)]));
  saveButton.disabled = true;
  status.textContent = 'Saving record...';

  try {
    const response = await fetch('/api/patient/record', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not save patient record.');
    renderRecordEditors(data.record);
    status.textContent = 'Record saved. These updates will be shared when you grant consent.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

function extractPrescriptionEntries(text) {
  const medicationEntries = [];
  const allergyEntries = [];
  const strengthPattern = /\b\d+(?:\.\d+)?\s?(?:mcg|μg|mg|g|ml|iu|units?)\b/i;
  const instructionPattern = /\b(?:once|twice|thrice|daily|weekly|nightly|morning|evening|after food|before food|with food|(?:\d+\s*)?(?:times?|tabs?|tablets?|caps?|capsules?)|od|bd|bid|tid|qid|sos)\b/i;

  for (const originalLine of text.split(/\r?\n/)) {
    const line = originalLine.replace(/\s+/g, ' ').replace(/^[\s\-•*\d.)]+/, '').trim();
    if (!line) continue;

    const allergyMatch = line.match(/\b(?:allerg(?:y|ies)|allergic to)\b\s*[:\-]?\s*(.+)$/i);
    if (allergyMatch && !/\b(?:none|nil|nka|no known)\b/i.test(allergyMatch[1])) {
      const description = allergyMatch[1].trim();
      const reactionMatch = description.match(/\(([^)]+)\)/);
      allergyEntries.push({
        substance: description.replace(/\([^)]*\)/g, '').trim(),
        reaction: reactionMatch ? reactionMatch[1].trim() : '',
        severity: 'MODERATE'
      });
    }

    const strength = line.match(strengthPattern);
    if (!strength || (!instructionPattern.test(line) && line.length < 12)) continue;
    const name = line.slice(0, strength.index)
      .replace(/^(?:rx|tab(?:let)?|cap(?:sule)?|syrup|inj(?:ection)?)\.?\s*/i, '')
      .trim();
    if (!name) continue;

    const entry = {
      drug: `${name} ${strength[0]}`.trim(),
      dosage: line.slice(strength.index + strength[0].length).trim(),
      facility: '',
      date: ''
    };
    if (!medicationEntries.some((existing) => existing.drug.toLowerCase() === entry.drug.toLowerCase())) {
      medicationEntries.push(entry);
    }
  }

  return { medicationEntries, allergyEntries };
}

async function recognizePrescriptionText(file) {
  if (!window.Tesseract) throw new Error('OCR could not load. Check the internet connection and refresh.');

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    const result = await Tesseract.recognize(file, 'eng');
    return result.data.text;
  }

  if (!window.pdfjsLib) throw new Error('PDF reader could not load. Check the internet connection and refresh.');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 5); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    let pageText = textContent.items.map((item) => item.str).join(' ');
    if (pageText.trim().length < 20) {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pageText = (await Tesseract.recognize(canvas, 'eng')).data.text;
    }
    pages.push(pageText);
  }

  return pages.join('\n');
}

document.getElementById('prescriptionUpload').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = document.getElementById('prescriptionStatus');
  const preview = document.getElementById('prescriptionTextPreview');
  status.textContent = 'Reading prescription on this device...';

  try {
    const text = await recognizePrescriptionText(file);
    preview.textContent = text || 'No text was detected.';
    const extracted = extractPrescriptionEntries(text);
    const medications = readRecordRows('medications');
    const allergies = readRecordRows('allergies');

    for (const entry of extracted.medicationEntries) {
      if (!medications.some((existing) => existing.drug.toLowerCase() === entry.drug.toLowerCase())) {
        medications.push(entry);
      }
    }
    for (const entry of extracted.allergyEntries) {
      if (!allergies.some((existing) => existing.substance.toLowerCase() === entry.substance.toLowerCase())) {
        allergies.push(entry);
      }
    }

    renderRecordEditors({
      allergies,
      medications,
      diagnostics: readRecordRows('diagnostics'),
      notes: readRecordRows('notes')
    });
    status.textContent = extracted.medicationEntries.length || extracted.allergyEntries.length
      ? `Added ${extracted.medicationEntries.length} medication and ${extracted.allergyEntries.length} allergy suggestion(s). Review, then save.`
      : 'Text extracted, but no medicines or allergies were recognized. Review the text and add details manually.';
  } catch (error) {
    status.textContent = error.message || 'Could not read this prescription. Try a clearer image or PDF.';
  } finally {
    event.target.value = '';
  }
});

loadPatientRecord();

document.getElementById('generateQrBtn').addEventListener('click', async () => {
  const scopes = {
    allergies: document.getElementById('scopeAllergies').checked,
    meds: document.getElementById('scopeMeds').checked,
    labs: document.getElementById('scopeLabs').checked,
    notes: document.getElementById('scopeNotes').checked
  };

  const duration = parseInt(document.getElementById('consentDuration').value);

  const res = await fetch('/api/consent/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      abha_id: '91-8472-1049-3829',
      scopes: scopes,
      duration_minutes: duration
    })
  });

  const data = await res.json();
  if (data.success) {
    window.patientState.consentId = data.consent_id;
    window.patientState.token = data.token;
    localStorage.setItem('activeConsentToken', data.token);

    // Render QR
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    const doctorAccessUrl = new URL('/doctor', window.location.origin);
    doctorAccessUrl.hash = new URLSearchParams({ token: data.token }).toString();
    new QRCode(qrContainer, {
      text: doctorAccessUrl.toString(),
      width: 290,
      height: 290,
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById('qrDisplayArea').classList.remove('hidden');
    addAuditLog(`Generated dynamic consent token: ${data.consent_id}`);

    // Timer
    let timeLeft = duration * 60;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
      const secs = (timeLeft % 60).toString().padStart(2, '0');
      document.getElementById('timerDisplay').textContent = `${mins}:${secs}`;
      if (--timeLeft < 0) {
        clearInterval(countdownInterval);
        document.getElementById('qrDisplayArea').classList.add('hidden');
        clearStoredConsentToken(data.token);
        window.patientState.token = null;
      }
    }, 1000);
  }
});

// Explicit Revocation
document.getElementById('revokeBtn').addEventListener('click', async () => {
  if (!window.patientState.consentId) return;

  const res = await fetch('/api/consent/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent_id: window.patientState.consentId })
  });

  const data = await res.json();
  if (data.success) {
    clearInterval(countdownInterval);
    document.getElementById('qrDisplayArea').classList.add('hidden');
    clearStoredConsentToken(window.patientState.token);
    window.patientState.token = null;
    addAuditLog(`⛔ REVOKED access for ${window.patientState.consentId}`);
  }
});
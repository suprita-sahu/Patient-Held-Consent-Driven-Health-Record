let consentSocket = null;
let currentConsentId = null;

const patientDevice = document.getElementById('patientDevice');
const doctorDevice = document.getElementById('doctorDevice');
const scannerView = document.getElementById('scannerView');
const recordsView = document.getElementById('recordsView');
const lockoutOverlay = document.getElementById('lockoutOverlay');
const scanStatus = scannerView.querySelector('p');
const simulateScanBtn = document.getElementById('simulateScanBtn');
const liveScanBtn = document.getElementById('liveScanBtn');
const qrImageInput = document.getElementById('qrImageInput');
const qrScannerReader = document.getElementById('qrScannerReader');
let qrScanner = null;
let scannerRunning = false;
let qrScanInProgress = false;

function setView(view) {
  patientDevice.classList.toggle('hidden', view === 'doctor');
  doctorDevice.classList.toggle('hidden', view === 'patient');

  document.getElementById('showPatientBtn').classList.toggle('active', view === 'patient');
  document.getElementById('showDoctorBtn').classList.toggle('active', view === 'doctor');
  document.getElementById('showSplitBtn').classList.toggle('active', view === 'split');
}

function renderList(elementId, items, formatItem, emptyMessage) {
  const list = document.getElementById(elementId);
  list.replaceChildren();

  if (!items.length) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'data-item';
    emptyItem.textContent = emptyMessage;
    list.append(emptyItem);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'data-item';
    row.textContent = formatItem(item);
    list.append(row);
  }
}

function showRevokedAccess() {
  recordsView.classList.add('hidden');
  scannerView.classList.add('hidden');
  lockoutOverlay.classList.remove('hidden');
  if (consentSocket) {
    consentSocket.close();
    consentSocket = null;
  }
}

function connectToRevocationEvents(consentId) {
  if (consentSocket) consentSocket.close();

  const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  consentSocket = new WebSocket(
    `${socketProtocol}//${window.location.host}/ws/${encodeURIComponent(consentId)}`
  );

  consentSocket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'CONSENT_REVOKED' && message.consent_id === currentConsentId) {
        showRevokedAccess();
      }
    } catch {
      scanStatus.textContent = 'Received an invalid access update.';
    }
  });
}

async function stopLiveScanner() {
  if (qrScanner && scannerRunning) {
    await qrScanner.stop();
    scannerRunning = false;
  }
}

function getConsentToken(qrValue) {
  try {
    const scannedUrl = new URL(qrValue);
    const hashToken = new URLSearchParams(scannedUrl.hash.slice(1)).get('token');
    const queryToken = scannedUrl.searchParams.get('token');
    if (hashToken || queryToken) return hashToken || queryToken;

    const recordPath = scannedUrl.pathname.match(/^\/api\/records\/(.+)$/);
    if (recordPath) return decodeURIComponent(recordPath[1]);
  } catch {
    return qrValue.trim();
  }

  return qrValue.trim();
}

async function processScannedQr(qrValue) {
  const token = getConsentToken(qrValue);
  if (!token) {
    scanStatus.textContent = 'That QR code does not contain a consent token.';
    return;
  }

  await stopLiveScanner();
  qrScannerReader.classList.add('hidden');
  await accessConsent(token);
}

function displayRecords(data) {
  const record = data.record;
  currentConsentId = data.consent_id;

  document.querySelector('.access-banner span').textContent =
    `Patient: ${record.name} (${record.abha_id})`;

  const allergySection = document.getElementById('allergyAlertSection');
  allergySection.classList.toggle('hidden', record.allergies.length === 0);
  renderList('allergyList', record.allergies, (allergy) =>
    `${allergy.substance}: ${allergy.reaction} (${allergy.severity})`, 'No shared allergies');
  renderList('medsList', record.medications, (medication) =>
    `${medication.drug} | ${medication.dosage} | ${medication.facility} | ${medication.date}`,
  'No medications shared');
  renderList('labsList', record.diagnostics, (test) =>
    `${test.test}: ${test.value} (normal ${test.normal_range}) | ${test.facility} | ${test.date}`,
  'No lab results shared');

  scannerView.classList.add('hidden');
  lockoutOverlay.classList.add('hidden');
  recordsView.classList.remove('hidden');
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  connectToRevocationEvents(currentConsentId);
}

document.getElementById('showPatientBtn').addEventListener('click', () => setView('patient'));
document.getElementById('showDoctorBtn').addEventListener('click', () => setView('doctor'));
document.getElementById('showSplitBtn').addEventListener('click', () => setView('split'));

async function accessConsent(token) {
  if (!token) {
    scanStatus.textContent = 'Scan the patient QR with this phone\'s camera.';
    return;
  }

  simulateScanBtn.disabled = true;
  scanStatus.textContent = 'Checking consent...';

  try {
    const response = await fetch(`/api/records/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not access patient records.');
    displayRecords(data);
  } catch (error) {
    scanStatus.textContent = error.message || 'Could not connect to the records service.';
  } finally {
    simulateScanBtn.disabled = false;
  }
}

simulateScanBtn.addEventListener('click', () => {
  const token = window.patientState?.token || localStorage.getItem('activeConsentToken');
  accessConsent(token);
});

liveScanBtn.addEventListener('click', async () => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    scanStatus.textContent = 'Live camera needs HTTPS. Use Open camera or QR photo on this local HTTP address.';
    return;
  }
  if (!window.Html5Qrcode) {
    scanStatus.textContent = 'The QR scanner could not load. Check the internet connection and refresh.';
    return;
  }

  liveScanBtn.disabled = true;
  qrScannerReader.classList.remove('hidden');
  qrScanner = qrScanner || new Html5Qrcode('qrScannerReader');

  try {
    await qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (qrValue) => {
        if (qrScanInProgress) return;
        qrScanInProgress = true;
        processScannedQr(qrValue).finally(() => { qrScanInProgress = false; });
      },
      () => {}
    );
    scannerRunning = true;
    scanStatus.textContent = 'Camera active. Hold the QR code inside the frame.';
  } catch (error) {
    qrScannerReader.classList.add('hidden');
    scanStatus.textContent = `Camera unavailable: ${error.message || 'permission denied'}. Use Open camera or QR photo.`;
  } finally {
    liveScanBtn.disabled = false;
  }
});

qrImageInput.addEventListener('change', async () => {
  const image = qrImageInput.files?.[0];
  if (!image) return;
  if (!window.Html5Qrcode) {
    scanStatus.textContent = 'The QR scanner could not load. Check the internet connection and refresh.';
    qrImageInput.value = '';
    return;
  }

  try {
    await stopLiveScanner();
    scanStatus.textContent = 'Reading the QR image...';
    qrScanner = qrScanner || new Html5Qrcode('qrScannerReader');
    const qrValue = await qrScanner.scanFile(image, false);
    await processScannedQr(qrValue);
  } catch {
    scanStatus.textContent = 'html5-qrcode could not read that image. Retake it with the full QR in focus, or scan the QR using the phone Camera app.';
  } finally {
    qrImageInput.value = '';
  }
});

document.getElementById('returnToScanBtn').addEventListener('click', () => {
  if (consentSocket) {
    consentSocket.close();
    consentSocket = null;
  }
  currentConsentId = null;
  lockoutOverlay.classList.add('hidden');
  recordsView.classList.add('hidden');
  scannerView.classList.remove('hidden');
  scanStatus.textContent = 'Scan the patient\'s QR code to open their shared record.';
});

const role = window.location.pathname.slice(1);
if (role === 'patient' || role === 'doctor') {
  setView(role);
  document.querySelector('.view-switcher').classList.add('hidden');
  document.getElementById('logoutLink').classList.remove('hidden');
  document.title = role === 'patient' ? 'Patient Portal' : 'Doctor Portal';
} else {
  setView('split');
}

if (role === 'doctor') {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) accessConsent(token);
}
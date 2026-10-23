/** Servidor de acceso ASDAL. Desplegar como aplicación web mediante clasp o Apps Script. */
const SESSION_SECONDS = 60 * 60 * 8;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Login')
    .setTitle('ASDAL | Permisos y compensatorios')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

function login(documentNumber, pin) {
  const normalizedDocument = String(documentNumber || '').replace(/\D/g, '');
  if (!/^\d{5,15}$/.test(normalizedDocument) || !/^\d{4,12}$/.test(String(pin || ''))) {
    return { ok: false, message: 'Documento o PIN inválido.' };
  }
  const user = findUser_(normalizedDocument);
  if (!user || !user.active || !verifyPin_(String(pin), user.salt, user.pinHash)) {
    registerAttempt_(normalizedDocument);
    return { ok: false, message: 'Documento o PIN inválido.' };
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, JSON.stringify({ document: user.document, name: user.name, role: user.role }), SESSION_SECONDS);
  return { ok: true, token: token, mustChangePin: user.mustChangePin, user: { name: user.name, role: user.role } };
}

function getSession(token) {
  const raw = CacheService.getScriptCache().get('session:' + token);
  return raw ? { ok: true, user: JSON.parse(raw) } : { ok: false };
}

function logout(token) { CacheService.getScriptCache().remove('session:' + token); return { ok: true }; }

function findUser_(documentNumber) {
  const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName('Usuarios');
  if (!sheet) throw new Error('No existe la hoja Usuarios.');
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows.shift();
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = rows.find(values => values[index.Documento] === documentNumber);
  if (!row) return null;
  return { document: row[index.Documento], name: row[index.Nombre], role: row[index.Rol], pinHash: row[index.PIN_HASH], salt: row[index.PIN_SALT], active: String(row[index.Activo]).toLowerCase() === 'si', mustChangePin: String(row[index.CAMBIAR_PIN]).toLowerCase() === 'si' };
}

function verifyPin_(pin, salt, expectedHash) { return hashPin_(pin, salt) === expectedHash; }
function hashPin_(pin, salt) {
  let value = String(salt) + ':' + String(pin);
  for (let i = 0; i < 50000; i++) value = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
  return value;
}
function registerAttempt_(documentNumber) { CacheService.getScriptCache().put('attempt:' + documentNumber, String(Date.now()), 60); }
function getSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Falta configurar SPREADSHEET_ID en Propiedades del script.');
  return id;
}

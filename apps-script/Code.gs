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

/** Lee únicamente las disponibilidades cuyo campo Observaciones está vacío. */
function getPendingAvailabilities(token) {
  requireAdministrator_(token);
  const source = getAvailabilitySheet_();
  const range = source.getDataRange();
  const display = range.getDisplayValues();
  const columns = columnMap_(display.shift());
  const imported = getImportedSourceKeys_();
  return display.map((row, index) => {
    const sourceKey = sourceKey_(row, columns);
    return {
      sourceKey: sourceKey,
      sourceRow: index + 2,
      timestamp: row[columns['Marca temporal']],
      document: row[columns['Escriba su documento de identidad']],
      employee: row[columns.Colaborador],
      availabilityStart: row[columns['Fecha Inicio Disponibilidad']],
      availabilityEnd: row[columns['Fecha Fin Disponibilidad']],
      historicalSuggestedDate: row[columns['Fecha para disfrute compensatorio']],
      alreadyImported: imported.has(sourceKey),
      pending: !String(row[columns.Observaciones] || '').trim()
    };
  }).filter(item => item.pending && !item.alreadyImported);
}

/** Crea compensatorios sin modificar la pestaña histórica de respuestas. */
function importPendingAvailabilities(token, sourceKeys) {
  requireAdministrator_(token);
  const requested = new Set((sourceKeys || []).map(String));
  const selected = getPendingAvailabilities(token).filter(item => requested.has(item.sourceKey));
  if (!selected.length) return { ok: true, imported: 0 };
  const destination = getCompensationsSheet_();
  const rows = selected.map(item => [Utilities.getUuid(), item.sourceKey, item.sourceRow, item.document, item.employee, item.availabilityStart, item.availabilityEnd, item.historicalSuggestedDate, '', 'Pendiente de aprobación', '', '', new Date()]);
  destination.getRange(destination.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true, imported: rows.length };
}

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

function requireAdministrator_(token) {
  const session = getSession(token);
  if (!session.ok || !['Administrador', 'Junta directiva'].includes(session.user.role)) throw new Error('No autorizado.');
  return session.user;
}

function getAvailabilitySheet_() {
  const name = PropertiesService.getScriptProperties().getProperty('AVAILABILITY_SHEET_NAME') || 'Respuestas de formulario 1';
  const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja de disponibilidades configurada.');
  return sheet;
}

function getCompensationsSheet_() {
  const book = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = book.getSheetByName('Compensatorios');
  if (sheet) return sheet;
  sheet = book.insertSheet('Compensatorios');
  sheet.appendRow(['ID', 'CLAVE_ORIGEN', 'FILA_ORIGEN', 'DOCUMENTO', 'COLABORADOR', 'INICIO_DISPONIBILIDAD', 'FIN_DISPONIBILIDAD', 'FECHA_HISTORICA', 'FECHA_AUTORIZADA', 'ESTADO', 'MOTIVO', 'APROBADO_POR', 'FECHA_REGISTRO']);
  sheet.setFrozenRows(1);
  return sheet;
}

function getImportedSourceKeys_() {
  const sheet = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName('Compensatorios');
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  return new Set(sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues().flat().filter(Boolean));
}

function columnMap_(headers) {
  const required = ['Marca temporal', 'Escriba su documento de identidad', 'Colaborador', 'Fecha Inicio Disponibilidad', 'Fecha Fin Disponibilidad', 'Fecha para disfrute compensatorio', 'Observaciones'];
  const map = Object.fromEntries(headers.map((name, index) => [String(name).trim(), index]));
  required.forEach(name => { if (map[name] === undefined) throw new Error('Falta la columna requerida: ' + name); });
  return map;
}

function sourceKey_(row, columns) {
  return [row[columns['Marca temporal']], row[columns['Escriba su documento de identidad']], row[columns['Fecha Inicio Disponibilidad']], row[columns['Fecha Fin Disponibilidad']]].map(value => String(value).trim()).join('|');
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

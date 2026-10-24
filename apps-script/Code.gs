/** Servidor de acceso ASDAL. Desplegar como aplicación web mediante clasp o Apps Script. */
const SESSION_SECONDS = 60 * 60 * 8;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Login')
    .setTitle('ASDAL | Permisos y compensatorios')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

function startLogin(documentNumber) {
  const normalizedDocument = String(documentNumber || '').replace(/\D/g, '');
  if (!/^\d{5,15}$/.test(normalizedDocument)) {
    return { ok: false, message: 'Documento no autorizado.' };
  }
  const user = findUser_(normalizedDocument);
  if (!user || !user.active) {
    registerAttempt_(normalizedDocument);
    return { ok: false, message: 'Documento no autorizado.' };
  }
  if (isAdministrator_(user)) return { ok: false, requiresPin: true, message: 'Ingresa el PIN de administrador.' };
  return createSession_(user);
}

function loginAdministrator(documentNumber, pin) {
  const user = findUser_(String(documentNumber || '').replace(/\D/g, ''));
  if (!user || !user.active || !isAdministrator_(user) || !/^\d{4,12}$/.test(String(pin || '')) || !verifyPin_(String(pin), user.salt, user.pinHash)) {
    registerAttempt_(String(documentNumber || ''));
    return { ok: false, message: 'Documento o PIN inválido.' };
  }
  return createSession_(user);
}

/**
 * Ejecutar una sola vez, desde el editor de Apps Script y antes del despliegue.
 * Luego deja de funcionar en cuanto existe el primer usuario.
 */
function bootstrapInitialAdministrator() {
  const sheet = getUsersSheet_();
  if (sheet.getLastRow() > 1) throw new Error('Ya existe al menos un usuario. Use la administración normal.');
  const properties = PropertiesService.getScriptProperties();
  const documentNumber = properties.getProperty('INITIAL_ADMIN_DOCUMENT');
  const name = properties.getProperty('INITIAL_ADMIN_NAME');
  const pin = properties.getProperty('INITIAL_ADMIN_PIN');
  const document = String(documentNumber || '').replace(/\D/g, '');
  const cleanName = String(name || '').trim().toUpperCase();
  if (!/^\d{5,15}$/.test(document) || cleanName.length < 3 || !/^\d{4,12}$/.test(String(pin || ''))) throw new Error('Datos iniciales inválidos.');
  const salt = Utilities.getUuid();
  sheet.appendRow([document, cleanName, 'Administrador', hashPin_(String(pin), salt), salt, 'Si', 'No']);
  properties.deleteProperty('INITIAL_ADMIN_DOCUMENT');
  properties.deleteProperty('INITIAL_ADMIN_NAME');
  properties.deleteProperty('INITIAL_ADMIN_PIN');
  return 'Administrador inicial creado.';
}

/**
 * Asigna un PIN protegido a un administrador existente que aún no tiene PIN.
 * Configure ADMIN_SETUP_DOCUMENT y ADMIN_SETUP_PIN como propiedades temporales
 * y ejecútela desde el editor de Apps Script. No altera nombres, roles ni estado.
 */
function initializeExistingAdministratorPin() {
  const properties = PropertiesService.getScriptProperties();
  const documentNumber = String(properties.getProperty('ADMIN_SETUP_DOCUMENT') || '').replace(/\D/g, '');
  const pin = String(properties.getProperty('ADMIN_SETUP_PIN') || '');
  if (!/^\d{5,15}$/.test(documentNumber) || !/^\d{4,12}$/.test(pin)) throw new Error('Configure ADMIN_SETUP_DOCUMENT y ADMIN_SETUP_PIN antes de ejecutar.');
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getDisplayValues();
  const columns = columnMapForUsers_(rows.shift());
  const rowOffset = rows.findIndex(row => row[columns.Documento] === documentNumber);
  if (rowOffset < 0) throw new Error('El documento no está registrado en Usuarios.');
  const row = rows[rowOffset];
  if (!isAdministrator_({ role: row[columns.Rol] })) throw new Error('El usuario indicado no tiene rol Administrador.');
  if (String(row[columns.PIN_HASH] || '').trim()) throw new Error('Este administrador ya tiene un PIN configurado.');
  const salt = Utilities.getUuid();
  const rowNumber = rowOffset + 2;
  sheet.getRange(rowNumber, columns.PIN_HASH + 1).setValue(hashPin_(pin, salt));
  sheet.getRange(rowNumber, columns.PIN_SALT + 1).setValue(salt);
  sheet.getRange(rowNumber, columns.CAMBIAR_PIN + 1).setValue('No');
  properties.deleteProperty('ADMIN_SETUP_DOCUMENT');
  properties.deleteProperty('ADMIN_SETUP_PIN');
  return 'PIN de administrador configurado.';
}

function getSession(token) {
  const raw = CacheService.getScriptCache().get('session:' + token);
  return raw ? { ok: true, user: JSON.parse(raw) } : { ok: false };
}

function logout(token) { CacheService.getScriptCache().remove('session:' + token); return { ok: true }; }

function listUsers(token) {
  requireAdministrator_(token);
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getDisplayValues();
  const index = columnMapForUsers_(rows.shift());
  return rows.filter(row => row[index.Documento]).map(row => ({ document: row[index.Documento], name: row[index.Nombre], role: row[index.Rol], active: String(row[index.Activo]).toLowerCase() === 'si' }));
}

/** Crea un usuario autorizado. Si es administrador, devuelve un PIN temporal una sola vez. */
function createUser(token, documentNumber, name, role) {
  requireAdministrator_(token);
  const document = String(documentNumber || '').replace(/\D/g, '');
  const cleanName = String(name || '').trim().toUpperCase();
  if (!/^\d{5,15}$/.test(document) || cleanName.length < 3 || !['Colaborador', 'Administrador'].includes(role)) throw new Error('Datos de usuario inválidos.');
  const sheet = getUsersSheet_();
  const users = listUsers(token);
  if (users.some(user => user.document === document)) throw new Error('El documento ya está registrado.');
  const temporaryPin = role === 'Administrador' ? generatePin_() : '';
  const salt = role === 'Administrador' ? Utilities.getUuid() : '';
  sheet.appendRow([document, cleanName, role, role === 'Administrador' ? hashPin_(temporaryPin, salt) : '', salt, 'Si', role === 'Administrador' ? 'Si' : 'No']);
  return { ok: true, temporaryPin: temporaryPin };
}

function setUserActive(token, documentNumber, active) {
  requireAdministrator_(token);
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getDisplayValues();
  const index = columnMapForUsers_(rows.shift());
  const rowIndex = rows.findIndex(row => row[index.Documento] === String(documentNumber));
  if (rowIndex < 0) throw new Error('Usuario no encontrado.');
  sheet.getRange(rowIndex + 2, index.Activo + 1).setValue(active ? 'Si' : 'No');
  return { ok: true };
}

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
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows.shift();
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const row = rows.find(values => values[index.Documento] === documentNumber);
  if (!row) return null;
  return { document: row[index.Documento], name: row[index.Nombre], role: row[index.Rol], pinHash: row[index.PIN_HASH], salt: row[index.PIN_SALT], active: String(row[index.Activo]).toLowerCase() === 'si', mustChangePin: String(row[index.CAMBIAR_PIN]).toLowerCase() === 'si' };
}

function createSession_(user) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, JSON.stringify({ document: user.document, name: user.name, role: user.role }), SESSION_SECONDS);
  return { ok: true, token: token, mustChangePin: user.mustChangePin, user: { name: user.name, role: user.role } };
}

function isAdministrator_(user) { return ['Administrador', 'Junta directiva'].includes(user.role); }

function getUsersSheet_() {
  const book = SpreadsheetApp.openById(getSpreadsheetId_());
  let sheet = book.getSheetByName('Usuarios');
  if (sheet) return sheet;
  sheet = book.insertSheet('Usuarios');
  sheet.appendRow(['Documento', 'Nombre', 'Rol', 'PIN_HASH', 'PIN_SALT', 'Activo', 'CAMBIAR_PIN']);
  sheet.setFrozenRows(1);
  return sheet;
}

function columnMapForUsers_(headers) {
  const required = ['Documento', 'Nombre', 'Rol', 'PIN_HASH', 'PIN_SALT', 'Activo', 'CAMBIAR_PIN'];
  const map = Object.fromEntries(headers.map((name, index) => [String(name).trim(), index]));
  required.forEach(name => { if (map[name] === undefined) throw new Error('Falta la columna requerida: ' + name); });
  return map;
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
function generatePin_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/\D/g, '').slice(0, 6); }
function registerAttempt_(documentNumber) { CacheService.getScriptCache().put('attempt:' + documentNumber, String(Date.now()), 60); }
function getSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Falta configurar SPREADSHEET_ID en Propiedades del script.');
  return id;
}

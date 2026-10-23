# Acceso por documento y PIN

Este backend usa la hoja `Usuarios` dentro del libro configurado en la propiedad de script `SPREADSHEET_ID`.

Encabezados requeridos: `Documento`, `Nombre`, `Rol`, `PIN_HASH`, `PIN_SALT`, `Activo`, `CAMBIAR_PIN`.

No suba PINs, hashes, claves ni el identificador de la hoja al repositorio. La administradora debe crear cada usuario y asignarle un PIN temporal por un medio presencial o telefónico validado. El despliegue inicial se realiza como Aplicación web desde Google Apps Script. Antes de activarlo para usuarios se debe completar el límite de intentos, cambio de PIN y las pantallas de sesión de la aplicación.

## Migración de disponibilidades pendientes

`getPendingAvailabilities(token)` solo lee filas de `Respuestas de formulario 1` cuya columna `Observaciones` esté vacía. `importPendingAvailabilities(token, sourceKeys)` crea registros en `Compensatorios` y nunca escribe en la pestaña histórica. La columna `CLAVE_ORIGEN` impide importar dos veces la misma disponibilidad.

Solo pueden importar usuarios con rol `Administrador` o `Junta directiva`. Cada registro nuevo inicia con estado `Pendiente de aprobación`.

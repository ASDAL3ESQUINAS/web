# Acceso por documento y PIN

Este backend usa la hoja `Usuarios` dentro del libro configurado en la propiedad de script `SPREADSHEET_ID`.

Encabezados requeridos: `Documento`, `Nombre`, `Rol`, `PIN_HASH`, `PIN_SALT`, `Activo`, `CAMBIAR_PIN`.

No suba PINs, hashes, claves ni el identificador de la hoja al repositorio. La administradora debe crear cada usuario y asignarle un PIN temporal por un medio presencial o telefónico validado. El despliegue inicial se realiza como Aplicación web desde Google Apps Script. Antes de activarlo para usuarios se debe completar el límite de intentos, cambio de PIN y las pantallas de sesión de la aplicación.

## Migración de disponibilidades pendientes

`getPendingAvailabilities(token)` solo lee filas de `Respuestas de formulario 1` cuya columna `Observaciones` esté vacía. `importPendingAvailabilities(token, sourceKeys)` crea registros en `Compensatorios` y nunca escribe en la pestaña histórica. La columna `CLAVE_ORIGEN` impide importar dos veces la misma disponibilidad.

Solo pueden importar usuarios con rol `Administrador` o `Junta directiva`. Cada registro nuevo inicia con estado `Pendiente de aprobación`.

## Activación inicial

1. Cree un proyecto Apps Script vinculado a la hoja y copie los archivos de esta carpeta.
2. En **Configuración del proyecto → Propiedades de secuencia de comandos**, agregue `SPREADSHEET_ID` con el ID de la hoja.
3. Agregue temporalmente tres propiedades: `INITIAL_ADMIN_DOCUMENT`, `INITIAL_ADMIN_NAME` y `INITIAL_ADMIN_PIN`. Elija un PIN de 4 a 12 dígitos. Desde el editor, ejecute una única vez `bootstrapInitialAdministrator`. La función elimina esas tres propiedades al terminar y se bloquea automáticamente cuando ya existe un usuario.
4. Despliegue la aplicación web para que se ejecute como usted y entregue la URL `/exec` a los usuarios.

## PIN para administradores existentes

Para cada administrador que ya esté en `Usuarios`, agregue temporalmente `ADMIN_SETUP_DOCUMENT` y `ADMIN_SETUP_PIN` en las propiedades del script. Ejecute `initializeExistingAdministratorPin` desde el editor. La función solo admite documentos con rol `Administrador`, no modifica las demás columnas y borra las dos propiedades al terminar. Repita el proceso para el segundo administrador.

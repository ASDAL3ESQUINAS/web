const form = document.getElementById('loginForm');
const message = document.getElementById('message');
form.addEventListener('submit', event => {
  event.preventDefault();
  message.textContent = '';
  const documentNumber = form.document.value.trim();
  const pin = form.pin.value;
  const needsPin = !document.getElementById('pinField').hidden;
  if (!/^\d{5,15}$/.test(documentNumber) || (needsPin && !/^\d{4,12}$/.test(pin))) {
    message.textContent = 'Revisa los datos ingresados.';
    return;
  }
  if (!window.google?.script?.run) {
    message.textContent = 'El acceso aún debe activarse en Google Apps Script. Administración debe completar la configuración.';
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  const handleResult = result => {
    button.disabled = false;
    if (result.requiresPin) { document.getElementById('pinField').hidden = false; document.getElementById('pin').required = true; message.textContent = result.message; return; }
    if (!result.ok) { message.textContent = result.message; return; }
    sessionStorage.setItem('asdalSession', result.token);
    window.location.href = result.mustChangePin ? '?view=change-pin' : '?view=app';
  };
  const request = google.script.run.withSuccessHandler(handleResult).withFailureHandler(() => { message.textContent = 'No fue posible ingresar. Intenta nuevamente.'; button.disabled = false; });
  if (needsPin) request.loginAdministrator(documentNumber, pin); else request.startLogin(documentNumber);
});

const form = document.getElementById('loginForm');
const message = document.getElementById('message');
form.addEventListener('submit', event => {
  event.preventDefault();
  message.textContent = '';
  const documentNumber = form.document.value.trim();
  const pin = form.pin.value;
  if (!/^\d{5,15}$/.test(documentNumber) || !/^\d{4,12}$/.test(pin)) {
    message.textContent = 'Revisa el documento y el PIN ingresados.';
    return;
  }
  if (!window.google?.script?.run) {
    message.textContent = 'El acceso aún debe activarse en Google Apps Script. Administración debe completar la configuración.';
    return;
  }
  form.querySelector('button').disabled = true;
  google.script.run
    .withSuccessHandler(result => {
      if (!result.ok) { message.textContent = result.message; form.querySelector('button').disabled = false; return; }
      sessionStorage.setItem('asdalSession', result.token);
      window.location.href = result.mustChangePin ? '?view=change-pin' : '?view=app';
    })
    .withFailureHandler(() => { message.textContent = 'No fue posible ingresar. Intenta nuevamente.'; form.querySelector('button').disabled = false; })
    .login(documentNumber, pin);
});

(function () {
  "use strict";

  const api = window.LifeLink;
  const form = document.getElementById("reset-password-form");
  const message = document.getElementById("reset-password-message");
  const loginLink = document.getElementById("reset-login-link");
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");

  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    api.setFormMessage(message, "This password reset link is invalid or has expired. Request a new link.", "error");
    form.querySelector('[type="submit"]').disabled = true;
    return;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(message, "");
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    const password = values.get("password");
    if (password !== values.get("confirmPassword")) {
      api.setFormMessage(message, "The passwords do not match.", "error");
      document.getElementById("confirm-password").focus();
      return;
    }

    api.setBusy(form, true, "Resetting…");
    try {
      const result = await api.request("/auth/reset-password", {
        method: "POST",
        body: { token: token, password: password },
        redirectOn401: false
      });
      form.hidden = true;
      loginLink.hidden = false;
      api.clearSession();
      api.setFormMessage(message, result.message || "Password reset. Sign in with your new password.", "success");
    } catch (error) {
      api.setFormMessage(message, error.message || "Password reset failed. Request a new link.", "error");
      api.setBusy(form, false);
    }
  });
})();

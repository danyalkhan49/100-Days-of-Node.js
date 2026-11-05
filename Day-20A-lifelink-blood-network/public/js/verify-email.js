(function () {
  "use strict";

  const api = window.LifeLink;
  const message = document.getElementById("verification-message");
  const login = document.getElementById("verification-login");
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    api.setNotice(message, "This verification link is invalid or has expired. Request a new link from the sign-in page.", "error");
    return;
  }

  api.request("/auth/verify-email", {
    method: "POST",
    body: { token: token },
    redirectOn401: false
  }).then(function (result) {
    api.setNotice(message, result.message || "Email verified successfully.", "success");
    login.hidden = false;
  }).catch(function (error) {
    api.setNotice(message, error.message || "Email verification failed. Request a new link.", "error");
  });
})();

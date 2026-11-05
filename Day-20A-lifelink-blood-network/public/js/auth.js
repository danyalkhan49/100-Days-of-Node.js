(function () {
  "use strict";

  const api = window.LifeLink;
  const loginForm = document.getElementById("login-form");
  if (!loginForm) return;

  const forgotPasswordForm = document.getElementById("forgot-password-form");
  const forgotPasswordMessage = document.getElementById("forgot-password-message");
  const loginMessage = document.getElementById("login-message");
  const signupForm = document.getElementById("signup-form");
  const signupMessage = document.getElementById("signup-message");
  const resendVerificationForm = document.getElementById("resend-verification-form");
  const resendVerificationMessage = document.getElementById("resend-verification-message");
  const roleSelect = document.getElementById("signup-role");
  const bloodGroupField = document.getElementById("signup-blood-group-field");
  const bloodGroupSelect = document.getElementById("signup-blood-group");
  const tabs = [
    { button: document.getElementById("tab-login"), panel: document.getElementById("panel-login") },
    { button: document.getElementById("tab-signup"), panel: document.getElementById("panel-signup") }
  ];

  function showTab(index) {
    tabs.forEach(function (tab, tabIndex) {
      const active = tabIndex === index;
      tab.button.classList.toggle("is-active", active);
      tab.button.setAttribute("aria-selected", String(active));
      tab.panel.hidden = !active;
    });
  }

  tabs.forEach(function (tab, index) {
    tab.button.addEventListener("click", function () { showTab(index); });
    tab.button.addEventListener("keydown", function (event) {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex !== index) {
        event.preventDefault();
        showTab(nextIndex);
        tabs[nextIndex].button.focus();
      }
    });
  });

  function updateDonorFields() {
    const isDonor = roleSelect.value === "donor";
    bloodGroupField.hidden = !isDonor;
    bloodGroupSelect.required = isDonor;
  }
  roleSelect.addEventListener("change", updateDonorFields);
  updateDonorFields();

  const flash = sessionStorage.getItem("lifelink_flash");
  if (flash) {
    api.setFormMessage(loginMessage, flash, "info");
    sessionStorage.removeItem("lifelink_flash");
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("access") === "denied") api.setFormMessage(loginMessage, "That workspace is not available for this account.", "error");

  document.getElementById("show-forgot-password").addEventListener("click", function () {
    loginForm.hidden = true;
    forgotPasswordForm.hidden = false;
    document.getElementById("forgot-password-email").value = document.getElementById("login-email").value;
    api.setFormMessage(forgotPasswordMessage, "");
    document.getElementById("forgot-password-email").focus();
  });

  document.getElementById("back-to-login").addEventListener("click", function () {
    forgotPasswordForm.hidden = true;
    loginForm.hidden = false;
    document.getElementById("login-email").focus();
  });

  document.getElementById("show-resend-verification").addEventListener("click", function () {
    loginForm.hidden = true;
    forgotPasswordForm.hidden = true;
    resendVerificationForm.hidden = false;
    document.getElementById("resend-verification-email").value = document.getElementById("login-email").value;
    api.setFormMessage(resendVerificationMessage, "");
    document.getElementById("resend-verification-email").focus();
  });

  document.getElementById("verification-back-to-login").addEventListener("click", function () {
    resendVerificationForm.hidden = true;
    loginForm.hidden = false;
    document.getElementById("login-email").focus();
  });

  resendVerificationForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(resendVerificationMessage, "");
    if (!resendVerificationForm.reportValidity()) return;
    const email = String(new FormData(resendVerificationForm).get("email")).trim();
    api.setBusy(resendVerificationForm, true, "Sending…");
    try {
      const result = await api.request("/auth/resend-verification", {
        method: "POST",
        body: { email },
        redirectOn401: false
      });
      api.setFormMessage(resendVerificationMessage, result.message || "If an active unverified account matches that email, a verification link has been sent.", "success");
    } catch (error) {
      api.setFormMessage(resendVerificationMessage, error.message || "The verification email could not be sent.", "error");
    } finally {
      api.setBusy(resendVerificationForm, false);
    }
  });

  forgotPasswordForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(forgotPasswordMessage, "");
    if (!forgotPasswordForm.reportValidity()) return;

    const email = new FormData(forgotPasswordForm).get("email").trim();
    api.setBusy(forgotPasswordForm, true, "Sending…");
    try {
      const result = await api.request("/auth/forgot-password", {
        method: "POST",
        body: { email },
        redirectOn401: false
      });
      api.setFormMessage(
        forgotPasswordMessage,
        result.message || "If an active account matches, we will email a secure reset link.",
        "success"
      );
    } catch (error) {
      api.setFormMessage(forgotPasswordMessage, error.message || "The reset email could not be sent.", "error");
    } finally {
      api.setBusy(forgotPasswordForm, false);
    }
  });

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(loginMessage, "");
    if (!loginForm.reportValidity()) return;

    const formData = new FormData(loginForm);
    api.setBusy(loginForm, true, "Signing in…");
    try {
      const result = await api.request("/auth/login", {
        method: "POST",
        body: { email: formData.get("email").trim(), password: formData.get("password") },
        redirectOn401: false
      });
      if (!result.token || !result.role) throw new Error("The server response did not include a session token and role.");
      api.saveSession(result.token, result.role, result.name);
      window.location.assign(api.destination(result.role));
    } catch (error) {
      api.setFormMessage(loginMessage, error.message || "Sign in failed. Please try again.", "error");
    } finally {
      api.setBusy(loginForm, false);
    }
  });

  signupForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(signupMessage, "");
    if (!signupForm.reportValidity()) return;

    const formData = new FormData(signupForm);
    const body = {
      name: formData.get("name").trim(),
      email: formData.get("email").trim(),
      password: formData.get("password"),
      phone: formData.get("phone").trim(),
      city: formData.get("city").trim(),
      role: formData.get("role"),
      acceptTerms: formData.get("acceptTerms") === "on"
    };
    if (body.role === "donor") body.bloodGroup = formData.get("bloodGroup");

    api.setBusy(signupForm, true, "Creating account…");
    try {
      await api.request("/auth/signup", { method: "POST", body: body, redirectOn401: false });
      signupForm.reset();
      updateDonorFields();
      showTab(0);
      api.setFormMessage(loginMessage, "Account created. Check your email and verify it before continuing.", "success");
      document.getElementById("login-email").value = body.email;
      document.getElementById("account").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      api.setFormMessage(signupMessage, error.message || "Account creation failed. Please try again.", "error");
    } finally {
      api.setBusy(signupForm, false);
    }
  });
})();
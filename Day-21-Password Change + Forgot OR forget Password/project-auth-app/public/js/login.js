const form = document.getElementById("login-form");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");
const submitLabel = submitButton.querySelector(".button-label");

// A saved session should go straight to the protected dashboard.
if (localStorage.getItem("token")) {
  window.location.replace("/dashboard");
}

// Show feedback as text so API-provided messages are never interpreted as HTML.
function showMessage(text, kind) {
  message.textContent = text;
  message.className = `message is-visible is-${kind}`;
}

// Allow users to reveal or conceal their password without changing the form value.
document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    toggle.textContent = shouldShow ? "Hide" : "Show";
    toggle.setAttribute("aria-label", `${shouldShow ? "Hide" : "Show"} password`);
    toggle.setAttribute("aria-pressed", String(shouldShow));
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";

  if (!form.reportValidity()) {
    return;
  }

  // Disable repeat submissions while the login request is in flight.
  submitButton.disabled = true;
  submitLabel.textContent = "Please wait...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      })
    });
    const data = await response.json();

    if (response.status === 200 && data.success === true && data.token) {
      localStorage.setItem("token", data.token);
      window.location.href = "/dashboard";
      return;
    }

    showMessage(data.error || "Login failed. Please check your details and try again.", "error");
  } catch {
    showMessage("Server not reachable", "error");
  }

  submitButton.disabled = false;
  submitLabel.textContent = "Sign in";
});

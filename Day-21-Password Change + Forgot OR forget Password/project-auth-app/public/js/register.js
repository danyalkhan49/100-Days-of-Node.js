const form = document.getElementById("register-form");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");
const submitLabel = submitButton.querySelector(".button-label");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");

// Show feedback as text so API-provided messages are never interpreted as HTML.
function showMessage(text, kind) {
  message.textContent = text;
  message.className = `message is-visible is-${kind}`;
}

// Keep password visibility controls accessible and independent for each field.
document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    toggle.textContent = shouldShow ? "Hide" : "Show";
    toggle.setAttribute("aria-label", `${shouldShow ? "Hide" : "Show"} ${input.id === "password" ? "password" : "confirm password"}`);
    toggle.setAttribute("aria-pressed", String(shouldShow));
  });
});

confirmPasswordInput.addEventListener("input", () => {
  confirmPasswordInput.setCustomValidity("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  confirmPasswordInput.setCustomValidity("");

  if (!nameInput.value.trim()) {
    nameInput.setCustomValidity("Please enter your name.");
    nameInput.reportValidity();
    nameInput.setCustomValidity("");
    return;
  }

  if (passwordInput.value !== confirmPasswordInput.value) {
    confirmPasswordInput.setCustomValidity("Passwords do not match.");
    confirmPasswordInput.reportValidity();
    confirmPasswordInput.setCustomValidity("");
    return;
  }

  if (!form.reportValidity()) {
    return;
  }

  // Disable repeat submissions while the registration request is in flight.
  submitButton.disabled = true;
  submitLabel.textContent = "Please wait...";

  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });
    const data = await response.json();

    if (response.status === 201 && data.success === true) {
      showMessage(data.message || "Account created successfully. Redirecting to sign in...", "success");
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
      return;
    }

    showMessage(data.error || "Registration failed. Please try again.", "error");
  } catch {
    showMessage("Server not reachable", "error");
  }

  submitButton.disabled = false;
  submitLabel.textContent = "Create account";
});

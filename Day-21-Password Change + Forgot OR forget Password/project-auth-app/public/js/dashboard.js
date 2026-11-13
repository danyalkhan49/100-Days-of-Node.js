const token = localStorage.getItem("token");
const logoutButton = document.getElementById("logout-button");
const dashboardMessage = document.getElementById("dashboard-message");

// Clear the browser session before returning to the login page.
function logout() {
  localStorage.removeItem("token");
  window.location.replace("/login");
}

logoutButton.addEventListener("click", logout);

// Protect this page from users who have not signed in.
if (!token) {
  window.location.replace("/login");
} else {
  loadProfile();
}

// Load the signed-in user's profile using the bearer token from localStorage.
async function loadProfile() {
  try {
    const response = await fetch("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok || data.success !== true || !data.data) {
      showDashboardMessage(data.error || "Unable to load your profile.", "error");
      return;
    }

    const user = data.data;
    const name = typeof user.name === "string" ? user.name : "";
    document.getElementById("greeting").textContent = name ? `Hello, ${name}` : "Hello";
    document.getElementById("avatar").textContent = name.trim().charAt(0).toUpperCase() || "?";
    document.getElementById("profile-name").textContent = name || "—";
    document.getElementById("profile-email").textContent = typeof user.email === "string" ? user.email : "—";

    const createdAt = user.createdAt ? new Date(user.createdAt) : null;
    const formattedDate = createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "—";
    document.getElementById("profile-created").textContent = formattedDate;
  } catch {
    showDashboardMessage("Server not reachable", "error");
  }
}

// Keep API errors visible without injecting server-provided markup into the page.
function showDashboardMessage(text, kind) {
  dashboardMessage.textContent = text;
  dashboardMessage.className = `message dashboard-message is-visible is-${kind}`;
}

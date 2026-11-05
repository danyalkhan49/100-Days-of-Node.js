(function () {
  "use strict";

  const TOKEN_KEY = "lifelink_token";
  const ROLE_KEY = "lifelink_role";
  const NAME_KEY = "lifelink_name";
  const ROLE_PAGES = { donor: "donor.html", requester: "requester.html", admin: "admin.html" };

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function decodeToken(value) {
    try {
      const part = value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="));
      return JSON.parse(decodeURIComponent(Array.from(decoded, function (char) {
        return "%" + char.charCodeAt(0).toString(16).padStart(2, "0");
      }).join("")));
    } catch {
      return {};
    }
  }

  function session() {
    const value = token();
    if (!value) return { token: null, role: null, name: null, id: null };
    const claims = decodeToken(value);
    const role = localStorage.getItem(ROLE_KEY) || sessionStorage.getItem(ROLE_KEY) || claims.role || null;
    return {
      token: value,
      role: role,
      roles: role === "donor" ? ["donor", "requester"] : role ? [role] : [],
      name: sessionStorage.getItem(NAME_KEY) || null,
      id: claims.id || claims._id || null
    };
  }

  function saveSession(value, role, name) {
    localStorage.setItem(TOKEN_KEY, value);
    if (role) localStorage.setItem(ROLE_KEY, role);
    if (name) sessionStorage.setItem(NAME_KEY, name);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(NAME_KEY);
  }

  function errorText(payload, fallback) {
    if (payload && Array.isArray(payload.errors) && payload.errors.length) {
      return payload.errors.map(function (item) { return item.msg || item.message || "Please check this field."; }).join(" ");
    }
    if (payload && typeof payload.error === "string") return payload.error;
    if (payload && typeof payload.message === "string") return payload.message;
    return fallback || "Something went wrong. Please try again.";
  }

  function loginPage(message) {
    if (message) sessionStorage.setItem("lifelink_flash", message);
    window.location.replace("index.html#account");
  }

  async function request(path, options) {
    const settings = options || {};
    const headers = new Headers(settings.headers || {});
    headers.set("Accept", "application/json");
    if (settings.body !== undefined && !(settings.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    const currentToken = token();
    if (currentToken) headers.set("Authorization", "Bearer " + currentToken);

    let response;
    try {
      response = await fetch(path, {
        method: settings.method || "GET",
        headers: headers,
        body: settings.body === undefined
          ? undefined
          : settings.body instanceof FormData
            ? settings.body
            : JSON.stringify(settings.body)
      });
    } catch {
      throw new ApiError("Could not connect to the LifeLink API. Check that the server is running at this address.", 0);
    }

    let payload = null;
    if (response.status !== 204) {
      const raw = await response.text();
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new ApiError("The server returned an unreadable response.", response.status);
        }
      }
    }

    if (!response.ok) {
      if (response.status === 401 && settings.redirectOn401 !== false && currentToken) {
        clearSession();
        loginPage("Your session has expired. Please sign in again.");
      }
      throw new ApiError(errorText(payload, "Request failed (" + response.status + ")."), response.status, payload);
    }
    return payload || {};
  }

  async function download(path, fallbackName) {
    const currentToken = token();
    const headers = new Headers({ Accept: "application/pdf, image/jpeg, image/png, application/json" });
    if (currentToken) headers.set("Authorization", "Bearer " + currentToken);

    let response;
    try {
      response = await fetch(path, { headers: headers });
    } catch {
      throw new ApiError("Could not connect to the LifeLink API. Check that the server is running at this address.", 0);
    }

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (response.status === 401 && currentToken) {
        clearSession();
        loginPage("Your session has expired. Please sign in again.");
      }
      throw new ApiError(errorText(payload, "File download failed (" + response.status + ")."), response.status, payload);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, "")) : fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
  }

  function destination(role) {
    return ROLE_PAGES[role] || "index.html";
  }

  function requireRole(roles) {
    const current = session();
    if (!current.token) {
      loginPage("Sign in to continue to your workspace.");
      return false;
    }
    if (!current.roles || !current.roles.some(function (role) { return roles.includes(role); })) {
      loginPage("That workspace is not available for this account.");
      return false;
    }
    return true;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function formatDate(value, includeTime) {
    if (!value) return "Not provided";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function statusClass(value) {
    const normalized = String(value || "").toLowerCase();
    if (["accepted", "completed", "fulfilled", "active"].includes(normalized)) return "badge-success";
    if (["pending", "urgent", "open"].includes(normalized)) return "badge-warning";
    if (["declined", "canceled", "cancelled", "closed", "deactivated", "critical"].includes(normalized)) return "badge-danger";
    return "badge-neutral";
  }

  function setNotice(element, message, kind) {
    if (!element) return;
    element.textContent = message || "";
    element.dataset.kind = kind || "error";
    element.hidden = !message;
  }

  function setFormMessage(element, message, kind) {
    if (!element) return;
    element.textContent = message || "";
    element.dataset.kind = kind || "error";
  }

  function setBusy(form, busy, busyText) {
    if (!form) return;
    const submit = form.querySelector('[type="submit"]');
    if (!submit) return;
    if (busy) {
      submit.dataset.idleText = submit.textContent;
      submit.disabled = true;
      submit.textContent = busyText || "Please wait…";
      form.setAttribute("aria-busy", "true");
    } else {
      submit.disabled = false;
      submit.textContent = submit.dataset.idleText || submit.textContent;
      form.removeAttribute("aria-busy");
    }
  }

  function loading(container, label) {
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><span>' +
      escapeHtml(label || "Loading…") + "</span></div>";
  }

  function showEmpty(container, title, description) {
    container.setAttribute("aria-busy", "false");
    container.innerHTML = '<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>' +
      escapeHtml(title) + "</h3><p>" + escapeHtml(description) + "</p></div>";
  }

  function showError(container, message) {
    container.setAttribute("aria-busy", "false");
    container.innerHTML = '<div class="error-state"><span class="empty-mark" aria-hidden="true">!</span><h3>We could not load this information</h3><p>' +
      escapeHtml(message) + "</p></div>";
  }

  function listFrom(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return [];
  }

  function refreshNotificationCount() {
    const badge = document.querySelector("[data-notification-count]");
    if (!badge || !token()) return Promise.resolve();
    return request("/notifications/inbox/unread-count").then(function (result) {
      const count = Number(result.data && result.data.count) || 0;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count === 0;
      badge.parentElement.setAttribute(
        "aria-label",
        count ? "Notifications, " + count + " unread" : "Notifications"
      );
    }).catch(function (error) {
      if (error.status !== 401) console.error("Could not refresh notification count.", error.status || error.name);
    });
  }

  function initializeShell() {
    const current = session();
    const header = document.querySelector("[data-site-header]");
    if (header) {
      const dashboardHref = destination(current.role);
      header.innerHTML = '<header class="site-header"><div class="container header-inner">' +
        '<a class="brand" href="index.html" aria-label="LifeLink home"><span class="brand-mark" aria-hidden="true"></span><span>Life<span class="brand-word">Link</span></span></a>' +
        '<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation"><span class="menu-bars" aria-hidden="true"></span><span>Menu</span></button>' +
        '<nav class="site-nav" id="primary-navigation" aria-label="Main navigation">' +
        '<a href="requests.html">Open requests</a><a href="hospitals.html">Hospitals</a><a href="how-it-works.html">How it works</a>' +
        (current.token ? '<a data-dashboard-link href="' + dashboardHref + '">My workspace</a>' : "") +
        (current.token ? '<a href="account-security.html">Account safety</a>' : "") +
        (current.token
          ? '<a class="notification-nav-link" href="notifications.html" aria-label="Notifications" title="Notifications"><svg class="notification-bell-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="notification-count" data-notification-count aria-hidden="true" hidden>0</span></a>'
          : "") +
        '</nav><div class="header-actions">' +
        (current.token
          ? '<button class="logout-button" type="button" data-logout>Sign out</button>'
          : '<a class="button button-outline button-small" href="index.html#account">Sign in</a>') +
        '</div></div></header>';

      const menuButton = header.querySelector(".menu-toggle");
      const nav = header.querySelector(".site-nav");
      menuButton.addEventListener("click", function () {
        const open = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!open));
        nav.classList.toggle("is-open", !open);
      });
      nav.addEventListener("click", function (event) {
        if (event.target.closest("a")) {
          menuButton.setAttribute("aria-expanded", "false");
          nav.classList.remove("is-open");
        }
      });
      header.querySelectorAll("[data-logout]").forEach(function (button) {
        button.addEventListener("click", function () {
          clearSession();
          window.location.assign("index.html");
        });
      });
      const activeLink = header.querySelector('a[href="' + window.location.pathname.split("/").pop() + '"]');
      if (activeLink) activeLink.setAttribute("aria-current", "page");
      if (current.token) {
        window.LifeLink.refreshNotificationCount = refreshNotificationCount;
        refreshNotificationCount();
      }
    }

    const footer = document.querySelector("[data-site-footer]");
    if (footer) {
      footer.innerHTML = '<footer class="site-footer">' +
        '<div class="container footer-main">' +
        '<section class="footer-brand-block"><a class="footer-brand" href="index.html" aria-label="LifeLink home">Life<span>Link</span></a>' +
        '<p>Connecting blood donors and families with care, consent, and privacy.</p></section>' +
        '<nav class="footer-column footer-nav" aria-label="Quick links"><h2>Quick Links</h2>' +
        '<a href="index.html">Home</a><a href="requests.html">Requests</a>' +
        '<a href="how-it-works.html">How it works</a><a href="faq.html">FAQ</a></nav>' +
        '<nav class="footer-column footer-nav" aria-label="Support"><h2>Support</h2>' +
        '<a href="contact.html">Contact</a>' +
        '<a href="tel:+923240128349">Helpline: +92 324 0128349</a>' +
        '<a href="https://wa.me/923240128349" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>' +
        '<a href="terms.html">Terms</a><a href="privacy.html">Privacy Policy</a></nav>' +
        '<section class="footer-column footer-social"><h2>Follow LifeLink</h2>' +
        '<div class="footer-social-links">' +
        '<a href="https://example.com/lifelink-facebook" target="_blank" rel="noopener noreferrer" aria-label="Facebook profile placeholder; replace with official link" title="Replace with official Facebook profile">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.6 1.6-1.6h1.7V3.5c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.6V13h2.7v8h3.2z"/></svg></a>' +
        '<a href="https://example.com/lifelink-instagram" target="_blank" rel="noopener noreferrer" aria-label="Instagram profile placeholder; replace with official link" title="Replace with official Instagram profile">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3zm0 2A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h9a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 16.5 5h-9zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.2-3.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z"/></svg></a>' +
        '<a href="https://example.com/lifelink-linkedin" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn profile placeholder; replace with official link" title="Replace with official LinkedIn profile">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 7.8a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8zM3.5 9h3.4v11H3.5zm5.5 0h3.3v1.5h.1c.5-.9 1.6-1.8 3.3-1.8 3.5 0 4.2 2.3 4.2 5.2V20h-3.4v-5.4c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H9z"/></svg></a>' +
        '</div><p class="social-note">Replace these example links with official LifeLink profiles before launch.</p>' +
        '<p class="emergency-note">LifeLink is not an emergency service. For urgent care, contact local emergency services or a licensed healthcare facility.</p>' +
        '<a class="footer-emergency-link" href="medical-disclaimer.html">Emergency guidance</a></section>' +
        '</div>' +
        '<div class="container footer-bottom"><p>© 2026 LifeLink. All rights reserved.</p></div>' +
        '</footer>';
    }

    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        const dialog = button.closest("dialog");
        if (dialog && dialog.open) dialog.close();
      });
    });

    if (window.location.search.includes("session=expired")) {
      const flash = "Your session has expired. Please sign in again.";
      sessionStorage.setItem("lifelink_flash", flash);
    }
  }

  window.LifeLink = {
    ApiError: ApiError,
    request: request,
    download: download,
    token: token,
    session: session,
    saveSession: saveSession,
    clearSession: clearSession,
    destination: destination,
    requireRole: requireRole,
    errorText: errorText,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    statusClass: statusClass,
    setNotice: setNotice,
    setFormMessage: setFormMessage,
    setBusy: setBusy,
    loading: loading,
    showEmpty: showEmpty,
    showError: showError,
    listFrom: listFrom,
    refreshNotificationCount: refreshNotificationCount
  };

  document.addEventListener("DOMContentLoaded", initializeShell);

  let frontendErrorReported = false;
  function reportFrontendError(eventType) {
    if (frontendErrorReported) return;
    frontendErrorReported = true;
    fetch("/api/system/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        eventType: eventType,
        page: window.location.pathname.slice(0, 100)
      }),
      keepalive: true
    }).catch(function () {});
  }
  window.addEventListener("error", function () { reportFrontendError("error"); });
  window.addEventListener("unhandledrejection", function () { reportFrontendError("unhandledrejection"); });
})();
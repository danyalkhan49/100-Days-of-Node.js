(function () {
  "use strict";

  const api = window.LifeLink;
  if (!api.requireRole(["donor", "requester", "admin"])) return;
  const form = document.getElementById("notification-preferences");
  const inboxList = document.getElementById("inbox-list");
  const list = document.getElementById("notification-list");
  const pageSize = 20;
  let page = 1;
  let totalPages = 1;
  let inboxPage = 1;
  let inboxTotalPages = 1;

  function renderInboxNotification(item) {
    const readStatus = item.isRead ? "Read" : "Unread";
    const readAction = item.isRead
      ? ""
      : '<button class="button button-outline button-small" type="button" data-inbox-action="read" data-notification-id="' +
        api.escapeHtml(item._id) + '">Mark as read</button>';
    return '<article class="offer-card notification-card ' + (item.isRead ? "is-read" : "is-unread") +
      '"><div class="offer-card-top"><div><strong>' + api.escapeHtml(item.title || "Notification") +
      '</strong><span class="badge ' + (item.isRead ? "badge-neutral" : "badge-warning") +
      '">' + readStatus + '</span></div><span class="notification-type">' +
      api.escapeHtml(String(item.type || "update").replace(/-/g, " ")) +
      '</span></div><p>' + api.escapeHtml(item.message || "") + '</p><p class="notification-date">' +
      api.escapeHtml(api.formatDate(item.createdAt, true)) +
      '</p><div class="notification-actions">' + readAction +
      '<button class="button button-quiet button-small" type="button" data-inbox-action="delete" data-notification-id="' +
      api.escapeHtml(item._id) + '">Delete</button></div></article>';
  }

  function renderNotification(item) {
    const request = item.request && typeof item.request === "object" ? item.request : null;
    const title = String(item.notificationType || "notification").replace(/-/g, " ");
    const context = request
      ? `<p>${api.escapeHtml(request.bloodGroup || "")} · ${api.escapeHtml(request.city || "")}${request.urgency === "Critical" ? " · Critical priority" : ""}</p>`
      : "";
    return '<article class="offer-card"><div class="offer-card-top"><strong>' + api.escapeHtml(title) +
      '</strong><span class="badge ' + api.statusClass(item.status) + '">' + api.escapeHtml(item.status || "Pending") +
      '</span></div><p>Channel: ' + api.escapeHtml(item.channel || "—") + ' · ' +
      api.escapeHtml(api.formatDate(item.sentAt || item.createdAt, true)) + "</p>" + context + "</article>";
  }

  async function loadPreferences() {
    const result = await api.request("/notifications/preferences");
    const preferences = result.data || {};
    for (const key of ["email", "sms", "whatsapp", "reminders"]) {
      form.elements.namedItem(key).checked = preferences[key] === true;
    }
  }

  async function loadNotifications() {
    api.loading(list, "Loading notification history…");
    try {
      const result = await api.request("/notifications?page=" + page + "&limit=" + pageSize);
      const items = api.listFrom(result);
      totalPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("notification-page").textContent = "Page " + page + " of " + totalPages;
      document.getElementById("notification-prev").disabled = page <= 1;
      document.getElementById("notification-next").disabled = page >= totalPages;
      list.setAttribute("aria-busy", "false");
      list.innerHTML = items.length
        ? items.map(renderNotification).join("")
        : '<div class="empty-state"><h3>No notification attempts</h3><p>When a matching event and verified channel are available, delivery attempts will appear here.</p></div>';
    } catch (error) {
      api.showError(list, error.message);
      document.getElementById("notification-page").textContent = "Page " + page;
      document.getElementById("notification-next").disabled = true;
    }
  }

  async function loadInbox() {
    api.loading(inboxList, "Loading your inbox…");
    try {
      const result = await api.request(
        "/notifications/inbox?page=" + inboxPage + "&limit=" + pageSize
      );
      const items = api.listFrom(result);
      inboxTotalPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("inbox-page").textContent =
        "Page " + inboxPage + " of " + inboxTotalPages;
      document.getElementById("inbox-prev").disabled = inboxPage <= 1;
      document.getElementById("inbox-next").disabled = inboxPage >= inboxTotalPages;
      inboxList.setAttribute("aria-busy", "false");
      inboxList.innerHTML = items.length
        ? items.map(renderInboxNotification).join("")
        : '<div class="empty-state"><h3>Your inbox is clear</h3><p>Important updates about compatible requests, offers, and account verification will appear here.</p></div>';
      await refreshUnreadCount();
    } catch (error) {
      api.showError(inboxList, error.message);
      document.getElementById("inbox-page").textContent = "Page " + inboxPage;
      document.getElementById("inbox-next").disabled = true;
    }
  }

  async function refreshUnreadCount() {
    const result = await api.request("/notifications/inbox/unread-count");
    const count = Number(result.data && result.data.count) || 0;
    document.getElementById("inbox-unread-count").textContent =
      count ? "(" + count + " unread)" : "(all caught up)";
    if (api.refreshNotificationCount) await api.refreshNotificationCount();
    return count;
  }

  inboxList.addEventListener("click", async function (event) {
    const button = event.target.closest("button[data-inbox-action]");
    if (!button) return;
    const action = button.dataset.inboxAction;
    const notificationId = button.dataset.notificationId;
    button.disabled = true;
    try {
      if (action === "read") {
        await api.request("/notifications/inbox/" + encodeURIComponent(notificationId) + "/read", {
          method: "PATCH"
        });
      } else if (action === "delete") {
        await api.request("/notifications/inbox/" + encodeURIComponent(notificationId), {
          method: "DELETE"
        });
      }
      await loadInbox();
    } catch (error) {
      button.disabled = false;
      api.setNotice(document.getElementById("notifications-message"), error.message, "error");
    }
  });

  document.getElementById("mark-all-read").addEventListener("click", async function (event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.request("/notifications/inbox/read-all", { method: "PATCH" });
      await loadInbox();
    } catch (error) {
      api.setNotice(document.getElementById("notifications-message"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("inbox-prev").addEventListener("click", function () {
    if (inboxPage > 1) { inboxPage -= 1; loadInbox(); }
  });
  document.getElementById("inbox-next").addEventListener("click", function () {
    if (inboxPage < inboxTotalPages) { inboxPage += 1; loadInbox(); }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const preferences = {};
    for (const key of ["email", "sms", "whatsapp", "reminders"]) {
      preferences[key] = form.elements.namedItem(key).checked;
    }
    const message = document.getElementById("preferences-message");
    api.setFormMessage(message, "");
    api.setBusy(form, true, "Saving…");
    try {
      await api.request("/notifications/preferences", { method: "PATCH", body: preferences });
      api.setFormMessage(message, "Notification preferences saved.", "success");
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(form, false);
    }
  });

  document.getElementById("refresh-notifications").addEventListener("click", loadNotifications);
  document.getElementById("notification-prev").addEventListener("click", function () {
    if (page > 1) { page -= 1; loadNotifications(); }
  });
  document.getElementById("notification-next").addEventListener("click", function () {
    if (page < totalPages) { page += 1; loadNotifications(); }
  });
  loadPreferences().catch(function (error) {
    api.setNotice(document.getElementById("notifications-message"), error.message, "error");
  });
  loadInbox();
  loadNotifications();
})();

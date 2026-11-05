(function () {
  "use strict";

  const api = window.LifeLink;
  const list = document.getElementById("request-list");
  if (!list) return;

  const filterForm = document.getElementById("request-filters");
  const message = document.getElementById("requests-message");
  const count = document.getElementById("request-count");
  const prev = document.getElementById("request-prev");
  const next = document.getElementById("request-next");
  const pageLabel = document.getElementById("request-page");
  const currentSession = api.session();
  const canMakeOffer = currentSession.roles && currentSession.roles.includes("donor");
  const reportDialog = document.getElementById("report-dialog");
  const reportForm = document.getElementById("report-form");
  const pageSize = 5;
  let page = 1;
  let totalPages = 1;

  function queryString() {
    const values = new FormData(filterForm);
    const query = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    ["bloodGroup", "city", "urgency", "search", "sortBy", "order"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    return query.toString();
  }

  function renderRequest(item) {
    const id = api.escapeHtml(item._id || item.id);
    const urgency = String(item.urgency || "Normal").toLowerCase();
    const requester = item.requester && typeof item.requester === "object" ? item.requester.name : "";
    const requesterId = item.requester && typeof item.requester === "object" ? String(item.requester._id || item.requester.id || "") : "";
    const note = item.note ? '<p class="request-note">' + api.escapeHtml(item.note) + "</p>" : "";
    const donorAction = canMakeOffer
      ? '<form class="donor-offer-form" data-offer-form data-request-id="' + id + '">' +
        '<div class="field"><label for="offer-message-' + id + '">Message <span class="label-optional">Optional</span></label>' +
        '<input id="offer-message-' + id + '" name="message" maxlength="200" placeholder="Add a short note"></div>' +
        '<button class="button button-primary button-small" type="submit">Make offer</button></form>'
      : currentSession.token
        ? '<div class="request-card-foot"><span class="field-hint">Donor offers are available to signed-in donor accounts.</span></div>'
        : '<div class="request-card-foot"><a class="text-link" href="index.html#account">Sign in as a donor to make an offer <span aria-hidden="true">→</span></a></div>';

    return '<article class="request-card">' +
      '<div class="request-card-top"><span class="badge blood-badge">' + api.escapeHtml(item.bloodGroup || "—") + '</span>' +
      '<span class="badge urgency-' + api.escapeHtml(urgency) + '">' + api.escapeHtml(item.urgency || "Normal") + "</span></div>" +
      '<h3>' + api.escapeHtml(item.patientName || "Blood request") + "</h3>" +
      '<p class="request-hospital">' + api.escapeHtml(item.hospital || "Hospital not provided") +
      (requester ? " · Requested by " + api.escapeHtml(requester) : "") + "</p>" +
      '<div class="request-meta"><span>' + api.escapeHtml(item.city || "City not provided") + '</span><span>' +
      api.escapeHtml(String(item.unitsNeeded || 1)) + " unit" + (Number(item.unitsNeeded) === 1 ? "" : "s") +
      " · " + api.escapeHtml(String(item.unitsFulfilled || 0)) + " fulfilled</span><span>Needed " +
      api.escapeHtml(api.formatDate(item.neededBy, true)) + "</span></div>" +
      '<div class="card-actions"><a class="button button-outline button-small" href="request.html?id=' + encodeURIComponent(item._id || item.id) + '">View and share</a></div>' +
      note + donorAction +
      (currentSession.token ? '<div class="card-actions">' +
        '<button class="button button-quiet button-small" type="button" data-report-request="' + id + '">Report request</button>' +
        (requesterId && requesterId !== String(currentSession.id) ? '<button class="button button-quiet button-small" type="button" data-report-user="' + api.escapeHtml(requesterId) + '">Report requester</button><button class="button button-quiet button-small" type="button" data-block-user="' + api.escapeHtml(requesterId) + '">Block requester</button>' : "") +
        "</div>" : "") + "</article>";
  }

  async function loadRequests() {
    api.loading(list, "Loading open requests…");
    api.setNotice(message, "");
    try {
      const result = await api.request("/requests?" + queryString());
      const requests = api.listFrom(result);
      const pagination = result.pagination || {};
      totalPages = Math.max(1, Number(pagination.totalPages) || 1);
      const total = pagination.total;
      count.textContent = total == null ? "" : Number(total) + (Number(total) === 1 ? " request" : " requests");
      pageLabel.textContent = "Page " + page + " of " + totalPages;
      prev.disabled = page <= 1;
      next.disabled = page >= totalPages;
      list.setAttribute("aria-busy", "false");
      list.innerHTML = requests.length
        ? requests.map(renderRequest).join("")
        : '<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>No open requests match</h3><p>Try a different city, blood group, or search term. Requests that are closed or past their needed-by date are not shown.</p></div>';
    } catch (error) {
      count.textContent = "";
      pageLabel.textContent = "Page " + page;
      prev.disabled = page <= 1;
      next.disabled = true;
      api.showError(list, error.message);
      api.setNotice(message, "The request board could not be refreshed. Please try again.", "error");
    }
  }

  filterForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!filterForm.reportValidity()) return;
    page = 1;
    loadRequests();
  });

  document.getElementById("clear-filters").addEventListener("click", function () {
    filterForm.reset();
    document.getElementById("filter-sort").value = "neededBy";
    document.getElementById("filter-order").value = "asc";
    page = 1;
    loadRequests();
  });

  prev.addEventListener("click", function () {
    if (page > 1) {
      page -= 1;
      loadRequests();
    }
  });
  next.addEventListener("click", function () {
    if (page < totalPages) {
      page += 1;
      loadRequests();
    }
  });

  reportForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!reportForm.reportValidity()) return;
    const values = new FormData(reportForm);
    const body = {
      reason: String(values.get("reason")),
      description: String(values.get("description") || "").trim()
    };
    api.setFormMessage(document.getElementById("report-form-message"), "");
    api.setBusy(reportForm, true, "Submitting…");
    try {
      const path = reportForm.dataset.targetType === "user" ? "/reports/users/" : "/reports/requests/";
      const result = await api.request(path + encodeURIComponent(reportForm.dataset.target), { method: "POST", body: body });
      reportDialog.close();
      reportForm.reset();
      api.setNotice(message, result.message || "Your report was submitted for review.", "success");
    } catch (error) {
      api.setFormMessage(document.getElementById("report-form-message"), error.message, "error");
    } finally {
      api.setBusy(reportForm, false);
    }
  });

  list.addEventListener("submit", async function (event) {
    const form = event.target.closest("[data-offer-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const body = { request: form.dataset.requestId };
    const note = String(values.get("message") || "").trim();
    if (note) body.message = note;
    api.setBusy(form, true, "Sending…");
    try {
      const result = await api.request("/offers", { method: "POST", body: body });
      await loadRequests();
      api.setNotice(message, result.message || "Your offer was submitted.", "success");
    } catch (error) {
      api.setNotice(message, error.message, "error");
      api.setBusy(form, false);
    }
  });

  list.addEventListener("click", async function (event) {
    const reportUser = event.target.closest("[data-report-user]");
    const reportRequest = event.target.closest("[data-report-request]");
    const blockUser = event.target.closest("[data-block-user]");
    if (reportUser || reportRequest) {
      const button = reportUser || reportRequest;
      reportForm.dataset.target = reportUser ? button.dataset.reportUser : button.dataset.reportRequest;
      reportForm.dataset.targetType = reportUser ? "user" : "request";
      api.setFormMessage(document.getElementById("report-form-message"), "");
      reportForm.reset();
      reportDialog.showModal();
      return;
    }
    if (blockUser) {
      if (!window.confirm("Block this requester? They will not appear in donor search and you cannot offer or share contact details with each other.")) return;
      blockUser.disabled = true;
      try {
        await api.request("/reports/users/" + encodeURIComponent(blockUser.dataset.blockUser) + "/block", { method: "POST", body: {} });
        api.setNotice(message, "Requester blocked.", "success");
      } catch (error) {
        api.setNotice(message, error.message, "error");
        blockUser.disabled = false;
      }
    }
  });

  loadRequests();
})();
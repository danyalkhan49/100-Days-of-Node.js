(function () {
  "use strict";

  const api = window.LifeLink;
  if (!api.requireRole(["admin"])) return;

  const session = api.session();
  const statsContainer = document.getElementById("admin-stats");
  const statsMessage = document.getElementById("stats-message");
  const groupStats = document.getElementById("open-group-stats");
  const userForm = document.getElementById("user-filters");
  const userBody = document.getElementById("users-table-body");
  const usersMessage = document.getElementById("users-message");
  const requestForm = document.getElementById("admin-request-filters");
  const requestsList = document.getElementById("admin-requests-list");
  const requestsMessage = document.getElementById("admin-requests-message");
  const reportForm = document.getElementById("admin-report-filters");
  const reportsList = document.getElementById("admin-reports-list");
  const reportsMessage = document.getElementById("admin-reports-message");
  const reviewForm = document.getElementById("admin-review-filters");
  const reviewsList = document.getElementById("admin-reviews-list");
  const reviewsMessage = document.getElementById("admin-reviews-message");
  const identityReviewList = document.getElementById("identity-review-list");
  const identityReviewMessage = document.getElementById("identity-review-message");
  const identityReviewForm = document.getElementById("identity-review-filters");
  const hospitalForm = document.getElementById("admin-hospital-form");
  const hospitalsList = document.getElementById("admin-hospitals-list");
  const hospitalsMessage = document.getElementById("admin-hospitals-message");
  const hospitalFilterForm = document.getElementById("admin-hospital-filters");
  const auditForm = document.getElementById("admin-audit-filters");
  const auditList = document.getElementById("admin-audit-list");
  const auditMessage = document.getElementById("admin-audit-message");
  const supportForm = document.getElementById("admin-support-filters");
  const supportList = document.getElementById("admin-support-list");
  const supportMessage = document.getElementById("admin-support-message");
  const pageSize = 10;
  let userPage = 1;
  let userPages = 1;
  let requestPage = 1;
  let requestPages = 1;
  let reportPage = 1;
  let reportPages = 1;
  let reviewPage = 1;
  let reviewPages = 1;
  let identityPage = 1;
  let identityPages = 1;
  let hospitalPage = 1;
  let hospitalPages = 1;
  let auditPage = 1;
  let auditPages = 1;
  let supportPage = 1;
  let supportPages = 1;
  const hospitalRecords = new Map();
  const supportTicketRecords = new Map();
  const identityDocumentsDownloaded = new Set();

  function nestedValue(source, paths) {
    for (const path of paths) {
      let current = source;
      for (const key of path.split(".")) {
        if (!current || typeof current !== "object" || !(key in current)) {
          current = undefined;
          break;
        }
        current = current[key];
      }
      if (current !== undefined && current !== null && typeof current !== "object") return current;
    }
    return null;
  }

  function statCard(label, value) {
    return '<article class="stat-card"><span>' + api.escapeHtml(label) + '</span><strong>' +
      (value == null ? "—" : api.escapeHtml(String(value))) + "</strong></article>";
  }

  async function loadStats() {
    api.loading(statsContainer, "Loading network totals…");
    api.setNotice(statsMessage, "");
    groupStats.innerHTML = "";
    try {
      const result = await api.request("/admin/dashboard");
      const stats = result.data || result;
      const cards = [
        ["Donors", nestedValue(stats, ["users.donor", "usersByRole.donor", "donors"])],
        ["Requesters", nestedValue(stats, ["users.requester", "usersByRole.requester", "requesters"])],
        ["Open requests", nestedValue(stats, ["requests.Open", "requests.open", "requestsByStatus.Open", "openRequests"])],
        ["Completed donations", nestedValue(stats, ["completedDonations", "offers.Completed", "offersByStatus.Completed"])]
      ];
      statsContainer.setAttribute("aria-busy", "false");
      statsContainer.innerHTML = cards.map(function (card) { return statCard(card[0], card[1]); }).join("");

      const byGroup = stats.openRequestsByBloodGroup || stats.openRequestsByGroup || {};
      const groups = Array.isArray(byGroup)
        ? byGroup.map(function (item) { return [item.bloodGroup || item._id || "—", item.count]; })
        : Object.entries(byGroup);
      groupStats.innerHTML = groups.length
        ? groups.map(function (item) {
          return '<span class="group-stat"><strong>' + api.escapeHtml(item[0]) + "</strong>" +
            api.escapeHtml(String(item[1] == null ? "—" : item[1])) + "</span>";
        }).join("")
        : '<p class="field-hint">No blood-group breakdown was included in the stats response.</p>';
    } catch (error) {
      api.showError(statsContainer, error.message);
      api.setNotice(statsMessage, "The statistics endpoint could not be reached.", "error");
      groupStats.innerHTML = '<p class="field-hint">Group totals are unavailable until the API responds.</p>';
    }
  }

  function auditQuery() {
    const values = new FormData(auditForm);
    const query = new URLSearchParams({ page: String(auditPage), limit: String(pageSize) });
    ["search", "action", "targetType", "from", "to"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    return query.toString();
  }

  function renderAuditEntry(entry) {
    const action = String(entry.action || "action").replace(/-/g, " ");
    const targetType = entry.targetType || (entry.targetUser ? "user" : "target");
    const targetId = entry.targetId || entry.targetUser || "Unavailable";
    const actor = entry.admin && entry.admin.name || "Unavailable admin";
    const metadata = entry.metadata || {};
    const details = [];
    if (metadata.previousStatus) details.push("Previous status: " + metadata.previousStatus);
    if (metadata.status) details.push("Status: " + metadata.status);
    if (metadata.verificationMethod) {
      details.push("Verification method: " + (metadata.verificationMethod === "admin" ? "administrator" : "email"));
    }
    if (metadata.inventoryVerified === true) details.push("Inventory verified");
    if (typeof metadata.affectedOffers === "number") details.push("Offers affected: " + metadata.affectedOffers);
    if (typeof metadata.affectedReviews === "number") details.push("Reviews affected: " + metadata.affectedReviews);
    if (Array.isArray(metadata.changedFields) && metadata.changedFields.length) {
      details.push("Fields changed: " + metadata.changedFields.join(", "));
    }
    if (entry.deliveryStatus) details.push("Email delivery: " + entry.deliveryStatus);
    return '<article class="admin-request-card"><div><span class="badge badge-neutral">' +
      api.escapeHtml(action) + '</span><h3>' + api.escapeHtml(targetType) + " · " +
      api.escapeHtml(String(targetId)) + "</h3><p>By " + api.escapeHtml(actor) + " · " +
      api.escapeHtml(api.formatDate(entry.createdAt, true)) + "</p>" +
      (details.length ? "<p>" + api.escapeHtml(details.join(" · ")) + "</p>" : "") +
      (entry.requestId ? '<p class="field-hint">Request ID: <code>' +
        api.escapeHtml(entry.requestId) + "</code></p>" : "") + "</div></article>";
  }

  async function loadAuditLogs() {
    api.loading(auditList, "Loading audit records…");
    api.setNotice(auditMessage, "");
    try {
      const result = await api.request("/admin/audit-logs?" + auditQuery());
      const entries = api.listFrom(result);
      auditPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("admin-audit-page").textContent = "Page " + auditPage + " of " + auditPages;
      document.getElementById("admin-audit-prev").disabled = auditPage <= 1;
      document.getElementById("admin-audit-next").disabled = auditPage >= auditPages;
      auditList.setAttribute("aria-busy", "false");
      auditList.innerHTML = entries.length
        ? entries.map(renderAuditEntry).join("")
        : '<div class="empty-state"><h3>No audit records</h3><p>No admin actions match these filters.</p></div>';
    } catch (error) {
      api.showError(auditList, error.message);
      document.getElementById("admin-audit-page").textContent = "Page " + auditPage;
      document.getElementById("admin-audit-prev").disabled = auditPage <= 1;
      document.getElementById("admin-audit-next").disabled = true;
      api.setNotice(auditMessage, "The admin audit log could not be loaded.", "error");
    }
  }

  function supportQuery() {
    const values = new FormData(supportForm);
    const query = new URLSearchParams({ page: String(supportPage), limit: String(pageSize) });
    ["status", "category"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    return query.toString();
  }

  function renderSupportTicket(ticket) {
    const id = String(ticket._id || ticket.id || "");
    supportTicketRecords.set(id, ticket);
    const statusOptions = ["Open", "In Progress", "Resolved"].map(function (status) {
      return '<option value="' + api.escapeHtml(status) + '"' +
        (ticket.status === status ? " selected" : "") + ">" + api.escapeHtml(status) + "</option>";
    }).join("");
    const contact = [ticket.name, ticket.email, ticket.phone].filter(Boolean).join(" · ");
    return '<article class="admin-request-card" data-support-ticket="' + api.escapeHtml(id) + '">' +
      '<div><span class="badge ' + api.statusClass(ticket.status) + '">' +
      api.escapeHtml(ticket.status || "Open") + '</span><h3>' + api.escapeHtml(ticket.category || "Support ticket") +
      '</h3><p>' + api.escapeHtml(contact || "Contact details not provided") + " · " +
      api.escapeHtml(api.formatDate(ticket.createdAt, true)) + "</p><p>" +
      api.escapeHtml(ticket.message || "") + "</p></div>" +
      '<div class="report-review-fields"><label>Status<select data-support-status>' + statusOptions +
      '</select></label><label>Reply<textarea data-support-reply maxlength="5000" rows="4" placeholder="Write a reply">' +
      api.escapeHtml(ticket.adminReply || "") + '</textarea></label>' +
      '<button class="button button-outline button-small" type="button" data-save-support="' +
      api.escapeHtml(id) + '">Save ticket</button></div></article>';
  }

  async function loadSupportTickets() {
    api.loading(supportList, "Loading support tickets…");
    api.setNotice(supportMessage, "");
    supportTicketRecords.clear();
    try {
      const result = await api.request("/support/admin/tickets?" + supportQuery());
      const tickets = api.listFrom(result);
      supportPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("admin-support-page").textContent = "Page " + supportPage + " of " + supportPages;
      document.getElementById("admin-support-prev").disabled = supportPage <= 1;
      document.getElementById("admin-support-next").disabled = supportPage >= supportPages;
      supportList.setAttribute("aria-busy", "false");
      supportList.innerHTML = tickets.length
        ? tickets.map(renderSupportTicket).join("")
        : '<div class="empty-state"><h3>No support tickets</h3><p>No tickets match these filters.</p></div>';
    } catch (error) {
      api.showError(supportList, error.message);
      document.getElementById("admin-support-page").textContent = "Page " + supportPage;
      document.getElementById("admin-support-prev").disabled = supportPage <= 1;
      document.getElementById("admin-support-next").disabled = true;
      api.setNotice(supportMessage, "Support tickets could not be loaded.", "error");
    }
  }

  function userQuery() {
    const values = new FormData(userForm);
    const query = new URLSearchParams({ page: String(userPage), limit: String(pageSize) });
    ["role", "isActive", "search"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    return query.toString();
  }

  function userRow(user) {
    const id = String(user._id || user.id || "");
    const active = user.isActive !== false;
    const self = session.id && id === String(session.id);
    const anotherAdmin = user.role === "admin" && !self;
    const disabled = !active || self || anotherAdmin;
    const resetDisabled = !active || user.emailVerified !== true;
    const verifyDisabled = !active || user.emailVerified === true;
    const actionLabel = active ? "Deactivate" : "Deactivated";
    const hint = self ? "You cannot deactivate your own account." : anotherAdmin ? "Admin accounts cannot be deactivated here." : "";
    const verificationTitle = user.emailVerified
      ? "Verified by " + (user.emailVerificationMethod === "admin" ? "an administrator" : "email") +
        (user.emailVerifiedAt ? " on " + new Date(user.emailVerifiedAt).toLocaleString() : "")
      : "This action invalidates any outstanding verification link.";
    return "<tr><td><div class=\"user-cell\"><strong>" + api.escapeHtml(user.name || "Name unavailable") +
      "</strong><span>Account</span></div></td><td>" +
      '<span class="badge badge-neutral">' + api.escapeHtml(user.role || "—") + "</span></td><td>" +
      api.escapeHtml(user.bloodGroup || "—") + "</td><td>" + api.escapeHtml(user.city || "—") + "</td><td>" +
      '<span class="badge ' + (user.emailVerified ? "badge-success" : "badge-warning") + '" title="' +
      api.escapeHtml(verificationTitle) + '">' +
      (user.emailVerified ? "Verified" : "Unverified") + "</span></td><td>" +
      '<span class="badge ' + (active ? "badge-success" : "badge-danger") + '">' + (active ? "Active" : "Deactivated") +
      "</span></td><td><div class=\"card-actions\"><button class=\"button button-outline button-small\" type=\"button\" data-user-id=\"" +
      api.escapeHtml(id) + "\" data-user-active=\"" + String(active) + "\" title=\"" + api.escapeHtml(hint) +
      '"' + (disabled ? " disabled" : "") + ">" + actionLabel + '</button><button class="button button-quiet button-small" type="button" data-verify-email-user="' +
      api.escapeHtml(id) + '" title="' + api.escapeHtml(verificationTitle) + '"' +
      (verifyDisabled ? " disabled" : "") + ">" + (user.emailVerified ? "Email verified" : "Verify email") +
      '</button><button class="button button-quiet button-small" type="button" data-reset-user="' +
      api.escapeHtml(id) + '" title="' + (user.emailVerified ? "Send a one-time reset link to the verified email." : "A verified email is required.") +
      '"' + (resetDisabled ? " disabled" : "") + '>Send reset link</button></div></td></tr>';
  }

  async function loadUsers() {
    userBody.innerHTML = '<tr><td colspan="7"><div class="loading-state"><span class="spinner" aria-hidden="true"></span><span>Loading users…</span></div></td></tr>';
    document.getElementById("users-table-wrap").setAttribute("aria-busy", "true");
    api.setNotice(usersMessage, "");
    try {
      const result = await api.request("/admin/users?" + userQuery());
      const users = api.listFrom(result);
      userPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("users-page").textContent = "Page " + userPage + " of " + userPages;
      document.getElementById("users-prev").disabled = userPage <= 1;
      document.getElementById("users-next").disabled = userPage >= userPages;
      document.getElementById("users-table-wrap").setAttribute("aria-busy", "false");
      userBody.innerHTML = users.length
        ? users.map(userRow).join("")
        : '<tr><td colspan="7"><div class="empty-state"><h3>No accounts match</h3><p>Try another filter or search term.</p></div></td></tr>';
    } catch (error) {
      document.getElementById("users-table-wrap").setAttribute("aria-busy", "false");
      userBody.innerHTML = '<tr><td colspan="7"><div class="error-state"><h3>Users could not be loaded</h3><p>' + api.escapeHtml(error.message) + "</p></div></td></tr>";
      document.getElementById("users-page").textContent = "Page " + userPage;
      document.getElementById("users-prev").disabled = userPage <= 1;
      document.getElementById("users-next").disabled = true;
      api.setNotice(usersMessage, "The user list could not be refreshed.", "error");
    }
  }

  function requestQuery() {
    const values = new FormData(requestForm);
    const query = new URLSearchParams({ page: String(requestPage), limit: String(pageSize) });
    const status = String(values.get("status") || "").trim();
    if (status) query.set("status", status);
    return query.toString();
  }

  function adminRequest(request) {
    const id = api.escapeHtml(request._id || request.id);
    const status = request.status || "Open";
    const requester = request.requester && typeof request.requester === "object" ? request.requester.name : "";
    return '<article class="admin-request-card"><div><span class="badge ' + api.statusClass(status) + '">' +
      api.escapeHtml(status) + '</span><h3>' + api.escapeHtml(request.patientName || "Blood request") + "</h3>" +
      "<p>" + api.escapeHtml(request.bloodGroup || "—") + " · " + api.escapeHtml(request.hospital || "Hospital not provided") +
      " · " + api.escapeHtml(request.city || "City not provided") + (requester ? " · " + api.escapeHtml(requester) : "") +
      " · Needed " + api.escapeHtml(api.formatDate(request.neededBy, true)) + "</p></div>" +
      '<div class="card-actions">' +
      (status === "Open" ? '<button class="button button-outline button-small" type="button" data-close-request="' + id + '">Close request</button>' : "") +
      '<button class="button button-quiet button-small" type="button" data-delete-request="' + id + '">Delete request</button></div></article>';
  }

  async function loadRequests() {
    api.loading(requestsList, "Loading requests…");
    api.setNotice(requestsMessage, "");
    try {
      const result = await api.request("/admin/requests?" + requestQuery());
      const requests = api.listFrom(result);
      requestPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("admin-requests-page").textContent = "Page " + requestPage + " of " + requestPages;
      document.getElementById("admin-requests-prev").disabled = requestPage <= 1;
      document.getElementById("admin-requests-next").disabled = requestPage >= requestPages;
      requestsList.setAttribute("aria-busy", "false");
      requestsList.innerHTML = requests.length
        ? requests.map(adminRequest).join("")
        : '<div class="empty-state"><h3>No requests to show</h3><p>There are no requests for the selected filter.</p></div>';
    } catch (error) {
      api.showError(requestsList, error.message);
      document.getElementById("admin-requests-page").textContent = "Page " + requestPage;
      document.getElementById("admin-requests-prev").disabled = requestPage <= 1;
      document.getElementById("admin-requests-next").disabled = true;
      api.setNotice(requestsMessage, "The request list could not be refreshed.", "error");
    }
  }

  function reportQuery() {
    const values = new FormData(reportForm);
    const query = new URLSearchParams({ page: String(reportPage), limit: String(pageSize) });
    ["search", "status", "reportType"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    return query.toString();
  }

  function renderReport(report) {
    const id = api.escapeHtml(report._id || report.id);
    const reporter = report.reporter && typeof report.reporter === "object" ? report.reporter.name : "Unknown user";
    const target = report.reportType === "user"
      ? (report.reportedUser && report.reportedUser.name) || "User unavailable"
      : (report.bloodRequest && report.bloodRequest.patientName) || "Request unavailable";
    const targetDetails = report.reportType === "user"
      ? [report.reportedUser && report.reportedUser.role, report.reportedUser && report.reportedUser.city].filter(Boolean).join(" · ")
      : [report.bloodRequest && report.bloodRequest.bloodGroup, report.bloodRequest && report.bloodRequest.hospital, report.bloodRequest && report.bloodRequest.city].filter(Boolean).join(" · ");
    const reason = String(report.reason || "other").replace(/-/g, " ");
    const statusOptions = ["Pending", "Under Review", "Resolved", "Rejected"].map(function (status) {
      return '<option' + (report.status === status ? " selected" : "") + '>' + api.escapeHtml(status) + "</option>";
    }).join("");
    const review = report.reviewedBy && report.reviewedBy.name
      ? "<p>Last reviewed by " + api.escapeHtml(report.reviewedBy.name) + " · " + api.escapeHtml(api.formatDate(report.reviewedAt, true)) + "</p>"
      : "";
    return '<article class="admin-request-card report-card" data-report-card="' + id + '">' +
      '<div><span class="badge ' + api.statusClass(report.status) + '">' + api.escapeHtml(report.status || "Pending") +
      '</span><h3>' + api.escapeHtml(report.reportType === "user" ? "User report" : "Request report") + " · " + api.escapeHtml(target) +
      "</h3><p>Reported by " + api.escapeHtml(reporter) + " · " + api.escapeHtml(reason) + " · " +
      api.escapeHtml(api.formatDate(report.createdAt, true)) + "</p>" +
      (targetDetails ? "<p>" + api.escapeHtml(targetDetails) + "</p>" : "") +
      (report.description ? "<p>" + api.escapeHtml(report.description) + "</p>" : "") + review + "</div>" +
      '<div class="report-review-fields"><label>Status<select data-report-status>' + statusOptions + "</select></label>" +
      '<label>Admin note<textarea data-report-note maxlength="1000" rows="3">' + api.escapeHtml(report.adminNote || "") + "</textarea></label>" +
      '<button class="button button-outline button-small" type="button" data-save-report="' + id + '">Save review</button></div></article>';
  }

  async function loadReports() {
    api.loading(reportsList, "Loading reports…");
    api.setNotice(reportsMessage, "");
    try {
      const result = await api.request("/admin/reports?" + reportQuery());
      const reports = api.listFrom(result);
      reportPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("reports-page").textContent = "Page " + reportPage + " of " + reportPages;
      document.getElementById("reports-prev").disabled = reportPage <= 1;
      document.getElementById("reports-next").disabled = reportPage >= reportPages;
      reportsList.setAttribute("aria-busy", "false");
      reportsList.innerHTML = reports.length
        ? reports.map(renderReport).join("")
        : '<div class="empty-state"><h3>No reports to show</h3><p>There are no reports for the selected filters.</p></div>';
    } catch (error) {
      api.showError(reportsList, error.message);
      api.setNotice(reportsMessage, "The report queue could not be refreshed.", "error");
      document.getElementById("reports-page").textContent = "Page " + reportPage;
      document.getElementById("reports-prev").disabled = reportPage <= 1;
      document.getElementById("reports-next").disabled = true;
    }
  }

  function renderAdminReview(review) {
    const id = api.escapeHtml(review._id || review.id);
    const reviewer = review.reviewer && review.reviewer.name || "Unknown participant";
    const reviewee = review.reviewee && review.reviewee.name || "Unknown participant";
    const request = review.offer && review.offer.request || {};
    const note = review.adminNote || "";
    return '<article class="admin-request-card" data-review-card="' + id + '">' +
      '<div><span class="badge ' + api.statusClass(review.status) + '">' + api.escapeHtml(review.status) +
      '</span><h3>' + api.escapeHtml(review.rating + " / 5 stars") + " · " + api.escapeHtml(reviewee) +
      '</h3><p>Submitted by ' + api.escapeHtml(reviewer) + " · " + api.escapeHtml(request.patientName || "Completed donation") +
      " · " + api.escapeHtml(request.city || "City unavailable") + " · " + api.escapeHtml(api.formatDate(review.createdAt, true)) +
      "</p>" + (review.comment ? "<p>" + api.escapeHtml(review.comment) + "</p>" : "<p class=\"field-hint\">No comment provided.</p>") +
      (review.reviewedBy && review.reviewedBy.name
        ? "<p class=\"field-hint\">Last reviewed by " + api.escapeHtml(review.reviewedBy.name) + " · " +
          api.escapeHtml(api.formatDate(review.reviewedAt, true)) + "</p>" : "") +
      '</div><div class="report-review-fields"><label>Moderation note<textarea data-review-note maxlength="500" rows="3">' +
      api.escapeHtml(note) + '</textarea></label><div class="card-actions">' +
      '<button class="button button-outline button-small" type="button" data-moderate-review="Published">Publish</button>' +
      '<button class="button button-quiet button-small" type="button" data-moderate-review="Rejected">Reject</button></div></div></article>';
  }

  async function loadReviews() {
    const status = String(new FormData(reviewForm).get("status") || "");
    const query = new URLSearchParams({ page: String(reviewPage), limit: String(pageSize) });
    if (status) query.set("status", status);
    api.loading(reviewsList, "Loading reviews…");
    api.setNotice(reviewsMessage, "");
    try {
      const result = await api.request("/admin/reviews?" + query.toString());
      const reviews = api.listFrom(result);
      reviewPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("reviews-page").textContent = "Page " + reviewPage + " of " + reviewPages;
      document.getElementById("reviews-prev").disabled = reviewPage <= 1;
      document.getElementById("reviews-next").disabled = reviewPage >= reviewPages;
      reviewsList.setAttribute("aria-busy", "false");
      reviewsList.innerHTML = reviews.length
        ? reviews.map(renderAdminReview).join("")
        : '<div class="empty-state"><h3>No reviews to show</h3><p>There are no reviews for the selected status.</p></div>';
    } catch (error) {
      api.showError(reviewsList, error.message);
      api.setNotice(reviewsMessage, "The review queue could not be loaded.", "error");
      document.getElementById("reviews-page").textContent = "Page " + reviewPage;
      document.getElementById("reviews-prev").disabled = reviewPage <= 1;
      document.getElementById("reviews-next").disabled = true;
    }
  }

  function renderIdentityReview(user) {
    const id = api.escapeHtml(user._id || "");
    const status = user.identityVerificationStatus || "Pending";
    const canReview = identityDocumentsDownloaded.has(String(user._id || ""));
    return '<article class="admin-request-card" data-identity-user="' + id + '"><div><span class="badge ' + api.statusClass(status) +
      '">' + api.escapeHtml(status) + '</span><h3>' + api.escapeHtml(user.name || "Account") +
      '</h3><p>' + api.escapeHtml([user.email, user.role, user.city].filter(Boolean).join(" · ")) +
      '</p><p>Submitted ' + api.escapeHtml(api.formatDate(user.identityDocumentUploadedAt, true)) +
      (user.identityReviewNote ? ' · Last note: ' + api.escapeHtml(user.identityReviewNote) : "") +
      '</p></div><div class="identity-review-actions"><label>Review note<textarea data-identity-note maxlength="500" rows="2">' +
      api.escapeHtml(user.identityReviewNote || "") + '</textarea></label><div class="card-actions">' +
      '<button class="button button-outline button-small" type="button" data-identity-download="' + id + '">Download document</button>' +
      '<button class="button button-outline button-small" type="button" data-review-identity="Verified"' + (status === "Verified" || !canReview ? " disabled" : "") +
      '>Mark verified</button><button class="button button-quiet button-small" type="button" data-review-identity="Rejected"' +
      (status === "Rejected" || !canReview ? " disabled" : "") + '>Reject</button></div></div></article>';
  }

  async function loadIdentityReviews() {
    const status = String(new FormData(identityReviewForm).get("status") || "Pending");
    const query = new URLSearchParams({ page: String(identityPage), limit: String(pageSize), status: status });
    api.loading(identityReviewList, "Loading identity verification queue…");
    api.setNotice(identityReviewMessage, "");
    try {
      const result = await api.request("/admin/identity-verifications?" + query.toString());
      const users = api.listFrom(result);
      identityPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("identity-review-page").textContent = "Page " + identityPage + " of " + identityPages;
      document.getElementById("identity-review-prev").disabled = identityPage <= 1;
      document.getElementById("identity-review-next").disabled = identityPage >= identityPages;
      identityReviewList.setAttribute("aria-busy", "false");
      identityReviewList.innerHTML = users.length
        ? users.map(renderIdentityReview).join("")
        : '<div class="empty-state"><h3>No identity documents</h3><p>No accounts match this review status.</p></div>';
    } catch (error) {
      api.showError(identityReviewList, error.message);
      api.setNotice(identityReviewMessage, "The identity verification queue could not be loaded.", "error");
      document.getElementById("identity-review-page").textContent = "Page " + identityPage;
      document.getElementById("identity-review-prev").disabled = identityPage <= 1;
      document.getElementById("identity-review-next").disabled = true;
    }
  }

  function renderHospital(hospital) {
    const id = String(hospital._id || "");
    hospitalRecords.set(id, hospital);
    const active = hospital.isActive !== false;
    const inventory = hospital.inventoryVerified
      ? "Verified"
      : "Not verified";
    return '<article class="admin-request-card" data-hospital-card="' + api.escapeHtml(id) + '">' +
      '<div><span class="badge ' + api.statusClass(hospital.verificationStatus) + '">' +
      api.escapeHtml(hospital.verificationStatus || "Pending") + '</span> ' +
      '<span class="badge ' + (hospital.inventoryVerified ? "badge-success" : "badge-neutral") +
      '">Inventory: ' + inventory + '</span> ' +
      '<span class="badge ' + (active ? "badge-success" : "badge-danger") + '">' +
      (active ? "Active" : "Removed") + '</span><h3>' + api.escapeHtml(hospital.name || "Facility") +
      '</h3><p>' + api.escapeHtml([hospital.city, hospital.address].filter(Boolean).join(" · ")) +
      '</p><p>' + api.escapeHtml(hospital.contactNumber || "No contact") +
      (hospital.bloodGroups && hospital.bloodGroups.length ? " · " + api.escapeHtml(hospital.bloodGroups.join(", ")) : "") +
      '</p></div><div class="card-actions">' +
      '<button class="button button-outline button-small" type="button" data-edit-hospital="' + api.escapeHtml(id) +
      '"' + (!active ? " disabled" : "") + '>Edit</button>' +
      '<button class="button button-outline button-small" type="button" data-verify-hospital="' + api.escapeHtml(id) +
      '"' + (!active || hospital.verificationStatus === "Verified" ? " disabled" : "") + '>Verify facility</button>' +
      '<button class="button button-outline button-small" type="button" data-verify-inventory="' + api.escapeHtml(id) +
      '"' + (!active || hospital.verificationStatus !== "Verified" || hospital.inventoryVerified ? " disabled" : "") +
      '>Verify inventory</button>' +
      '<button class="button button-quiet button-small" type="button" data-reject-hospital="' + api.escapeHtml(id) +
      '"' + (!active || hospital.verificationStatus === "Rejected" ? " disabled" : "") + '>Reject</button>' +
      '<button class="button button-quiet button-small" type="button" data-remove-hospital="' + api.escapeHtml(id) +
      '"' + (!active ? " disabled" : "") + '>Remove</button>' +
      '<button class="button button-quiet button-small" type="button" data-hospital-audit="' + api.escapeHtml(id) +
      '">Audit history</button></div></article>';
  }

  async function loadHospitals() {
    const query = new URLSearchParams({ page: String(hospitalPage), limit: String(pageSize) });
    const status = String(new FormData(hospitalFilterForm).get("status") || "");
    if (status) query.set("status", status);
    api.loading(hospitalsList, "Loading facility directory…");
    api.setNotice(hospitalsMessage, "");
    hospitalRecords.clear();
    try {
      const result = await api.request("/admin/hospitals?" + query.toString());
      const hospitals = api.listFrom(result);
      hospitalPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("admin-hospitals-page").textContent = "Page " + hospitalPage + " of " + hospitalPages;
      document.getElementById("admin-hospitals-prev").disabled = hospitalPage <= 1;
      document.getElementById("admin-hospitals-next").disabled = hospitalPage >= hospitalPages;
      hospitalsList.setAttribute("aria-busy", "false");
      hospitalsList.innerHTML = hospitals.length
        ? hospitals.map(renderHospital).join("")
        : '<div class="empty-state"><h3>No directory entries</h3><p>Add a facility or change the verification filter.</p></div>';
    } catch (error) {
      api.showError(hospitalsList, error.message);
      api.setNotice(hospitalsMessage, "The facility directory could not be loaded.", "error");
      document.getElementById("admin-hospitals-page").textContent = "Page " + hospitalPage;
      document.getElementById("admin-hospitals-prev").disabled = hospitalPage <= 1;
      document.getElementById("admin-hospitals-next").disabled = true;
    }
  }

  function clearHospitalForm() {
    hospitalForm.reset();
    document.getElementById("admin-hospital-id").value = "";
    document.getElementById("admin-hospital-submit").textContent = "Add directory entry";
    document.getElementById("admin-hospital-cancel").hidden = true;
  }

  hospitalForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const values = new FormData(hospitalForm);
    const groups = String(values.get("bloodGroups") || "").split(",").map(function (group) {
      return group.trim().toUpperCase();
    }).filter(Boolean);
    const body = {
      name: String(values.get("name") || "").trim(),
      city: String(values.get("city") || "").trim(),
      address: String(values.get("address") || "").trim(),
      contactNumber: String(values.get("contactNumber") || "").trim(),
      website: String(values.get("website") || "").trim(),
      operatingHours: String(values.get("operatingHours") || "").trim(),
      bloodGroups: groups
    };
    const latitude = String(values.get("latitude") || "").trim();
    const longitude = String(values.get("longitude") || "").trim();
    if (Boolean(latitude) !== Boolean(longitude)) {
      api.setNotice(hospitalsMessage, "Enter both latitude and longitude, or leave both blank.", "error");
      return;
    }
    if (latitude) {
      body.latitude = Number(latitude);
      body.longitude = Number(longitude);
    }
    const id = document.getElementById("admin-hospital-id").value;
    const submit = document.getElementById("admin-hospital-submit");
    let saved = false;
    api.setBusy(hospitalForm, true, id ? "Saving changes…" : "Adding facility…");
    try {
      await api.request(id ? "/admin/hospitals/" + encodeURIComponent(id) : "/admin/hospitals", {
        method: id ? "PATCH" : "POST",
        body: body
      });
      await loadHospitals();
      await loadAuditLogs();
      api.setNotice(hospitalsMessage, id ? "Directory entry updated." : "Directory entry added as pending verification.", "success");
      saved = true;
    } catch (error) {
      api.setNotice(hospitalsMessage, error.message, "error");
    } finally {
      api.setBusy(hospitalForm, false);
      if (saved) clearHospitalForm();
    }
  });
  document.getElementById("admin-hospital-cancel").addEventListener("click", clearHospitalForm);
  hospitalFilterForm.addEventListener("change", function () {
    hospitalPage = 1;
    loadHospitals();
  });
  document.getElementById("admin-hospitals-prev").addEventListener("click", function () {
    if (hospitalPage > 1) { hospitalPage -= 1; loadHospitals(); }
  });
  document.getElementById("admin-hospitals-next").addEventListener("click", function () {
    if (hospitalPage < hospitalPages) { hospitalPage += 1; loadHospitals(); }
  });
  hospitalsList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-edit-hospital], [data-verify-hospital], [data-verify-inventory], [data-reject-hospital], [data-remove-hospital], [data-hospital-audit]");
    if (!button) return;
    const id = button.dataset.editHospital || button.dataset.verifyHospital || button.dataset.verifyInventory ||
      button.dataset.rejectHospital || button.dataset.removeHospital || button.dataset.hospitalAudit;
    const hospital = hospitalRecords.get(id);
    if (!hospital) return;
    if (button.dataset.hospitalAudit) {
      button.disabled = true;
      try {
        const result = await api.request("/admin/hospitals/" + encodeURIComponent(id) + "/audit?limit=20");
        const entries = api.listFrom(result);
        const summary = entries.length
          ? entries.map(function (entry) {
            return (entry.action || "action") + " by " +
              (entry.admin && entry.admin.name ? entry.admin.name : "admin") +
              " on " + api.formatDate(entry.createdAt, true);
          }).join(" · ")
          : "No audit events have been recorded for this entry.";
        api.setNotice(hospitalsMessage, summary, "success");
      } catch (error) {
        api.setNotice(hospitalsMessage, error.message, "error");
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.editHospital) {
      const formValues = {
        name: hospital.name,
        city: hospital.city,
        address: hospital.address,
        contactNumber: hospital.contactNumber,
        website: hospital.website || "",
        operatingHours: hospital.operatingHours || "",
        bloodGroups: (hospital.bloodGroups || []).join(", ")
      };
      Object.entries(formValues).forEach(function (entry) {
        hospitalForm.elements[entry[0]].value = entry[1];
      });
      const coordinates = hospital.location && hospital.location.coordinates;
      hospitalForm.elements.latitude.value = coordinates ? coordinates[1] : "";
      hospitalForm.elements.longitude.value = coordinates ? coordinates[0] : "";
      document.getElementById("admin-hospital-id").value = id;
      document.getElementById("admin-hospital-submit").textContent = "Save changes";
      document.getElementById("admin-hospital-cancel").hidden = false;
      hospitalForm.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    let action;
    let body;
    let confirmation;
    if (button.dataset.verifyHospital) {
      action = "verify";
      body = { status: "Verified" };
      confirmation = "Confirm that this facility has been independently verified?";
    } else if (button.dataset.verifyInventory) {
      action = "verify inventory";
      body = { status: "Verified", inventoryVerified: true };
      confirmation = "Confirm that this facility's current blood inventory was independently verified?";
    } else if (button.dataset.rejectHospital) {
      action = "reject";
      body = { status: "Rejected" };
      confirmation = "Reject this directory entry?";
    } else {
      action = "remove";
      confirmation = "Remove this facility from the public directory? Its audit history will be retained.";
    }
    if (!window.confirm(confirmation)) return;
    button.disabled = true;
    try {
      if (action === "remove") {
        await api.request("/admin/hospitals/" + encodeURIComponent(id), { method: "DELETE" });
      } else {
        await api.request("/admin/hospitals/" + encodeURIComponent(id) + "/verification", {
          method: "PATCH",
          body: body
        });
      }
      await loadHospitals();
      await loadAuditLogs();
      api.setNotice(hospitalsMessage, "Facility directory updated.", "success");
    } catch (error) {
      api.setNotice(hospitalsMessage, error.message, "error");
      button.disabled = false;
    }
  });

  document.getElementById("refresh-stats").addEventListener("click", loadStats);
  userForm.addEventListener("submit", function (event) {
    event.preventDefault();
    userPage = 1;
    loadUsers();
  });
  document.getElementById("users-prev").addEventListener("click", function () {
    if (userPage > 1) { userPage -= 1; loadUsers(); }
  });
  document.getElementById("users-next").addEventListener("click", function () {
    if (userPage < userPages) { userPage += 1; loadUsers(); }
  });
  userBody.addEventListener("click", async function (event) {
    const verifyButton = event.target.closest("[data-verify-email-user]");
    if (verifyButton) {
      if (verifyButton.disabled || !window.confirm("Manually verify this account's email? Any outstanding verification link will be invalidated.")) return;
      verifyButton.disabled = true;
      try {
        await api.request("/admin/users/" + encodeURIComponent(verifyButton.dataset.verifyEmailUser) + "/email-verification", {
          method: "PATCH"
        });
        await loadUsers();
        await loadAuditLogs();
        api.setNotice(usersMessage, "The account email was verified by an administrator.", "success");
      } catch (error) {
        api.setNotice(usersMessage, error.message, "error");
        verifyButton.disabled = false;
      }
      return;
    }
    const resetButton = event.target.closest("[data-reset-user]");
    if (resetButton) {
      if (!window.confirm("Send a one-time password reset link to this account's verified email?")) return;
      resetButton.disabled = true;
      try {
        const result = await api.request("/admin/users/" + encodeURIComponent(resetButton.dataset.resetUser) + "/password-reset", { method: "POST" });
        await loadAuditLogs();
        api.setNotice(usersMessage, result.message || "Password reset email sent.", "success");
      } catch (error) {
        api.setNotice(usersMessage, error.message, "error");
        resetButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-user-id]");
    if (!button || button.disabled) return;
    if (button.dataset.userActive !== "true") return;
    if (!window.confirm("Deactivate this account?")) return;
    button.disabled = true;
    try {
      await api.request("/admin/users/" + encodeURIComponent(button.dataset.userId) + "/deactivate", {
        method: "PATCH"
      });
      await loadUsers();
      await loadAuditLogs();
      api.setNotice(usersMessage, "The account was deactivated.", "success");
    } catch (error) {
      api.setNotice(usersMessage, error.message, "error");
      button.disabled = false;
    }
  });

  identityReviewForm.addEventListener("change", function () {
    identityPage = 1;
    loadIdentityReviews();
  });
  document.getElementById("identity-review-prev").addEventListener("click", function () {
    if (identityPage > 1) { identityPage -= 1; loadIdentityReviews(); }
  });
  document.getElementById("identity-review-next").addEventListener("click", function () {
    if (identityPage < identityPages) { identityPage += 1; loadIdentityReviews(); }
  });
  identityReviewList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-identity-download], [data-review-identity]");
    if (!button) return;
    const card = button.closest(".admin-request-card");
    const cardButtons = Array.from(card.querySelectorAll("button"));
    cardButtons.forEach(function (item) { item.disabled = true; });
    try {
      if (button.dataset.identityDownload) {
        await api.download(
          "/admin/users/" + encodeURIComponent(button.dataset.identityDownload) + "/identity-document",
          "lifelink-identity-document"
        );
        identityDocumentsDownloaded.add(button.dataset.identityDownload);
        await loadAuditLogs();
        const currentStatus = card.querySelector(".badge").textContent.trim();
        card.querySelectorAll("[data-review-identity]").forEach(function (reviewButton) {
          reviewButton.disabled = reviewButton.dataset.reviewIdentity === currentStatus;
        });
        api.setNotice(identityReviewMessage, "Private document downloaded. Store it securely and remove local copies after review.", "success");
      } else {
        const status = button.dataset.reviewIdentity;
        const adminNote = card.querySelector("[data-identity-note]").value.trim();
        if (status === "Rejected" && !adminNote) throw new Error("Provide a review note before rejecting the document.");
        if (!window.confirm(status === "Verified"
          ? "Confirm that you manually verified the account identity?"
          : "Reject this identity document and provide the user with your review note?")) return;
        await api.request("/admin/users/" + encodeURIComponent(card.dataset.identityUser) + "/identity-verification", {
          method: "PATCH",
          body: { status: status, adminNote: adminNote }
        });
        await loadIdentityReviews();
        await loadAuditLogs();
        api.setNotice(identityReviewMessage, "Identity verification review saved.", "success");
      }
    } catch (error) {
      api.setNotice(identityReviewMessage, error.message, "error");
    } finally {
      const currentStatus = card.querySelector(".badge").textContent.trim();
      cardButtons.forEach(function (item) {
        item.disabled = item.dataset.reviewIdentity
          ? item.dataset.reviewIdentity === currentStatus || !identityDocumentsDownloaded.has(card.dataset.identityUser)
          : false;
      });
    }
  });

  reportForm.addEventListener("submit", function (event) {
    event.preventDefault();
    reportPage = 1;
    loadReports();
  });
  reportForm.addEventListener("change", function () {
    reportPage = 1;
    loadReports();
  });
  document.getElementById("reports-prev").addEventListener("click", function () {
    if (reportPage > 1) { reportPage -= 1; loadReports(); }
  });
  document.getElementById("reports-next").addEventListener("click", function () {
    if (reportPage < reportPages) { reportPage += 1; loadReports(); }
  });
  reportsList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-save-report]");
    if (!button) return;
    const card = button.closest("[data-report-card]");
    button.disabled = true;
    try {
      await api.request("/admin/reports/" + encodeURIComponent(button.dataset.saveReport), {
        method: "PATCH",
        body: {
          status: card.querySelector("[data-report-status]").value,
          adminNote: card.querySelector("[data-report-note]").value
        }
      });
      await loadReports();
      await loadAuditLogs();
      api.setNotice(reportsMessage, "Report review saved.", "success");
    } catch (error) {
      api.setNotice(reportsMessage, error.message, "error");
      button.disabled = false;
    }
  });

  reviewForm.addEventListener("change", function () {
    reviewPage = 1;
    loadReviews();
  });
  document.getElementById("reviews-prev").addEventListener("click", function () {
    if (reviewPage > 1) { reviewPage -= 1; loadReviews(); }
  });
  document.getElementById("reviews-next").addEventListener("click", function () {
    if (reviewPage < reviewPages) { reviewPage += 1; loadReviews(); }
  });
  reviewsList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-moderate-review]");
    if (!button) return;
    const card = button.closest("[data-review-card]");
    const status = button.dataset.moderateReview;
    const adminNote = card.querySelector("[data-review-note]").value.trim();
    if (status === "Rejected" && !adminNote) {
      api.setNotice(reviewsMessage, "Provide a moderation note before rejecting the review.", "error");
      return;
    }
    if (status === "Rejected" && !window.confirm("Reject this review and keep it hidden from public profiles?")) return;
    button.disabled = true;
    try {
      await api.request("/admin/reviews/" + encodeURIComponent(card.dataset.reviewCard), {
        method: "PATCH",
        body: { status: status, adminNote: adminNote }
      });
      await loadReviews();
      await loadAuditLogs();
      api.setNotice(reviewsMessage, status === "Published" ? "Review published." : "Review rejected.", "success");
    } catch (error) {
      api.setNotice(reviewsMessage, error.message, "error");
      button.disabled = false;
    }
  });

  requestForm.addEventListener("change", function () {
    requestPage = 1;
    loadRequests();
  });
  document.getElementById("admin-requests-prev").addEventListener("click", function () {
    if (requestPage > 1) { requestPage -= 1; loadRequests(); }
  });
  document.getElementById("admin-requests-next").addEventListener("click", function () {
    if (requestPage < requestPages) { requestPage += 1; loadRequests(); }
  });
  auditForm.addEventListener("submit", function (event) {
    event.preventDefault();
    auditPage = 1;
    loadAuditLogs();
  });
  auditForm.addEventListener("change", function () {
    auditPage = 1;
    loadAuditLogs();
  });
  document.getElementById("admin-audit-prev").addEventListener("click", function () {
    if (auditPage > 1) { auditPage -= 1; loadAuditLogs(); }
  });
  document.getElementById("admin-audit-next").addEventListener("click", function () {
    if (auditPage < auditPages) { auditPage += 1; loadAuditLogs(); }
  });
  supportForm.addEventListener("change", function () {
    supportPage = 1;
    loadSupportTickets();
  });
  supportForm.addEventListener("submit", function (event) {
    event.preventDefault();
    supportPage = 1;
    loadSupportTickets();
  });
  document.getElementById("admin-support-prev").addEventListener("click", function () {
    if (supportPage > 1) { supportPage -= 1; loadSupportTickets(); }
  });
  document.getElementById("admin-support-next").addEventListener("click", function () {
    if (supportPage < supportPages) { supportPage += 1; loadSupportTickets(); }
  });
  supportList.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-save-support]");
    if (!button) return;
    const card = button.closest("[data-support-ticket]");
    const ticket = supportTicketRecords.get(button.dataset.saveSupport);
    if (!ticket) return;
    const status = card.querySelector("[data-support-status]").value;
    const reply = card.querySelector("[data-support-reply]").value.trim();
    const body = {};
    if (status !== ticket.status) body.status = status;
    if (reply && reply !== String(ticket.adminReply || "").trim()) body.reply = reply;
    if (!Object.keys(body).length) {
      api.setNotice(supportMessage, "Change the status or enter a new reply before saving.", "error");
      return;
    }
    button.disabled = true;
    try {
      await api.request("/support/admin/tickets/" + encodeURIComponent(button.dataset.saveSupport), {
        method: "PATCH",
        body: body
      });
      await loadSupportTickets();
      api.setNotice(supportMessage, "Support ticket updated.", "success");
    } catch (error) {
      api.setNotice(supportMessage, error.message, "error");
      button.disabled = false;
    }
  });
  requestsList.addEventListener("click", async function (event) {
    const closeButton = event.target.closest("[data-close-request]");
    const deleteButton = event.target.closest("[data-delete-request]");
    if (closeButton) {
      if (!window.confirm("Close this request? Pending and accepted offers will be cancelled.")) return;
      closeButton.disabled = true;
      try {
        await api.request("/admin/requests/" + encodeURIComponent(closeButton.dataset.closeRequest) + "/close", { method: "PATCH" });
        await loadRequests();
        await loadAuditLogs();
        api.setNotice(requestsMessage, "The request was closed.", "success");
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
        closeButton.disabled = false;
      }
      return;
    }
    if (deleteButton) {
      if (!window.confirm("Permanently delete this request and its related offers? This cannot be undone.")) return;
      deleteButton.disabled = true;
      try {
        await api.request("/admin/requests/" + encodeURIComponent(deleteButton.dataset.deleteRequest), { method: "DELETE" });
        await loadRequests();
        await loadAuditLogs();
        api.setNotice(requestsMessage, "The request was deleted.", "success");
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
        deleteButton.disabled = false;
      }
    }
  });

  loadStats();
  loadAuditLogs();
  loadSupportTickets();
  loadUsers();
  loadRequests();
  loadReports();
  loadReviews();
  loadIdentityReviews();
  loadHospitals();
})();
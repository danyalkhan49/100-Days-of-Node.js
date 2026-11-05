(function () {
  "use strict";

  const api = window.LifeLink;
  if (!api.requireRole(["requester"])) return;

  const requestForm = document.getElementById("request-form");
  const requestFormMessage = document.getElementById("request-form-message");
  const requestsList = document.getElementById("my-requests-list");
  const requestsMessage = document.getElementById("my-requests-message");
  const donorForm = document.getElementById("donor-search-form");
  const donorResults = document.getElementById("donor-results");
  const donorMessage = document.getElementById("donor-search-message");
  const contactDialog = document.getElementById("contact-dialog");
  const contactDetails = document.getElementById("contact-details");
  const reportDialog = document.getElementById("report-dialog");
  const reportForm = document.getElementById("report-form");
  const pageSize = 6;
  const offerPageSize = 10;
  let requestPage = 1;
  let requestPages = 1;
  let donorPage = 1;
  let donorPages = 1;
  let editingRequestId = null;
  let requestSubmissionInFlight = false;
  let requestsCache = [];
  let donorSearchHasRun = false;
  let nearbyCoordinates = null;

  function localDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function setDateLimits() {
    const input = document.getElementById("request-needed-by");
    const now = new Date();
    const max = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    input.min = localDateTime(now);
    input.max = localDateTime(max);
  }

  function checkNeededBy(value) {
    const date = new Date(value);
    const now = new Date();
    const latest = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(date.getTime()) || date <= now || date > latest) {
      throw new Error("Choose a future date and time within the next 30 days.");
    }
    return date.toISOString();
  }

  function resetRequestForm() {
    editingRequestId = null;
    requestForm.reset();
    document.getElementById("request-form-heading").textContent = "Create a request";
    document.getElementById("request-submit").textContent = "Post request";
    document.getElementById("cancel-edit").hidden = true;
    document.getElementById("request-patient").disabled = false;
    document.getElementById("request-blood-group").disabled = false;
    document.getElementById("request-units").value = "1";
    api.setFormMessage(requestFormMessage, "");
    setDateLimits();
  }

  function editRequest(request) {
    editingRequestId = request._id || request.id;
    document.getElementById("request-form-heading").textContent = "Edit open request";
    document.getElementById("request-submit").textContent = "Save changes";
    document.getElementById("cancel-edit").hidden = false;
    document.getElementById("request-patient").value = request.patientName || "";
    document.getElementById("request-patient").disabled = true;
    document.getElementById("request-blood-group").value = request.bloodGroup || "";
    document.getElementById("request-blood-group").disabled = true;
    document.getElementById("request-units").value = String(request.unitsNeeded || 1);
    document.getElementById("request-hospital").value = request.hospital || "";
    document.getElementById("request-city").value = request.city || "";
    document.getElementById("request-urgency").value = request.urgency || "Normal";
    document.getElementById("request-needed-by").value = localDateTime(request.neededBy);
    document.getElementById("request-note").value = request.note || "";
    setDateLimits();
    document.getElementById("request-form-heading").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function requestQuery() {
    const status = document.getElementById("my-request-status").value;
    const query = new URLSearchParams({ page: String(requestPage), limit: String(pageSize) });
    if (status) query.set("status", status);
    return query.toString();
  }

  function renderRequest(item) {
    const id = api.escapeHtml(item._id || item.id);
    const status = item.status || "Open";
    const canClose = status === "Open";
    const prescription = Boolean(item.prescription);
    const pendingOffers = Number(item.pendingOffers || item.pendingOfferCount || 0);
    return '<article class="my-request-card" data-request-card="' + id + '">' +
      '<div class="my-request-top"><div><span class="badge ' + api.statusClass(status) + '">' + api.escapeHtml(status) + '</span>' +
      '<h3>' + api.escapeHtml(item.patientName || "Blood request") + "</h3></div><span class=\"badge blood-badge\">" +
      api.escapeHtml(item.bloodGroup || "—") + "</span></div>" +
      '<p class="request-hospital">' + api.escapeHtml(item.hospital || "Hospital not provided") + " · " + api.escapeHtml(item.city || "City not provided") + "</p>" +
      '<div class="request-meta"><span>' + api.escapeHtml(String(item.unitsFulfilled || 0)) + " of " + api.escapeHtml(String(item.unitsNeeded || 1)) +
      " units fulfilled</span><span>Needed " + api.escapeHtml(api.formatDate(item.neededBy, true)) + "</span>" +
      '<span class="badge urgency-' + api.escapeHtml(String(item.urgency || "Normal").toLowerCase()) + '">' + api.escapeHtml(item.urgency || "Normal") + "</span></div>" +
      (item.note ? '<p class="request-note">' + api.escapeHtml(item.note) + "</p>" : "") +
      '<div class="my-request-actions">' +
      '<button class="button button-outline" type="button" data-action="offers" data-request-id="' + id + '" aria-expanded="false">View offers' +
      (pendingOffers ? " (" + api.escapeHtml(String(pendingOffers)) + " pending)" : "") + "</button>" +
      (status === "Open" ? '<button class="button button-outline" type="button" data-action="edit" data-request-id="' + id + '">Edit request</button>' : "") +
      (canClose ? '<button class="button button-quiet" type="button" data-action="close" data-request-id="' + id + '">Close request</button>' : "") +
      (prescription ? '<button class="button button-quiet" type="button" data-action="download" data-request-id="' + id + '">Download prescription</button>' : "") +
      "</div>" +
      (status !== "Fulfilled" && status !== "Closed" ? '<form class="upload-row prescription-form" data-prescription-form data-request-id="' + id + '">' +
        '<div class="field"><label for="prescription-' + id + '">Prescription <span class="label-optional">PDF, JPG, or PNG</span></label>' +
        '<input id="prescription-' + id + '" name="prescription" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required></div>' +
        '<button class="button button-outline" type="submit">' + (prescription ? "Replace file" : "Upload file") + "</button></form>" : "") +
      '<div class="form-message" data-request-message></div>' +
      '<div class="request-offers-panel" data-offers-panel hidden><h4>Offers on this request</h4><label class="sr-only" for="offer-status-' + id + '">Filter offers by status</label>' +
      '<select id="offer-status-' + id + '" data-offer-status><option value="">All offers</option><option>Pending</option><option>Accepted</option><option>Declined</option><option>Completed</option><option>Canceled</option></select>' +
      '<div class="stack-list" data-request-offers aria-busy="false"></div>' +
      '<nav class="pagination pagination-compact" data-offer-pagination aria-label="Offer pages"><button class="button button-outline button-small" type="button" data-offer-prev disabled>Previous</button>' +
      '<span data-offer-page aria-live="polite">Page 1</span><button class="button button-outline button-small" type="button" data-offer-next disabled>Next</button></nav></div></article>';
  }

  async function loadRequests() {
    api.loading(requestsList, "Loading your requests…");
    api.setNotice(requestsMessage, "");
    try {
      const result = await api.request("/requests/my?" + requestQuery());
      requestsCache = api.listFrom(result);
      requestPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("my-requests-page").textContent = "Page " + requestPage + " of " + requestPages;
      document.getElementById("my-requests-prev").disabled = requestPage <= 1;
      document.getElementById("my-requests-next").disabled = requestPage >= requestPages;
      requestsList.setAttribute("aria-busy", "false");
      requestsList.innerHTML = requestsCache.length
        ? requestsCache.map(renderRequest).join("")
        : '<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>No requests to show</h3><p>Your requests will appear here after you post them.</p></div>';
    } catch (error) {
      api.showError(requestsList, error.message);
      api.setNotice(requestsMessage, "Your requests could not be refreshed.", "error");
    }
  }

  function renderOffer(offer, request) {
    const donor = offer.donor && typeof offer.donor === "object" ? offer.donor : {};
    const status = offer.status || "Pending";
    const offerId = api.escapeHtml(offer._id || offer.id);
    const requestOpen = request.status === "Open";
    const completion = offer.completion || {};
    const actions = [];
    if (status === "Pending" && requestOpen) {
      actions.push('<button class="button button-primary" type="button" data-action="accept" data-offer-id="' + offerId + '">Accept</button>');
      actions.push('<button class="button button-outline" type="button" data-action="decline" data-offer-id="' + offerId + '">Decline</button>');
    }
    if (status === "Accepted") {
      actions.push('<span class="field-hint">Your confirmation: ' +
        (completion.requesterConfirmedAt ? "recorded" : "not yet recorded") + " · Donor confirmation: " +
        (completion.donorConfirmedAt ? "recorded" : "not yet recorded") + "</span>");
      if (!completion.requesterConfirmedAt) {
        actions.push('<button class="button button-primary" type="button" data-action="complete" data-offer-id="' + offerId + '">Confirm donation completed</button>');
      }
      actions.push('<button class="button button-outline" type="button" data-action="contact" data-offer-id="' + offerId + '">Show contact</button>');
    }
    if (status === "Completed") {
      if (completion.requesterOutcome) {
        actions.push('<span class="field-hint">Your donation outcome: ' +
          api.escapeHtml(completion.requesterOutcome) + " · " +
          api.escapeHtml(api.formatDate(completion.requesterOutcomeAt)) + "</span>");
      } else {
        actions.push('<form class="donation-outcome-form" data-donation-outcome data-offer-id="' + offerId + '">' +
          '<div class="field"><label for="donation-outcome-' + offerId + '">Confirm the donation outcome</label>' +
          '<select id="donation-outcome-' + offerId + '" name="outcome" required>' +
          '<option value="">Choose an outcome</option><option value="Confirmed">Donation Confirmed</option>' +
          '<option value="Did Not Happen">Donation Did Not Happen</option><option value="Problem">Report a Problem</option></select></div>' +
          '<div class="field"><label for="donation-outcome-note-' + offerId + '">Note <span class="label-optional">Optional</span></label>' +
          '<textarea id="donation-outcome-note-' + offerId + '" name="note" maxlength="500" rows="2"></textarea>' +
          '<span class="field-hint">Do not include phone numbers, CNIC details, or sensitive medical information.</span></div>' +
          '<button class="button button-outline button-small" type="submit">Submit outcome</button></form>');
      }
    }
    return '<div class="offer-row"><div class="offer-person">' +
      '<span class="avatar avatar-placeholder" aria-hidden="true">' + api.escapeHtml((donor.bloodGroup || "?").slice(0, 2)) + "</span>" +
      "<div><strong>" + api.escapeHtml(donor.name || "Donor") + "</strong><span>" +
      api.escapeHtml(donor.bloodGroup || "Blood group unavailable") + " · " + api.escapeHtml(donor.city || "City unavailable") +
      (donor.lastDonationDate ? " · Last donated " + api.escapeHtml(api.formatDate(donor.lastDonationDate)) : "") +
      "</span>" + (offer.message ? '<span class="offer-message">' + api.escapeHtml(offer.message) + "</span>" : "") +
      '<span class="badge ' + api.statusClass(status) + '">' + api.escapeHtml(status) + "</span></div></div>" +
      '<div class="offer-row-actions">' + actions.join("") + "</div></div>";
  }

  async function loadOffersForCard(card) {
    const requestId = card.dataset.requestCard;
    const panel = card.querySelector("[data-offers-panel]");
    const container = panel.querySelector("[data-request-offers]");
    const trigger = card.querySelector('[data-action="offers"]');
    if (!panel.hidden && container.dataset.loaded === "true") {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      return;
    }
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    api.loading(container, "Loading offers…");
    const status = panel.querySelector("[data-offer-status]").value;
    const page = Number(card.dataset.offerPage) || 1;
    const query = new URLSearchParams({ page: String(page), limit: String(offerPageSize) });
    if (status) query.set("status", status);
    try {
      const result = await api.request("/offers/request/" + encodeURIComponent(requestId) + (query.size ? "?" + query.toString() : ""));
      const offers = api.listFrom(result);
      const request = requestsCache.find(function (item) { return String(item._id || item.id) === requestId; }) || {};
      const pagination = result.pagination || {};
      const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
      card.dataset.offerPages = String(totalPages);
      panel.querySelector("[data-offer-page]").textContent = "Page " + page + " of " + totalPages;
      panel.querySelector("[data-offer-prev]").disabled = page <= 1;
      panel.querySelector("[data-offer-next]").disabled = page >= totalPages;
      container.dataset.loaded = "true";
      container.setAttribute("aria-busy", "false");
      container.innerHTML = offers.length
        ? offers.map(function (offer) { return renderOffer(offer, request); }).join("")
        : '<div class="empty-state"><h3>No offers match this filter</h3><p>Offers will appear here when donors respond.</p></div>';
    } catch (error) {
      container.dataset.loaded = "false";
      api.showError(container, error.message);
    }
  }

  function donorQuery() {
    const values = new FormData(donorForm);
    const query = new URLSearchParams({ page: String(donorPage), limit: String(pageSize) });
    ["bloodGroup", "city", "search"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    if (values.get("eligibleOnly")) query.set("eligibleOnly", "true");
    if (nearbyCoordinates) {
      query.set("latitude", String(nearbyCoordinates.latitude));
      query.set("longitude", String(nearbyCoordinates.longitude));
      query.set("radiusKm", document.getElementById("nearby-radius").value);
      query.set("sortBy", "distance");
      query.set("order", "asc");
    }
    return query.toString();
  }

  function renderDonor(donor) {
    const avatar = donor.avatar
      ? '<img class="avatar" alt="" src="/uploads/avatars/' + encodeURIComponent(donor.avatar) + '">'
      : '<span class="avatar avatar-placeholder" aria-hidden="true">L</span>';
    const eligible = donor.eligible === true;
    const donorId = api.escapeHtml(donor._id || donor.id);
    return '<article class="donor-card">' + avatar + '<div><strong>' + api.escapeHtml(donor.name || "Donor") +
      '</strong><p>' + api.escapeHtml(donor.city || "City not provided") + " · Last donation " +
      api.escapeHtml(donor.lastDonationDate ? api.formatDate(donor.lastDonationDate) : "No prior donation recorded") + '</p></div><span class="badge blood-badge">' +
      api.escapeHtml(donor.bloodGroup || "—") + '</span><span class="badge ' + (eligible ? "badge-success" : "badge-neutral") + '">' +
      (eligible ? "Eligible" : "Not eligible") + '</span>' +
      (Number.isFinite(donor.distanceKm) ? '<span class="badge badge-neutral">' + api.escapeHtml(String(donor.distanceKm)) + ' km away</span>' : "") +
      '<span class="badge badge-neutral">' + api.escapeHtml(String(donor.totalDonations || 0)) + ' completed</span>' +
      '<span class="badge badge-neutral">' + (Number.isFinite(donor.averageRating)
        ? api.escapeHtml(String(donor.averageRating)) + " / 5 · " + api.escapeHtml(String(donor.reviewCount || 0)) + " reviews"
        : "No published reviews") + '</span>' +
      (Array.isArray(donor.badges) ? donor.badges.map(function (badge) {
        return '<span class="badge badge-success">' + api.escapeHtml(badge) + "</span>";
      }).join("") : "") +
      '<div class="card-actions"><button class="button button-quiet button-small" type="button" data-report-user="' +
      donorId + '">Report</button><button class="button button-quiet button-small" type="button" data-block-user="' + donorId + '">Block</button></div></article>';
  }

  async function searchDonors() {
    api.loading(donorResults, "Searching available donors…");
    api.setNotice(donorMessage, "");
    try {
      const result = await api.request("/donors?" + donorQuery());
      const donors = api.listFrom(result);
      donorPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("donors-page").textContent = "Page " + donorPage + " of " + donorPages;
      document.getElementById("donors-prev").disabled = donorPage <= 1;
      document.getElementById("donors-next").disabled = donorPage >= donorPages;
      donorResults.setAttribute("aria-busy", "false");
      donorResults.innerHTML = donors.length
        ? donors.map(renderDonor).join("")
        : '<div class="empty-state"><h3>No matching donors found</h3><p>Try another city or search term. The server only returns active, available donor profiles.</p></div>';
    } catch (error) {
      api.showError(donorResults, error.message);
      api.setNotice(donorMessage, "The donor search could not be completed.", "error");
    }
  }

  requestForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (requestSubmissionInFlight) return;
    api.setFormMessage(requestFormMessage, "");
    if (!requestForm.reportValidity()) return;
    const values = new FormData(requestForm);
    let neededBy;
    try {
      neededBy = checkNeededBy(values.get("neededBy"));
    } catch (error) {
      api.setFormMessage(requestFormMessage, error.message, "error");
      document.getElementById("request-needed-by").focus();
      return;
    }
    const body = {
      unitsNeeded: Number(values.get("unitsNeeded")),
      hospital: String(values.get("hospital")).trim(),
      city: String(values.get("city")).trim(),
      urgency: values.get("urgency"),
      neededBy: neededBy,
      note: String(values.get("note") || "").trim()
    };
    if (!editingRequestId) {
      body.patientName = String(values.get("patientName")).trim();
      body.bloodGroup = values.get("bloodGroup");
    }
    const wasEditing = Boolean(editingRequestId);
    let saved = false;
    requestSubmissionInFlight = true;
    api.setBusy(requestForm, true, wasEditing ? "Saving…" : "Posting…");
    try {
      await api.request(wasEditing ? "/requests/" + encodeURIComponent(editingRequestId) : "/requests", {
        method: wasEditing ? "PUT" : "POST",
        body: body
      });
      saved = true;
      await loadRequests();
      api.setNotice(requestsMessage, wasEditing ? "Your request was updated." : "Your request was posted.", "success");
    } catch (error) {
      api.setFormMessage(requestFormMessage, error.message, "error");
    } finally {
      requestSubmissionInFlight = false;
      api.setBusy(requestForm, false);
      if (saved) resetRequestForm();
    }
  });

  document.getElementById("cancel-edit").addEventListener("click", resetRequestForm);
  document.getElementById("my-request-filter").addEventListener("change", function () {
    requestPage = 1;
    loadRequests();
  });
  document.getElementById("my-requests-prev").addEventListener("click", function () {
    if (requestPage > 1) { requestPage -= 1; loadRequests(); }
  });
  document.getElementById("my-requests-next").addEventListener("click", function () {
    if (requestPage < requestPages) { requestPage += 1; loadRequests(); }
  });

  requestsList.addEventListener("change", function (event) {
    if (!event.target.matches("[data-offer-status]")) return;
    const card = event.target.closest("[data-request-card]");
    card.dataset.offerPage = "1";
    card.querySelector("[data-request-offers]").dataset.loaded = "false";
    loadOffersForCard(card);
  });

  requestsList.addEventListener("submit", async function (event) {
    const outcomeForm = event.target.closest("[data-donation-outcome]");
    if (outcomeForm) {
      event.preventDefault();
      if (!outcomeForm.reportValidity()) return;
      const values = new FormData(outcomeForm);
      api.setBusy(outcomeForm, true, "Submitting…");
      try {
        const result = await api.request(
          "/offers/" + encodeURIComponent(outcomeForm.dataset.offerId) + "/requester-outcome",
          {
            method: "PATCH",
            body: {
              outcome: String(values.get("outcome")),
              note: String(values.get("note") || "").trim()
            }
          }
        );
        const card = outcomeForm.closest("[data-request-card]");
        const panel = card.querySelector("[data-offers-panel]");
        if (panel && !panel.hidden) {
          panel.querySelector("[data-request-offers]").dataset.loaded = "false";
          await loadOffersForCard(card);
        }
        api.setNotice(requestsMessage, result.message || "Your outcome was recorded.", "success");
      } catch (error) {
        api.setFormMessage(outcomeForm.querySelector(".form-message"), error.message, "error");
        api.setBusy(outcomeForm, false);
      }
      return;
    }
    const form = event.target.closest("[data-prescription-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const file = form.querySelector('input[type="file"]').files[0];
    if (!file) return;
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    const allowedExtensions = /\.(pdf|jpe?g|png)$/i;
    if (!allowedTypes.includes(file.type) && !allowedExtensions.test(file.name)) {
      form.querySelector("[data-request-message]").textContent = "Choose a PDF, JPG, or PNG file.";
      return;
    }
    const body = new FormData();
    body.append("prescription", file);
    api.setBusy(form, true, "Uploading…");
    try {
      await api.request("/requests/" + encodeURIComponent(form.dataset.requestId) + "/prescription", { method: "POST", body: body });
      const card = form.closest("[data-request-card]");
      api.setFormMessage(card.querySelector("[data-request-message]"), "Prescription uploaded.", "success");
      await loadRequests();
    } catch (error) {
      api.setFormMessage(form.closest("[data-request-card]").querySelector("[data-request-message]"), error.message, "error");
      api.setBusy(form, false);
    }
  });

  requestsList.addEventListener("click", async function (event) {
    const previousOfferPage = event.target.closest("[data-offer-prev]");
    const nextOfferPage = event.target.closest("[data-offer-next]");
    if (previousOfferPage || nextOfferPage) {
      const card = event.target.closest("[data-request-card]");
      const currentPage = Number(card.dataset.offerPage) || 1;
      const lastPage = Number(card.dataset.offerPages) || 1;
      if (previousOfferPage && currentPage > 1) card.dataset.offerPage = String(currentPage - 1);
      if (nextOfferPage && currentPage < lastPage) card.dataset.offerPage = String(currentPage + 1);
      card.querySelector("[data-request-offers]").dataset.loaded = "false";
      await loadOffersForCard(card);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const card = button.closest("[data-request-card]");
    const requestId = button.dataset.requestId || card.dataset.requestCard;
    const request = requestsCache.find(function (item) { return String(item._id || item.id) === requestId; });

    if (action === "offers") {
      loadOffersForCard(card);
      return;
    }
    if (action === "edit") {
      if (request) {
        button.disabled = true;
        try {
          const result = await api.request("/offers/request/" + encodeURIComponent(requestId) + "?status=Accepted");
          if (api.listFrom(result).length) {
            api.setNotice(requestsMessage, "This request cannot be edited while it has an accepted offer.", "error");
          } else {
            editRequest(request);
          }
        } catch (error) {
          api.setNotice(requestsMessage, error.message, "error");
        } finally {
          button.disabled = false;
        }
      }
      return;
    }
    if (action === "close") {
      if (!window.confirm("Close this request? Pending and accepted offers will be cancelled.")) return;
      button.disabled = true;
      try {
        await api.request("/requests/" + encodeURIComponent(requestId) + "/close", { method: "PUT" });
        await loadRequests();
        api.setNotice(requestsMessage, "The request was closed and its active offers were cancelled.", "success");
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
        button.disabled = false;
      }
      return;
    }
    if (action === "download") {
      button.disabled = true;
      try {
        await api.download("/requests/" + encodeURIComponent(requestId) + "/prescription", "prescription");
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (["accept", "decline", "complete"].includes(action)) {
      const messages = {
        accept: "Accept this donor offer?",
        decline: "Decline this donor offer?",
        complete: "Confirm that this donation was completed? This confirmation is shared with the donor."
      };
      if (!window.confirm(messages[action])) return;
      button.disabled = true;
      try {
        const result = await api.request(
          "/offers/" + encodeURIComponent(button.dataset.offerId) +
            (action === "complete" ? "/confirm-completion" : "/" + action),
          { method: "PUT", body: action === "complete" ? {} : undefined }
        );
        const panel = card.querySelector("[data-offers-panel]");
        if (panel && !panel.hidden) {
          card.dataset.offerPage = "1";
          panel.querySelector("[data-request-offers]").dataset.loaded = "false";
          await loadOffersForCard(card);
        }
        await loadRequests();
        const defaultMessage = { accept: "Offer accepted.", decline: "Offer declined.", complete: "Donation marked complete." };
        api.setNotice(requestsMessage, result.message || defaultMessage[action], "success");
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
        button.disabled = false;
      }
      return;
    }
    if (action === "contact") {
      button.disabled = true;
      try {
        const result = await api.request("/offers/" + encodeURIComponent(button.dataset.offerId) + "/contact");
        const contact = result.data || result;
        contactDetails.innerHTML = "<strong>" + api.escapeHtml(contact.name || "Donor") + "</strong>" +
          (contact.phone ? '<a href="tel:' + api.escapeHtml(contact.phone) + '">' + api.escapeHtml(contact.phone) + "</a>" : "<span>Phone number not provided.</span>");
        contactDialog.showModal();
      } catch (error) {
        api.setNotice(requestsMessage, error.message, "error");
      } finally {
        button.disabled = false;
      }
    }
  });

  donorForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!donorForm.reportValidity()) return;
    donorPage = 1;
    donorSearchHasRun = true;
    const nearby = document.getElementById("nearby-search").checked;
    if (!nearby) {
      nearbyCoordinates = null;
      searchDonors();
      return;
    }
    if (!navigator.geolocation) {
      api.setNotice(donorMessage, "Nearby search is not supported by this browser.", "error");
      return;
    }
    const button = donorForm.querySelector('[type="submit"]');
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(function (position) {
      nearbyCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      button.disabled = false;
      searchDonors();
    }, function () {
      nearbyCoordinates = null;
      button.disabled = false;
      api.setNotice(donorMessage, "Location access was not available. Search by city instead.", "error");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });

  reportForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!reportForm.reportValidity()) return;
    const values = new FormData(reportForm);
    api.setFormMessage(document.getElementById("report-form-message"), "");
    api.setBusy(reportForm, true, "Submitting…");
    try {
      const result = await api.request("/reports/users/" + encodeURIComponent(reportForm.dataset.target), {
        method: "POST",
        body: {
          reason: String(values.get("reason")),
          description: String(values.get("description") || "").trim()
        }
      });
      reportDialog.close();
      reportForm.reset();
      api.setNotice(donorMessage, result.message || "Your report was submitted for review.", "success");
    } catch (error) {
      api.setFormMessage(document.getElementById("report-form-message"), error.message, "error");
    } finally {
      api.setBusy(reportForm, false);
    }
  });

  donorResults.addEventListener("click", async function (event) {
    const reportButton = event.target.closest("[data-report-user]");
    const blockButton = event.target.closest("[data-block-user]");
    if (reportButton) {
      reportForm.dataset.target = reportButton.dataset.reportUser;
      reportForm.reset();
      api.setFormMessage(document.getElementById("report-form-message"), "");
      reportDialog.showModal();
      return;
    }
    if (blockButton) {
      if (!window.confirm("Block this donor? They will no longer appear in donor search and you cannot offer or share contact details with each other.")) return;
      blockButton.disabled = true;
      try {
        await api.request("/reports/users/" + encodeURIComponent(blockButton.dataset.blockUser) + "/block", { method: "POST", body: {} });
        api.setNotice(donorMessage, "Donor blocked.", "success");
        await searchDonors();
      } catch (error) {
        api.setNotice(donorMessage, error.message, "error");
        blockButton.disabled = false;
      }
    }
  });
  document.getElementById("donors-prev").addEventListener("click", function () {
    if (donorPage > 1 && donorSearchHasRun) { donorPage -= 1; searchDonors(); }
  });
  document.getElementById("donors-next").addEventListener("click", function () {
    if (donorPage < donorPages && donorSearchHasRun) { donorPage += 1; searchDonors(); }
  });

  setDateLimits();
  document.getElementById("my-requests-page").textContent = "Page 1";
  document.getElementById("donors-page").textContent = "Search to begin";
  requestsList.innerHTML = '<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>Your requests will appear here</h3><p>Post a request to review offers, manage its status, and coordinate with donors.</p></div>';
  donorResults.innerHTML = '<div class="empty-state"><span class="empty-mark" aria-hidden="true">+</span><h3>Search for compatible donors</h3><p>Choose a recipient blood group to see available profiles that match the request.</p></div>';
  loadRequests();
})();
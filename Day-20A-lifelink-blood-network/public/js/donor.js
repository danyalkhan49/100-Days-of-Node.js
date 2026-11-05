(function () {
  "use strict";

  const api = window.LifeLink;
  if (!api.requireRole(["donor"])) return;

  const profileMessage = document.getElementById("profile-message");
  const profileForm = document.getElementById("profile-form");
  const profileFormMessage = document.getElementById("profile-form-message");
  const avatarForm = document.getElementById("avatar-form");
  const avatarMessage = document.getElementById("avatar-message");
  const offersList = document.getElementById("donor-offers");
  const offersMessage = document.getElementById("offers-message");
  const dialog = document.getElementById("contact-dialog");
  const contactDetails = document.getElementById("contact-details");
  const offerFilter = document.getElementById("offer-status-filter");
  const offerPrev = document.getElementById("offers-prev");
  const offerNext = document.getElementById("offers-next");
  const offerPageLabel = document.getElementById("offers-page");
  const offerPageSize = 10;
  let offerPage = 1;
  let offerPages = 1;

  function avatarPath(filename) {
    if (!filename) return "";
    if (String(filename).startsWith("/uploads/avatars/")) return String(filename);
    return "/uploads/avatars/" + encodeURIComponent(filename);
  }

  function renderProfile(profile) {
    document.getElementById("profile-name").value = profile.name || "";
    document.getElementById("profile-phone").value = profile.phone || "";
    document.getElementById("profile-city-input").value = profile.city || "";
    document.getElementById("profile-available").checked = profile.isAvailable !== false;
    document.getElementById("profile-display-name").textContent = profile.name || "Donor profile";
    document.getElementById("profile-city").textContent = profile.city || "City not set";
    document.getElementById("profile-blood-group").textContent = profile.bloodGroup || "Blood group unavailable";

    const image = document.getElementById("donor-avatar");
    const placeholder = document.getElementById("avatar-placeholder");
    if (profile.avatar) {
      image.src = avatarPath(profile.avatar);
      image.alt = "Profile photo for " + (profile.name || "donor");
      image.hidden = false;
      placeholder.hidden = true;
      image.onerror = function () {
        image.hidden = true;
        placeholder.hidden = false;
      };
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      placeholder.hidden = false;
    }
  }

  async function loadProfile() {
    api.setNotice(profileMessage, "");
    try {
      const result = await api.request("/users/me");
      renderProfile(result.data || result);
    } catch (error) {
      api.setNotice(profileMessage, error.message, "error");
    }
  }

  async function loadDonationSummary() {
    const container = document.getElementById("donation-summary");
    api.loading(container, "Loading donation history…");
    try {
      const result = await api.request("/users/me/donations?page=1&limit=10");
      const summary = result.data || result;
      const donations = Array.isArray(summary.history) ? summary.history : [];
      container.setAttribute("aria-busy", "false");
      container.innerHTML = '<article class="offer-card"><strong>' + api.escapeHtml(String(summary.totalDonations || 0)) +
        ' completed donation(s)</strong><p>Last donation: ' + api.escapeHtml(summary.lastDonationDate ? api.formatDate(summary.lastDonationDate) : "Not recorded") +
        '</p><p>Badges: ' + api.escapeHtml((summary.badges || []).join(", ") || "No donation badges yet") + "</p></article>" +
        (donations.length ? donations.map(function (item) {
          return '<article class="offer-card"><strong>' + api.escapeHtml(item.request && item.request.bloodGroup || "Donation") +
            ' · ' + api.escapeHtml(item.request && item.request.city || "City unavailable") + '</strong><p>Completed ' +
            api.escapeHtml(api.formatDate(item.completedAt || item.updatedAt)) + "</p></article>";
        }).join("") : "");
    } catch (error) {
      api.showError(container, error.message);
    }
  }

  function renderOffer(offer) {
    const request = offer.request && typeof offer.request === "object" ? offer.request : {};
    const status = offer.status || "Pending";
    const completion = offer.completion || {};
    const statusClass = api.statusClass(status);
    const isContactAvailable = status === "Accepted";
    const canCancel = status === "Pending" || status === "Accepted";
    return '<article class="offer-card" data-offer-card="' + api.escapeHtml(offer._id || offer.id) + '">' +
      '<div class="offer-card-top"><span class="badge ' + statusClass + '">' + api.escapeHtml(status) + '</span><span class="field-hint">' +
      api.escapeHtml(api.formatDate(offer.createdAt)) + "</span></div>" +
      '<h3>' + api.escapeHtml(request.patientName || "Blood request") + "</h3>" +
      '<p>' + api.escapeHtml(request.hospital || "Hospital not provided") + " · " + api.escapeHtml(request.city || "City not provided") + "</p>" +
      '<p>' + api.escapeHtml(request.urgency || "Normal") + " · Needed " + api.escapeHtml(api.formatDate(request.neededBy, true)) + "</p>" +
      (offer.message ? '<p class="offer-message">' + api.escapeHtml(offer.message) + "</p>" : "") +
      (status === "Accepted" ? '<p class="field-hint">Your confirmation: ' +
        (completion.donorConfirmedAt ? "recorded" : "not yet recorded") + " · Requester confirmation: " +
        (completion.requesterConfirmedAt ? "recorded" : "not yet recorded") + "</p>" : "") +
      '<div class="card-actions">' +
      (isContactAvailable ? '<button class="button button-outline button-small" type="button" data-contact-offer="' + api.escapeHtml(offer._id || offer.id) + '">Show contact</button>' : "") +
      (status === "Accepted" && !completion.donorConfirmedAt
        ? '<button class="button button-primary button-small" type="button" data-confirm-completion="' + api.escapeHtml(offer._id || offer.id) + '">Confirm donation completed</button>'
        : "") +
      (canCancel ? '<button class="button button-quiet button-small" type="button" data-cancel-offer="' + api.escapeHtml(offer._id || offer.id) + '">Cancel offer</button>' : "") +
      "</div><div class=\"form-message\" data-offer-message></div></article>";
  }

  async function loadOffers() {
    api.loading(offersList, "Loading your offers…");
    api.setNotice(offersMessage, "");
    const query = new URLSearchParams({ page: String(offerPage), limit: String(offerPageSize) });
    if (offerFilter.value) query.set("status", offerFilter.value);
    try {
      const result = await api.request("/offers/my?" + query.toString());
      const offers = api.listFrom(result);
      offerPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      offerPageLabel.textContent = "Page " + offerPage + " of " + offerPages;
      offerPrev.disabled = offerPage <= 1;
      offerNext.disabled = offerPage >= offerPages;
      offersList.setAttribute("aria-busy", "false");
      offersList.innerHTML = offers.length
        ? offers.map(renderOffer).join("")
        : '<div class="empty-state"><span class="empty-mark" aria-hidden="true">—</span><h3>No offers to show</h3><p>When you make an offer on an open request, it will appear here.</p><a class="text-link" href="requests.html">Browse open requests <span aria-hidden="true">→</span></a></div>';
    } catch (error) {
      offerPageLabel.textContent = "Page " + offerPage;
      offerPrev.disabled = offerPage <= 1;
      offerNext.disabled = true;
      api.showError(offersList, error.message);
    }
  }

  profileForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(profileFormMessage, "");
    if (!profileForm.reportValidity()) return;
    const values = new FormData(profileForm);
    const body = {
      name: String(values.get("name")).trim(),
      phone: String(values.get("phone")).trim(),
      city: String(values.get("city")).trim(),
      isAvailable: document.getElementById("profile-available").checked
    };
    api.setBusy(profileForm, true, "Saving…");
    try {
      const result = await api.request("/users/me", { method: "PUT", body: body });
      renderProfile(result.data || result);
      api.setFormMessage(profileFormMessage, "Your profile was updated.", "success");
    } catch (error) {
      api.setFormMessage(profileFormMessage, error.message, "error");
    } finally {
      api.setBusy(profileForm, false);
    }
  });

  avatarForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    api.setFormMessage(avatarMessage, "");
    const fileInput = document.getElementById("avatar-file");
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      api.setFormMessage(avatarMessage, "Choose an image before uploading.", "error");
      return;
    }
    if (!file.type.startsWith("image/")) {
      api.setFormMessage(avatarMessage, "Choose an image file. The server will also validate its type and size.", "error");
      return;
    }
    const formData = new FormData();
    formData.append("avatar", file);
    api.setBusy(avatarForm, true, "Uploading…");
    try {
      await api.request("/users/me/avatar", { method: "POST", body: formData });
      fileInput.value = "";
      api.setFormMessage(avatarMessage, "Your profile photo was uploaded.", "success");
      await loadProfile();
    } catch (error) {
      api.setFormMessage(avatarMessage, error.message, "error");
    } finally {
      api.setBusy(avatarForm, false);
    }
  });

  document.getElementById("save-search-location").addEventListener("click", function (event) {
    const button = event.currentTarget;
    const message = document.getElementById("location-message");
    api.setFormMessage(message, "");
    if (!navigator.geolocation) {
      api.setFormMessage(message, "This browser does not support location access.", "error");
      return;
    }
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(async function (position) {
      try {
        const result = await api.request("/users/me/location", {
          method: "PUT",
          body: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }
        });
        api.setFormMessage(message, result.message || "Search location saved privately.", "success");
      } catch (error) {
        api.setFormMessage(message, error.message, "error");
      } finally {
        button.disabled = false;
      }
    }, function () {
      api.setFormMessage(message, "Location access was not available.", "error");
      button.disabled = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
  document.getElementById("remove-search-location").addEventListener("click", async function (event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api.request("/users/me/location", { method: "DELETE" });
      api.setFormMessage(document.getElementById("location-message"), result.message || "Saved search location removed.", "success");
    } catch (error) {
      api.setFormMessage(document.getElementById("location-message"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  offerFilter.addEventListener("change", function () {
    offerPage = 1;
    loadOffers();
  });
  offerPrev.addEventListener("click", function () {
    if (offerPage > 1) {
      offerPage -= 1;
      loadOffers();
    }
  });
  offerNext.addEventListener("click", function () {
    if (offerPage < offerPages) {
      offerPage += 1;
      loadOffers();
    }
  });

  offersList.addEventListener("click", async function (event) {
    const contactButton = event.target.closest("[data-contact-offer]");
    const cancelButton = event.target.closest("[data-cancel-offer]");
    const confirmButton = event.target.closest("[data-confirm-completion]");
    if (contactButton) {
      contactButton.disabled = true;
      try {
        const result = await api.request("/offers/" + encodeURIComponent(contactButton.dataset.contactOffer) + "/contact");
        const contact = result.data || result;
        contactDetails.innerHTML = "<strong>" + api.escapeHtml(contact.name || "Contact") + "</strong>" +
          (contact.phone ? '<a href="tel:' + api.escapeHtml(contact.phone) + '">' + api.escapeHtml(contact.phone) + "</a>" : "<span>Phone number not provided.</span>");
        dialog.showModal();
      } catch (error) {
        api.setNotice(offersMessage, error.message, "error");
      } finally {
        contactButton.disabled = false;
      }
      return;
    }
    if (confirmButton) {
      if (!window.confirm("Confirm that this donation was completed? This confirmation is shared with the requester.")) return;
      confirmButton.disabled = true;
      try {
        const result = await api.request(
          "/offers/" + encodeURIComponent(confirmButton.dataset.confirmCompletion) + "/confirm-completion",
          { method: "PUT", body: {} }
        );
        await loadOffers();
        api.setNotice(offersMessage, result.message || "Your confirmation was recorded.", "success");
      } catch (error) {
        api.setNotice(offersMessage, error.message, "error");
        confirmButton.disabled = false;
      }
      return;
    }
    if (cancelButton) {
      if (!window.confirm("Cancel this offer?")) return;
      cancelButton.disabled = true;
      try {
        await api.request("/offers/" + encodeURIComponent(cancelButton.dataset.cancelOffer) + "/cancel", { method: "PUT" });
        offerPage = 1;
        await loadOffers();
        api.setNotice(offersMessage, "The offer was cancelled.", "success");
      } catch (error) {
        api.setNotice(offersMessage, error.message, "error");
        cancelButton.disabled = false;
      }
    }
  });

  loadProfile();
  loadDonationSummary();
  loadOffers();
})();
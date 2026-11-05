(function () {
  "use strict";

  const api = window.LifeLink;
  if (!api.requireRole(["donor", "requester", "admin"])) return;
  const blocks = document.getElementById("blocked-users");
  const blocksMessage = document.getElementById("blocks-message");
  const emailForm = document.getElementById("resend-email-form");
  const passwordForm = document.getElementById("change-password-form");
  const phoneSendForm = document.getElementById("send-phone-code-form");
  const phoneVerifyForm = document.getElementById("verify-phone-form");
  const identityDocumentForm = document.getElementById("identity-document-form");
  const reviewActivity = document.getElementById("review-activity");
  const reviewOffers = document.getElementById("review-offers");
  const reviewPageSize = 10;
  let reviewPage = 1;
  let reviewPages = 1;

  passwordForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!passwordForm.reportValidity()) return;
    const values = new FormData(passwordForm);
    const currentPassword = String(values.get("currentPassword") || "");
    const newPassword = String(values.get("newPassword") || "");
    const confirmation = String(values.get("confirmNewPassword") || "");
    const message = document.getElementById("change-password-message");
    if (newPassword !== confirmation) {
      api.setFormMessage(message, "The new passwords do not match.", "error");
      return;
    }
    api.setFormMessage(message, "");
    api.setBusy(passwordForm, true, "Changing…");
    try {
      const result = await api.request("/auth/change-password", {
        method: "PUT",
        body: { currentPassword: currentPassword, newPassword: newPassword }
      });
      passwordForm.reset();
      api.setFormMessage(message, result.message || "Password changed. Sign in again.", "success");
      window.setTimeout(function () {
        api.clearSession();
        window.location.assign("index.html#account");
      }, 1200);
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(passwordForm, false);
    }
  });

  function renderReviewOffer(item) {
    const offerId = api.escapeHtml(item.offerId);
    const existing = item.review;
    const status = existing && existing.status;
    const statusMessage = status === "Pending"
      ? '<p class="field-hint">Submitted for administrator moderation.</p>'
      : status === "Published"
        ? '<p class="field-hint">Your review has been published.</p>'
        : status === "Rejected"
          ? '<p class="field-hint">Your review was not published. You can revise and resubmit it.</p>'
          : "";
    if (existing && status !== "Rejected") {
      return '<article class="offer-card"><div class="offer-card-top"><strong>' + api.escapeHtml(item.reviewee.name || "Participant") +
        '</strong><span class="badge ' + api.statusClass(status) + '">' + api.escapeHtml(status) + '</span></div><p>' +
        api.escapeHtml(item.patientName || "Completed donation") + " · " + api.escapeHtml(item.city || "City unavailable") +
        " · Completed " + api.escapeHtml(api.formatDate(item.completedAt)) + '</p><p>Rating: ' +
        api.escapeHtml(String(existing.rating)) + " / 5</p>" + (existing.comment
          ? "<p>" + api.escapeHtml(existing.comment) + "</p>" : "") + statusMessage + "</article>";
    }
    const selectedRating = existing ? Number(existing.rating) : 5;
    const ratingOptions = [5, 4, 3, 2, 1].map(function (rating) {
      return '<option value="' + rating + '"' + (rating === selectedRating ? " selected" : "") + ">" +
        rating + (rating === 1 ? " star" : " stars") + "</option>";
    }).join("");
    return '<article class="offer-card"><strong>' + api.escapeHtml(item.reviewee.name || "Participant") +
      '</strong><p>' + api.escapeHtml(item.patientName || "Completed donation") + " · " +
      api.escapeHtml(item.city || "City unavailable") + " · Completed " + api.escapeHtml(api.formatDate(item.completedAt)) +
      '</p>' + statusMessage + '<form class="form-stack" data-review-form data-offer-id="' + offerId + '">' +
      '<div class="field"><label for="review-rating-' + offerId + '">Rating</label><select id="review-rating-' + offerId +
      '" name="rating" required>' + ratingOptions + '</select></div>' +
      '<div class="field"><label for="review-comment-' + offerId + '">Comment <span class="label-optional">Optional, up to 500 characters</span></label>' +
      '<textarea id="review-comment-' + offerId + '" name="comment" maxlength="500" rows="3">' +
      api.escapeHtml(existing && existing.comment || "") + '</textarea></div>' +
      '<p class="form-message" data-review-message role="status" aria-live="polite"></p>' +
      '<button class="button button-outline button-small" type="submit">' + (existing ? "Resubmit review" : "Submit review") +
      "</button></form></article>";
  }

  async function loadReviewOffers() {
    const query = new URLSearchParams({ page: String(reviewPage), limit: String(reviewPageSize) });
    api.loading(reviewOffers, "Loading completed donations…");
    api.setNotice(document.getElementById("reviews-message"), "");
    try {
      const result = await api.request("/reviews/eligible-offers?" + query.toString());
      const offers = api.listFrom(result);
      reviewPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      document.getElementById("review-offers-page").textContent = "Page " + reviewPage + " of " + reviewPages;
      document.getElementById("review-offers-prev").disabled = reviewPage <= 1;
      document.getElementById("review-offers-next").disabled = reviewPage >= reviewPages;
      reviewOffers.setAttribute("aria-busy", "false");
      reviewOffers.innerHTML = offers.length
        ? offers.map(renderReviewOffer).join("")
        : '<div class="empty-state"><h3>No completed donations yet</h3><p>Completed donations will appear here when they are ready for a review.</p></div>';
    } catch (error) {
      api.showError(reviewOffers, error.message);
      api.setNotice(document.getElementById("reviews-message"), "Completed donations could not be loaded.", "error");
      document.getElementById("review-offers-page").textContent = "Page " + reviewPage;
      document.getElementById("review-offers-prev").disabled = reviewPage <= 1;
      document.getElementById("review-offers-next").disabled = true;
    }
  }

  async function loadProfile() {
    const result = await api.request("/users/me");
    const profile = result.data || result;
    document.getElementById("email-status").textContent = profile.emailVerified ? "Verified" : "Not verified";
    document.getElementById("email-address").textContent = profile.email || "";
    document.getElementById("resend-email-button").hidden = profile.emailVerified === true;
    document.getElementById("phone-status").textContent = profile.phoneVerified ? "Verified" : "Not verified";
    document.getElementById("phone-number").textContent = profile.phone || "";
    document.getElementById("send-phone-code-button").hidden = profile.phoneVerified === true;
    phoneVerifyForm.hidden = profile.phoneVerified === true;
    document.getElementById("identity-verification-status").textContent =
      String(profile.identityVerificationStatus || "NotSubmitted").replace(/([a-z])([A-Z])/g, "$1 $2");
    const reviewNote = document.getElementById("identity-review-note");
    reviewNote.textContent = profile.identityReviewNote || "";
    reviewNote.hidden = !profile.identityReviewNote;
    document.getElementById("identity-document-submit").textContent =
      profile.identityVerificationStatus === "Pending" ? "Replace pending document" : "Submit for review";
    document.getElementById("withdraw-identity-document").hidden =
      !profile.identityVerificationStatus || profile.identityVerificationStatus === "NotSubmitted";
  }

  async function loadBlocks() {
    blocks.setAttribute("aria-busy", "true");
    try {
      const result = await api.request("/users/me/blocks");
      const items = api.listFrom(result);
      blocks.setAttribute("aria-busy", "false");
      blocks.innerHTML = items.length
        ? items.map(function (item) {
          const user = item.user || {};
          return '<article class="offer-card"><div><strong>' + api.escapeHtml(user.name || "Account") +
            '</strong><p class="field-hint">Blocked ' + api.escapeHtml(api.formatDate(item.createdAt)) +
            '</p></div><button class="button button-outline button-small" type="button" data-unblock="' +
            api.escapeHtml(user.id || "") + '">Unblock</button></article>';
        }).join("")
        : '<div class="empty-state"><h3>No blocked accounts</h3></div>';
    } catch (error) {
      api.showError(blocks, error.message);
      api.setNotice(blocksMessage, "Blocked accounts could not be loaded.", "error");
    }
  }

  emailForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const message = document.getElementById("email-message");
    api.setFormMessage(message, "");
    api.setBusy(emailForm, true, "Sending…");
    try {
      const profile = await api.request("/users/me");
      const email = (profile.data || profile).email;
      const result = await api.request("/auth/resend-verification", {
        method: "POST", body: { email }, redirectOn401: false
      });
      api.setFormMessage(message, result.message || "If your account needs verification, a link has been sent.", "success");
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(emailForm, false);
    }
  });

  phoneSendForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const message = document.getElementById("phone-send-message");
    api.setFormMessage(message, "");
    api.setBusy(phoneSendForm, true, "Sending…");
    try {
      const result = await api.request("/users/me/phone-otp", { method: "POST", body: {} });
      api.setFormMessage(message, (result.message || "Verification code sent.") + " The code expires in five minutes.", "success");
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(phoneSendForm, false);
    }
  });

  phoneVerifyForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!phoneVerifyForm.reportValidity()) return;
    const message = document.getElementById("phone-verify-message");
    api.setFormMessage(message, "");
    const code = String(new FormData(phoneVerifyForm).get("code")).trim();
    api.setBusy(phoneVerifyForm, true, "Verifying…");
    try {
      const result = await api.request("/users/me/verify-phone", { method: "POST", body: { code } });
      api.setFormMessage(message, result.message || "Phone verified.", "success");
      phoneVerifyForm.reset();
      await loadProfile();
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(phoneVerifyForm, false);
    }
  });

  identityDocumentForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!identityDocumentForm.reportValidity()) return;
    const file = document.getElementById("identity-document-file").files[0];
    if (!file) return;
    const message = document.getElementById("identity-document-message");
    api.setFormMessage(message, "");
    api.setBusy(identityDocumentForm, true, "Encrypting and submitting…");
    try {
      const body = new FormData(identityDocumentForm);
      body.set("consent", "true");
      const result = await api.request("/users/me/identity-document", { method: "POST", body: body });
      api.setFormMessage(message, result.message || "Identity document submitted for review.", "success");
      identityDocumentForm.reset();
      await loadProfile();
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(identityDocumentForm, false);
    }
  });

  document.getElementById("withdraw-identity-document").addEventListener("click", async function (event) {
    if (!window.confirm("Withdraw identity verification and permanently delete your uploaded document?")) return;
    const button = event.currentTarget;
    const message = document.getElementById("identity-document-message");
    button.disabled = true;
    try {
      const result = await api.request("/users/me/identity-document", { method: "DELETE" });
      api.setFormMessage(message, result.message || "Identity document removed.", "success");
      await loadProfile();
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  blocks.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-unblock]");
    if (!button) return;
    button.disabled = true;
    try {
      await api.request("/users/" + encodeURIComponent(button.dataset.unblock) + "/block", { method: "DELETE" });
      api.setNotice(blocksMessage, "Account unblocked.", "success");
      await loadBlocks();
    } catch (error) {
      button.disabled = false;
      api.setNotice(blocksMessage, error.message, "error");
    }
  });

  reviewOffers.addEventListener("submit", async function (event) {
    const form = event.target.closest("[data-review-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const message = form.querySelector("[data-review-message]");
    api.setFormMessage(message, "");
    api.setBusy(form, true, "Submitting…");
    try {
      const result = await api.request("/reviews/" + encodeURIComponent(form.dataset.offerId), {
        method: "POST",
        body: { rating: Number(values.get("rating")), comment: String(values.get("comment") || "").trim() }
      });
      await loadReviewOffers();
      api.setNotice(document.getElementById("reviews-message"), result.message || "Review submitted for moderation.", "success");
    } catch (error) {
      api.setFormMessage(message, error.message, "error");
    } finally {
      api.setBusy(form, false);
    }
  });

  document.getElementById("review-offers-prev").addEventListener("click", function () {
    if (reviewPage > 1) {
      reviewPage -= 1;
      loadReviewOffers();
    }
  });
  document.getElementById("review-offers-next").addEventListener("click", function () {
    if (reviewPage < reviewPages) {
      reviewPage += 1;
      loadReviewOffers();
    }
  });

  if (api.session().role === "admin") {
    reviewActivity.hidden = true;
  } else {
    loadReviewOffers();
  }
  loadProfile().catch(function (error) {
    api.setNotice(document.getElementById("account-message"), error.message, "error");
  });
  loadBlocks();
})();

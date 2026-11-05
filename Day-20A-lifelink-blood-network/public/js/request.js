(function () {
  "use strict";

  const api = window.LifeLink;
  const detail = document.getElementById("request-detail");
  const message = document.getElementById("request-message");
  const heading = document.getElementById("request-heading");
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || !/^[a-f\d]{24}$/i.test(id)) {
    api.showError(detail, "This request link is invalid.");
    api.setNotice(message, "This request link is invalid or unavailable.", "error");
    return;
  }

  function renderRequest(request) {
    const url = new URL("request.html?id=" + encodeURIComponent(request._id || id), window.location.href).href;
    const shareText = "LifeLink blood request: " + (request.bloodGroup || "blood") + " needed in " +
      (request.city || "your area") + (request.hospital ? " at " + request.hospital : "") + ". " + url;
    heading.textContent = (request.bloodGroup || "Blood") + " request in " + (request.city || "your area");
    detail.setAttribute("aria-busy", "false");
    detail.innerHTML = '<div class="request-detail-top"><span class="badge blood-badge">' +
      api.escapeHtml(request.bloodGroup || "—") + '</span><span class="badge urgency-' +
      api.escapeHtml(String(request.urgency || "Normal").toLowerCase()) + '">' +
      api.escapeHtml(request.urgency || "Normal") + '</span></div>' +
      '<h2>' + api.escapeHtml(request.hospital || "Hospital not provided") + '</h2>' +
      '<dl class="request-detail-meta"><div><dt>City</dt><dd>' + api.escapeHtml(request.city || "Not provided") +
      '</dd></div><div><dt>Units needed</dt><dd>' + api.escapeHtml(String(request.unitsNeeded || 1)) +
      '</dd></div><div><dt>Units fulfilled</dt><dd>' + api.escapeHtml(String(request.unitsFulfilled || 0)) +
      '</dd></div><div><dt>Needed by</dt><dd>' + api.escapeHtml(api.formatDate(request.neededBy, true)) +
      '</dd></div></dl>' + (request.note ? '<p class="request-note">' + api.escapeHtml(request.note) + '</p>' : '') +
      '<div class="request-share-actions">' +
      '<button class="button button-primary" type="button" data-share>Share request</button>' +
      '<button class="button button-outline" type="button" data-copy>Copy link</button>' +
      '<a class="button button-outline" href="https://wa.me/?text=' + encodeURIComponent(shareText) +
      '" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>' +
      '<a class="button button-quiet" href="requests.html">Back to open requests</a></div>' +
      '<p class="form-message" data-share-message role="status" aria-live="polite"></p>';

    const shareMessage = detail.querySelector("[data-share-message]");
    detail.querySelector("[data-copy]").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(url);
        api.setFormMessage(shareMessage, "Request link copied.", "success");
      } catch {
        api.setFormMessage(shareMessage, "Copy was unavailable. Select and copy the page address from your browser.", "error");
      }
    });
    detail.querySelector("[data-share]").addEventListener("click", async function () {
      if (!navigator.share) {
        api.setFormMessage(shareMessage, "Sharing is unavailable in this browser. Use Copy link or WhatsApp.", "error");
        return;
      }
      try {
        await navigator.share({ title: "LifeLink blood request", text: shareText, url: url });
      } catch (error) {
        if (error.name !== "AbortError") api.setFormMessage(shareMessage, "The request could not be shared. Try copying the link.", "error");
      }
    });
  }

  (async function loadRequest() {
    try {
      const response = await api.request("/requests/" + encodeURIComponent(id));
      renderRequest(response.data);
    } catch (error) {
      api.showError(detail, error.message);
      api.setNotice(message, "This request is closed, expired, deleted, or unavailable.", "error");
    }
  })();
})();

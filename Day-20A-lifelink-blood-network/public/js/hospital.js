(function () {
  "use strict";

  const api = window.LifeLink;
  const detail = document.getElementById("hospital-detail");
  const message = document.getElementById("hospital-detail-message");
  const name = document.getElementById("hospital-name");
  const id = new URLSearchParams(window.location.search).get("id");

  async function loadHospital() {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      name.textContent = "Facility not found";
      api.setNotice(message, "This directory link is invalid.", "error");
      return;
    }
    api.loading(detail, "Loading facility details…");
    try {
      const result = await api.request("/hospitals/" + encodeURIComponent(id), { redirectOn401: false });
      const hospital = result.data || result;
      name.textContent = hospital.name || "Facility details";
      const groups = hospital.inventoryVerified && hospital.verificationStatus === "Verified"
        ? hospital.bloodGroups || []
        : [];
      const coordinates = hospital.location && hospital.location.coordinates;
      const map = Array.isArray(coordinates)
        ? '<p><a class="text-link" href="https://www.google.com/maps/search/?api=1&amp;query=' +
          encodeURIComponent(coordinates[1] + "," + coordinates[0]) +
          '" target="_blank" rel="noopener noreferrer">Open location in maps</a></p>'
        : "";
      let website = "";
      if (hospital.website) {
        try {
          const websiteUrl = new URL(hospital.website);
          if (['http:', 'https:'].includes(websiteUrl.protocol) &&
              !websiteUrl.username && !websiteUrl.password) {
            website = '<p><a class="text-link" href="' + api.escapeHtml(websiteUrl.href) +
              '" target="_blank" rel="noopener noreferrer">Visit facility website</a></p>';
          }
        } catch {
          // Ignore invalid legacy URLs; admin writes validate new values.
        }
      }
      detail.setAttribute("aria-busy", "false");
      detail.innerHTML = '<article class="panel"><div class="panel-heading"><div><p class="eyebrow">' +
        api.escapeHtml(hospital.city || "City not provided") + '</p><h2>' +
        api.escapeHtml(hospital.name || "Facility") + '</h2></div><span class="badge ' +
        api.statusClass(hospital.verificationStatus) + '">' +
        api.escapeHtml(hospital.verificationStatus || "Pending") + '</span></div><p><strong>Address:</strong> ' +
        api.escapeHtml(hospital.address || "Not provided") + '</p><p><strong>Contact:</strong> ' +
        api.escapeHtml(hospital.contactNumber || "Not provided") + '</p>' +
        (hospital.operatingHours ? '<p><strong>Operating hours:</strong> ' + api.escapeHtml(hospital.operatingHours) + '</p>' : "") +
        (groups.length
          ? '<p><strong>Reported blood groups:</strong> ' + api.escapeHtml(groups.join(", ")) +
            ' <span class="badge badge-success">Inventory verified ' + api.escapeHtml(api.formatDate(hospital.inventoryVerifiedAt)) + '</span></p>'
          : '<p class="field-hint">Blood availability is not currently verified. Contact the facility directly to confirm.</p>') +
        website + map + '</article><p class="field-hint">Directory information can change. Contact the facility directly before travelling or making care decisions.</p>';
    } catch (error) {
      api.showError(detail, error.message);
      api.setNotice(message, "Facility details could not be loaded.", "error");
      name.textContent = "Facility details unavailable";
    }
  }

  loadHospital();
})();

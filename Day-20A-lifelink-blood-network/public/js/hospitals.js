(function () {
  "use strict";

  const api = window.LifeLink;
  const form = document.getElementById("hospital-filters");
  const list = document.getElementById("hospital-directory-list");
  const message = document.getElementById("hospital-directory-message");
  const pageLabel = document.getElementById("hospital-page");
  const pageSize = 10;
  let page = 1;
  let pages = 1;
  let userCoordinates = null;

  function hospitalCard(hospital) {
    const groups = hospital.inventoryVerified && hospital.verificationStatus === "Verified"
      ? hospital.bloodGroups || []
      : [];
    const groupText = groups.length
      ? '<p><strong>Reported blood groups:</strong> ' + api.escapeHtml(groups.join(", ")) + ' <span class="badge badge-success">Inventory verified</span></p>'
      : "";
    const distance = Number.isFinite(hospital.distanceKm)
      ? '<span class="badge badge-neutral">' + api.escapeHtml(String(hospital.distanceKm)) + ' km away</span>'
      : "";
    const website = hospital.website
      ? '<a class="text-link" href="' + api.escapeHtml(hospital.website) + '" target="_blank" rel="noopener noreferrer">Visit website</a>'
      : "";
    const mapLink = hospital.location && Array.isArray(hospital.location.coordinates)
      ? '<a class="text-link" href="https://www.google.com/maps/search/?api=1&amp;query=' +
        encodeURIComponent(hospital.location.coordinates[1] + "," + hospital.location.coordinates[0]) +
        '" target="_blank" rel="noopener noreferrer">Open map</a>'
      : "";
    return '<article class="panel"><div class="panel-heading"><div><p class="eyebrow">' +
      api.escapeHtml(hospital.city || "City not provided") + '</p><span class="badge ' +
      api.statusClass(hospital.verificationStatus) + '">' + api.escapeHtml(hospital.verificationStatus || "Pending") +
      '</span><h3><a href="hospital.html?id=' +
      encodeURIComponent(String(hospital._id || "")) + '">' +
      api.escapeHtml(hospital.name || "Facility") + '</a></h3></div>' + distance + '</div>' +
      '<p>' + api.escapeHtml(hospital.address || "Address not provided") + '</p>' +
      '<p><strong>Contact:</strong> ' + api.escapeHtml(hospital.contactNumber || "Not provided") + '</p>' +
      (hospital.operatingHours ? '<p><strong>Hours:</strong> ' + api.escapeHtml(hospital.operatingHours) + '</p>' : "") +
      groupText + '<div class="card-actions">' + website + mapLink + '</div></article>';
  }

  async function loadHospitals() {
    const values = new FormData(form);
    const query = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    ["search", "city", "bloodGroup"].forEach(function (key) {
      const value = String(values.get(key) || "").trim();
      if (value) query.set(key, value);
    });
    if (userCoordinates) {
      query.set("latitude", String(userCoordinates.latitude));
      query.set("longitude", String(userCoordinates.longitude));
      query.set("radiusKm", document.getElementById("hospital-radius").value);
    }
    api.loading(list, "Loading hospitals and blood banks…");
    api.setNotice(message, "");
    try {
      const result = await api.request("/hospitals?" + query.toString(), { redirectOn401: false });
      const hospitals = api.listFrom(result);
      pages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      pageLabel.textContent = "Page " + page + " of " + pages;
      document.getElementById("hospital-prev").disabled = page <= 1;
      document.getElementById("hospital-next").disabled = page >= pages;
      list.setAttribute("aria-busy", "false");
      list.innerHTML = hospitals.length
        ? hospitals.map(hospitalCard).join("")
        : '<div class="empty-state"><h3>No facilities found</h3><p>Try a different city or search term.</p></div>';
    } catch (error) {
      api.showError(list, error.message);
      pageLabel.textContent = "Page " + page;
      document.getElementById("hospital-prev").disabled = page <= 1;
      document.getElementById("hospital-next").disabled = true;
      api.setNotice(message, "The hospital directory could not be loaded.", "error");
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    page = 1;
    loadHospitals();
  });
  document.getElementById("hospital-prev").addEventListener("click", function () {
    if (page > 1) { page -= 1; loadHospitals(); }
  });
  document.getElementById("hospital-next").addEventListener("click", function () {
    if (page < pages) { page += 1; loadHospitals(); }
  });
  document.getElementById("hospital-nearby").addEventListener("click", function () {
    if (!navigator.geolocation) {
      api.setNotice(message, "This browser does not support location sharing.", "error");
      return;
    }
    api.setNotice(message, "Waiting for location permission…", "success");
    navigator.geolocation.getCurrentPosition(function (position) {
      userCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      page = 1;
      loadHospitals();
    }, function (error) {
      const description = error.code === error.PERMISSION_DENIED
        ? "Location permission was denied. You can still search by city."
        : error.code === error.TIMEOUT
          ? "Location lookup timed out. Please try again or search by city."
          : "Your location could not be determined. You can still search by city.";
      api.setNotice(message, description, "error");
    }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 });
  });
  document.getElementById("hospital-radius").addEventListener("change", function () {
    if (userCoordinates) {
      page = 1;
      loadHospitals();
    }
  });

  loadHospitals();
})();

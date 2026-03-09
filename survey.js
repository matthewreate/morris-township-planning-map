const HOTSPOT_CATEGORIES = [
  { id: "sidewalk_gap", label: "Sidewalk gap", color: "#b85b3e" },
  { id: "unsafe_crossing", label: "Unsafe crossing", color: "#9e3a35" },
  { id: "visibility_issue", label: "Visibility issue", color: "#7c5d32" },
  { id: "speeding_concern", label: "Speeding concern", color: "#85564b" },
  { id: "accessibility_barrier", label: "Accessibility barrier", color: "#4f7077" },
  { id: "general_hotspot", label: "General hotspot", color: "#5f6573" },
];

const DESTINATION_CATEGORIES = [
  { id: "park", label: "Park", color: "#2e6f63" },
  { id: "school", label: "School", color: "#3d6380" },
  { id: "trail_access", label: "Trail access", color: "#466d52" },
  { id: "civic", label: "Civic destination", color: "#505c79" },
  { id: "business", label: "Business area", color: "#76604a" },
];

const surveyState = {
  map: null,
  capturePending: false,
  captureMarker: null,
  surveyRecords: [],
};

const elements = {
  mapStatus: document.getElementById("survey-map-status"),
  form: document.getElementById("survey-form"),
  submissionType: document.getElementById("submission-type"),
  categoryLabel: document.getElementById("category-label"),
  categorySelect: document.getElementById("category-select"),
  locationLabel: document.getElementById("location-label"),
  locationText: document.getElementById("location-text"),
  originAreaField: document.getElementById("origin-area-field"),
  originArea: document.getElementById("origin-area"),
  desiredDestinationField: document.getElementById("desired-destination-field"),
  desiredDestination: document.getElementById("desired-destination"),
  descriptionLabel: document.getElementById("description-label"),
  descriptionText: document.getElementById("description-text"),
  captureMapPoint: document.getElementById("survey-capture-map-point"),
  cancelCapture: document.getElementById("survey-cancel-capture"),
  captureBanner: document.getElementById("survey-capture-banner"),
  captureStatus: document.getElementById("survey-capture-status"),
  latitude: document.getElementById("survey-latitude"),
  longitude: document.getElementById("survey-longitude"),
  confirmation: document.getElementById("survey-confirmation"),
  confirmationText: document.getElementById("survey-confirmation-text"),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    showMapFailure();
    disableMapCapture("Map click capture is unavailable until the survey map loads.");
  });
});

async function init() {
  bindForm();
  renderFormMode();

  const [surveyRecords, hotspots, destinations] = await Promise.all([
    loadJSON("data/survey-sample-submissions.json", []),
    loadGeoJSON("data/hotspots.geojson"),
    loadGeoJSON("data/destinations.geojson"),
  ]);

  surveyState.surveyRecords = surveyRecords;

  if (!ensureLeafletAvailable()) {
    disableMapCapture("Map click capture is unavailable until the survey map loads.");
    return;
  }

  initializeMap();
  buildOfficialHotspots(hotspots.features);
  buildDestinationContext(destinations.features);
  buildSurveyRecords(surveyRecords);
}

async function loadGeoJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }

  return response.json();
}

async function loadJSON(path, fallback = []) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }

  return response.json() || fallback;
}

function initializeMap() {
  const map = L.map("survey-map", {
    center: [40.7965, -74.4815],
    zoom: 13,
    zoomControl: true,
    preferCanvas: true,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    pane: "overlayPane",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  map.createPane("officialPane");
  map.getPane("officialPane").style.zIndex = 410;

  map.createPane("destinationPane");
  map.getPane("destinationPane").style.zIndex = 420;

  map.createPane("surveyPane");
  map.getPane("surveyPane").style.zIndex = 440;

  map.createPane("capturePane");
  map.getPane("capturePane").style.zIndex = 450;

  map.on("click", handleMapClick);
  surveyState.map = map;
  hideMapFailure();
}

function buildOfficialHotspots(features) {
  features.forEach((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const category = getHotspotCategory(feature.properties.category);

    L.circleMarker([latitude, longitude], {
      pane: "officialPane",
      radius: 4,
      fillColor: category.color,
      color: "#fffaf3",
      weight: 1.5,
      fillOpacity: 0.28,
      opacity: 0.55,
      interactive: false,
    }).addTo(surveyState.map);
  });
}

function buildDestinationContext(features) {
  features.forEach((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const category = getDestinationCategory(feature.properties.category);

    L.circleMarker([latitude, longitude], {
      pane: "destinationPane",
      radius: 5,
      fillColor: category.color,
      color: "#fffaf3",
      weight: 1.5,
      fillOpacity: 0.5,
      opacity: 0.7,
    })
      .bindPopup(
        `<div class="map-popup"><h3>${escapeHtml(feature.properties.title)}</h3><p>Reference destination</p></div>`,
        {
          className: "map-popup",
          maxWidth: 240,
        },
      )
      .addTo(surveyState.map);
  });
}

function buildSurveyRecords(records) {
  records
    .filter((record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude))
    .forEach((record) => {
      const category = getSurveyCategory(record);

      L.circleMarker([record.latitude, record.longitude], {
        pane: "surveyPane",
        radius: 7,
        fillColor: "#ffffff",
        color: category.color,
        weight: 3,
        fillOpacity: 0.94,
      })
        .bindPopup(buildSurveyPopup(record), {
          className: "map-popup",
          maxWidth: 260,
        })
        .addTo(surveyState.map);
    });
}

function bindForm() {
  elements.submissionType.addEventListener("change", renderFormMode);
  elements.captureMapPoint.addEventListener("click", toggleCaptureMode);
  elements.cancelCapture.addEventListener("click", cancelCaptureMode);
  elements.form.addEventListener("submit", handleSubmit);
}

function renderFormMode() {
  const mode = elements.submissionType.value;
  const isDestinationMode = mode === "destination_request";

  const categories = isDestinationMode ? DESTINATION_CATEGORIES : HOTSPOT_CATEGORIES;
  elements.categoryLabel.textContent = isDestinationMode ? "Destination type" : "Issue type";
  elements.locationLabel.textContent = isDestinationMode ? "Starting area or nearby location" : "Nearby street or location";
  elements.locationText.placeholder = isDestinationMode
    ? "Example: neighborhood streets south of Woodland Ave"
    : "Example: Columbia Turnpike near Woodland School";
  elements.descriptionLabel.textContent = isDestinationMode ? "What gets in the way" : "Problem description";
  elements.descriptionText.placeholder = isDestinationMode
    ? "Describe what makes this walking or biking connection difficult."
    : "Describe the location and what feels difficult, unsafe, or incomplete.";
  elements.originAreaField.hidden = !isDestinationMode;
  elements.desiredDestinationField.hidden = !isDestinationMode;

  elements.categorySelect.innerHTML = categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category.id)}">${escapeHtml(category.label)}</option>`,
    )
    .join("");
}

function toggleCaptureMode() {
  if (!surveyState.map) {
    return;
  }

  if (surveyState.capturePending) {
    cancelCaptureMode();
    return;
  }

  surveyState.capturePending = true;
  document.body.classList.add("map-capture-active");
  elements.captureBanner.hidden = false;
  elements.captureMapPoint.textContent = "Cancel map capture";
  elements.captureStatus.textContent =
    "Map capture is active. Click once on the survey map to place this location.";
}

function handleMapClick(event) {
  if (!surveyState.capturePending) {
    return;
  }

  elements.latitude.value = event.latlng.lat.toFixed(5);
  elements.longitude.value = event.latlng.lng.toFixed(5);
  renderCaptureMarker(event.latlng);
  elements.captureStatus.textContent =
    "Coordinates captured from the map. You can adjust them manually if needed before submitting.";
  surveyState.capturePending = false;
  elements.captureBanner.hidden = true;
  elements.captureMapPoint.textContent = "Capture from map click";
  document.body.classList.remove("map-capture-active");
}

function cancelCaptureMode() {
  surveyState.capturePending = false;
  elements.captureBanner.hidden = true;
  elements.captureMapPoint.textContent = "Capture from map click";
  elements.captureStatus.textContent =
    "Coordinates are optional. You can type a location or place a point directly on the map.";
  document.body.classList.remove("map-capture-active");
}

function renderCaptureMarker(latlng) {
  if (!surveyState.captureMarker) {
    surveyState.captureMarker = L.circleMarker(latlng, {
      pane: "capturePane",
      radius: 8,
      fillColor: "#ffffff",
      color: "#27566b",
      weight: 3,
      fillOpacity: 0.92,
      dashArray: "4 3",
    }).addTo(surveyState.map);
    return;
  }

  surveyState.captureMarker.setLatLng(latlng);
}

function clearCaptureMarker() {
  if (!surveyState.captureMarker || !surveyState.map) {
    return;
  }

  surveyState.map.removeLayer(surveyState.captureMarker);
  surveyState.captureMarker = null;
}

function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.form);
  const mode = formData.get("submission_type");
  const payload = {
    id: `draft-${Date.now()}`,
    submission_type: mode,
    category: formData.get("category"),
    title:
      mode === "destination_request"
        ? `Connection request to ${formData.get("desired_destination") || "destination"}`
        : formData.get("location_text"),
    latitude: formData.get("latitude") || null,
    longitude: formData.get("longitude") || null,
    location_text: formData.get("location_text"),
    origin_area: formData.get("origin_area") || "",
    description: formData.get("description"),
    desired_destination: formData.get("desired_destination") || "",
    concern_mode: formData.getAll("concern_mode"),
    review_status: "under_review",
    submitted_at: new Date().toISOString().slice(0, 10),
    additional_notes: formData.get("additional_notes") || "",
  };

  elements.confirmation.hidden = false;
  elements.confirmationText.textContent =
    mode === "destination_request"
      ? `Prototype destination request captured for review: ${payload.origin_area || payload.location_text} to ${payload.desired_destination || "destination not specified"}. This is not yet being stored live.`
      : `Prototype trouble-spot report captured for review: ${payload.location_text || "location not specified"}. This is not yet being stored live.`;

  elements.form.reset();
  renderFormMode();
  elements.latitude.value = "";
  elements.longitude.value = "";
  clearCaptureMarker();
  cancelCaptureMode();
}

function buildSurveyPopup(record) {
  const category = getSurveyCategory(record);
  return `
    <div class="map-popup">
      <h3>${escapeHtml(record.title)}</h3>
      <p>${escapeHtml(category.label)} · Under review</p>
    </div>
  `;
}

function getSurveyCategory(record) {
  return record.submission_type === "destination_request"
    ? getDestinationCategory(record.category)
    : getHotspotCategory(record.category);
}

function getHotspotCategory(categoryId) {
  return HOTSPOT_CATEGORIES.find((category) => category.id === categoryId) || {
    id: categoryId,
    label: formatCategoryLabel(categoryId),
    color: "#5f6573",
  };
}

function getDestinationCategory(categoryId) {
  return DESTINATION_CATEGORIES.find((category) => category.id === categoryId) || {
    id: categoryId,
    label: formatCategoryLabel(categoryId),
    color: "#6b7a8a",
  };
}

function ensureLeafletAvailable() {
  return typeof window.L !== "undefined";
}

function showMapFailure() {
  elements.mapStatus.hidden = false;
}

function hideMapFailure() {
  elements.mapStatus.hidden = true;
}

function disableMapCapture(message) {
  elements.captureMapPoint.disabled = true;
  elements.captureStatus.textContent = message;
}

function formatCategoryLabel(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

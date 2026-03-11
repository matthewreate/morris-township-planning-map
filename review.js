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

const REVIEW_STATUS_LABELS = {
  under_review: "Under review",
  needs_merge: "Needs merge",
  approved: "Approved",
  archived: "Archived",
};

const API_CONFIG = {
  baseUrl: "https://morris-township-survey-intake.matthewreate.workers.dev",
};

const reviewState = {
  map: null,
  baseTileLayer: null,
  labelTileLayer: null,
  allRecords: [],
  filteredRecords: [],
  officialHotspotLayer: null,
  submissionLayer: null,
  markerEntries: [],
  detailCache: new Map(),
  repeatMap: new Map(),
  selectedId: null,
};

const elements = {
  mapStatus: document.getElementById("review-map-status"),
  hotspotContextToggle: document.getElementById("review-hotspot-context"),
  filterSubmissionType: document.getElementById("filter-submission-type"),
  filterCategory: document.getElementById("filter-category"),
  filterPhoto: document.getElementById("filter-photo"),
  filterReviewStatus: document.getElementById("filter-review-status"),
  reviewList: document.getElementById("review-list"),
  reviewVisibleCount: document.getElementById("review-visible-count"),
  detailPanel: document.getElementById("review-detail-panel"),
  metricTotal: document.getElementById("metric-total"),
  metricUnderReview: document.getElementById("metric-under-review"),
  metricWithPhotos: document.getElementById("metric-with-photos"),
  metricHotspots: document.getElementById("metric-hotspots"),
  metricRouteRequests: document.getElementById("metric-route-requests"),
  metricTopCategory: document.getElementById("metric-top-category"),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    showMapFailure();
    elements.reviewList.innerHTML =
      '<p class="hotspot-list-empty">Review submissions could not be loaded right now. Confirm the Worker is running and the site origin is allowed.</p>';
  });
});

async function init() {
  bindUi();

  const [submissions, hotspots] = await Promise.all([
    loadSubmissions(),
    loadGeoJSON("data/hotspots.geojson"),
  ]);

  reviewState.allRecords = submissions.map(normalizeSubmission);
  reviewState.repeatMap = buildRepeatMap(reviewState.allRecords);

  populateCategoryFilter(reviewState.allRecords);
  populateStatusFilter(reviewState.allRecords);
  renderSnapshot(reviewState.allRecords);

  if (!ensureLeafletAvailable()) {
    applyFilters();
    return;
  }

  initializeMap();
  applyReviewMapTheme();
  buildOfficialHotspots(hotspots.features);
  buildSubmissionMarkers(reviewState.allRecords);
  window.addEventListener("morris-theme-change", applyReviewMapTheme);

  applyFilters();
}

function bindUi() {
  elements.filterSubmissionType.addEventListener("change", applyFilters);
  elements.filterCategory.addEventListener("change", applyFilters);
  elements.filterPhoto.addEventListener("change", applyFilters);
  elements.filterReviewStatus.addEventListener("change", applyFilters);
  elements.hotspotContextToggle.addEventListener("change", () => {
    if (!reviewState.map || !reviewState.officialHotspotLayer) {
      return;
    }

    if (elements.hotspotContextToggle.checked) {
      reviewState.officialHotspotLayer.addTo(reviewState.map);
    } else {
      reviewState.map.removeLayer(reviewState.officialHotspotLayer);
    }
  });
}

async function loadSubmissions() {
  const response = await fetch(getApiUrl("/api/submissions?limit=250"));
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to load submissions from the review API.");
  }

  return Array.isArray(data.submissions) ? data.submissions : [];
}

async function loadSubmissionDetail(id) {
  const cached = reviewState.detailCache.get(id);
  if (cached && (!cached.has_photo || Date.now() - cached.cachedAt < 5 * 60 * 1000)) {
    return cached.data;
  }

  const response = await fetch(getApiUrl(`/api/submissions/${encodeURIComponent(id)}`));
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to load submission details.");
  }

  const detail = normalizeSubmission(data.submission);
  reviewState.detailCache.set(id, {
    data: detail,
    has_photo: detail.has_photo,
    cachedAt: Date.now(),
  });
  return detail;
}

async function loadGeoJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function normalizeSubmission(record) {
  return {
    ...record,
    concern_mode: Array.isArray(record.concern_mode) ? record.concern_mode : [],
    latitude: Number.isFinite(record.latitude) ? record.latitude : parseNullableNumber(record.latitude),
    longitude: Number.isFinite(record.longitude) ? record.longitude : parseNullableNumber(record.longitude),
    has_photo: Boolean(record.has_photo || record.photo_key),
  };
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function initializeMap() {
  const map = L.map("review-map", {
    center: [40.7965, -74.4815],
    zoom: 13,
    zoomControl: true,
    preferCanvas: true,
  });

  const tileConfig = getTileConfig();

  reviewState.baseTileLayer = L.tileLayer(tileConfig.baseUrl, {
    subdomains: "abcd",
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  reviewState.labelTileLayer = L.tileLayer(tileConfig.labelUrl, {
    subdomains: "abcd",
    maxZoom: 19,
    pane: "overlayPane",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  map.createPane("officialPane");
  map.getPane("officialPane").style.zIndex = 390;

  map.createPane("reviewPane");
  map.getPane("reviewPane").style.zIndex = 430;

  reviewState.map = map;
  hideMapFailure();
}

function buildOfficialHotspots(features) {
  const layerGroup = L.layerGroup().addTo(reviewState.map);
  reviewState.officialHotspotLayer = layerGroup;

  features.forEach((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const category = getHotspotCategory(feature.properties.category);

    L.circleMarker([latitude, longitude], {
      pane: "officialPane",
      radius: 4,
      fillColor: category.color,
      color: "#fffaf3",
      weight: 1.5,
      fillOpacity: 0.18,
      opacity: 0.46,
      interactive: false,
    }).addTo(layerGroup);
  });
}

function buildSubmissionMarkers(records) {
  const layerGroup = L.layerGroup().addTo(reviewState.map);
  reviewState.submissionLayer = layerGroup;
  reviewState.markerEntries = [];

  records
    .filter((record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude))
    .forEach((record) => {
      const category = getSubmissionCategory(record);
      const marker = L.circleMarker([record.latitude, record.longitude], {
        pane: "reviewPane",
        radius: 7,
        fillColor: "#ffffff",
        color: category.color,
        weight: 3,
        fillOpacity: 0.96,
      }).addTo(layerGroup);

      marker.on("click", () => {
        selectSubmission(record.id, true).catch((error) => {
          console.error(error);
        });
      });

      reviewState.markerEntries.push({
        id: record.id,
        marker,
      });
    });
}

function renderSnapshot(records) {
  const total = records.length;
  const underReview = records.filter((record) => record.review_status === "under_review").length;
  const withPhotos = records.filter((record) => record.has_photo).length;
  const hotspots = records.filter((record) => record.submission_type === "hotspot").length;
  const routeRequests = records.filter((record) => record.submission_type === "destination_request").length;
  const topCategory = getTopCategory(records);

  elements.metricTotal.textContent = String(total);
  elements.metricUnderReview.textContent = String(underReview);
  elements.metricWithPhotos.textContent = String(withPhotos);
  elements.metricHotspots.textContent = String(hotspots);
  elements.metricRouteRequests.textContent = String(routeRequests);
  elements.metricTopCategory.textContent = topCategory;
}

function getTopCategory(records) {
  const counts = new Map();
  records.forEach((record) => {
    counts.set(record.category, (counts.get(record.category) || 0) + 1);
  });

  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!top) {
    return "None yet";
  }

  return `${formatCategoryLabel(top[0])} (${top[1]})`;
}

function populateCategoryFilter(records) {
  const categories = Array.from(new Set(records.map((record) => record.category))).sort((a, b) =>
    formatCategoryLabel(a).localeCompare(formatCategoryLabel(b)),
  );

  elements.filterCategory.innerHTML = `
    <option value="all">All categories</option>
    ${categories
      .map(
        (category) =>
          `<option value="${escapeHtml(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`,
      )
      .join("")}
  `;
}

function populateStatusFilter(records) {
  const statuses = Array.from(new Set(records.map((record) => record.review_status))).sort();
  elements.filterReviewStatus.innerHTML = `
    <option value="all">All statuses</option>
    ${statuses
      .map(
        (status) =>
          `<option value="${escapeHtml(status)}">${escapeHtml(humanizeReviewStatus(status))}</option>`,
      )
      .join("")}
  `;
}

function applyFilters() {
  reviewState.filteredRecords = reviewState.allRecords.filter((record) => {
    const typeMatches =
      elements.filterSubmissionType.value === "all" ||
      record.submission_type === elements.filterSubmissionType.value;
    const categoryMatches =
      elements.filterCategory.value === "all" || record.category === elements.filterCategory.value;
    const photoMatches =
      elements.filterPhoto.value === "all" ||
      (elements.filterPhoto.value === "with_photo" && record.has_photo) ||
      (elements.filterPhoto.value === "without_photo" && !record.has_photo);
    const statusMatches =
      elements.filterReviewStatus.value === "all" ||
      record.review_status === elements.filterReviewStatus.value;

    return typeMatches && categoryMatches && photoMatches && statusMatches;
  });

  renderList();
  updateMarkerVisibility();

  if (reviewState.selectedId && !reviewState.filteredRecords.some((record) => record.id === reviewState.selectedId)) {
    reviewState.selectedId = null;
    elements.detailPanel.innerHTML =
      '<p class="detail-empty">Select a submission from the filtered list or map to review its location, description, status, repeat-report signal, and photo evidence.</p>';
    refreshMarkerStyles();
  }
}

function renderList() {
  elements.reviewVisibleCount.textContent = `${reviewState.filteredRecords.length} shown`;
  elements.reviewList.innerHTML = "";

  if (!reviewState.filteredRecords.length) {
    elements.reviewList.innerHTML =
      '<p class="hotspot-list-empty">No submissions match the current filters.</p>';
    return;
  }

  reviewState.filteredRecords.forEach((record) => {
    const category = getSubmissionCategory(record);
    const repeatTotal = getRepeatTotal(record.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hotspot-card review-card";
    if (reviewState.selectedId === record.id) {
      button.classList.add("is-active");
    }

    const secondaryMeta = [
      humanizeSubmissionType(record.submission_type),
      humanizeReviewStatus(record.review_status),
      formatShortDate(record.submitted_at),
    ];

    button.innerHTML = `
      <div class="hotspot-card-header">
        <p class="hotspot-card-title">${escapeHtml(record.title)}</p>
        <span class="mini-tag">
          <span class="swatch" style="background:${category.color}"></span>
          ${escapeHtml(category.label)}
        </span>
      </div>
      <p class="review-card-meta">${escapeHtml(secondaryMeta.join(" · "))}</p>
      <p>${escapeHtml(record.location_text || "No location description provided.")}</p>
      <div class="review-card-flags">
        ${record.has_photo ? '<span class="pill review-pill">Photo</span>' : ""}
        ${repeatTotal > 1 ? `<span class="pill review-pill">${repeatTotal} reports nearby</span>` : ""}
      </div>
    `;

    button.addEventListener("click", () => {
      selectSubmission(record.id, true).catch((error) => {
        console.error(error);
      });
    });

    elements.reviewList.append(button);
  });
}

async function selectSubmission(id, recenterMap) {
  reviewState.selectedId = id;
  const record = reviewState.allRecords.find((entry) => entry.id === id);

  if (record && recenterMap && reviewState.map && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)) {
    reviewState.map.panTo([record.latitude, record.longitude]);
  }

  refreshMarkerStyles();
  renderList();

  try {
    const detail = await loadSubmissionDetail(id);
    renderDetail(detail);
  } catch (error) {
    console.error(error);
    elements.detailPanel.innerHTML = `<p class="detail-empty">${escapeHtml(
      error instanceof Error ? error.message : "The submission detail could not be loaded right now.",
    )}</p>`;
  }
}

function renderDetail(record) {
  const category = getSubmissionCategory(record);
  const repeatTotal = getRepeatTotal(record.id);
  const metaRows = [
    ["Type", humanizeSubmissionType(record.submission_type)],
    ["Category", category.label],
    ["Review status", humanizeReviewStatus(record.review_status)],
    ["Submitted", formatLongDate(record.submitted_at)],
    ["Location", record.location_text || "Not specified"],
  ];

  if (record.submission_type === "destination_request") {
    metaRows.push(["From area", record.origin_area || "Not specified"]);
    metaRows.push(["Destination", record.desired_destination || "Not specified"]);
  }

  metaRows.push(["Mode", formatModeList(record.concern_mode)]);

  if (repeatTotal > 1) {
    metaRows.push(["Repeat reports nearby", `${repeatTotal} total reports in this area`]);
  }

  if (record.additional_notes) {
    metaRows.push(["Additional notes", record.additional_notes]);
  }

  const photoMarkup = record.photo_url
    ? `
        <section class="review-photo-block">
          <h3 class="legend-group-title">Photo evidence</h3>
          <img class="review-photo" src="${escapeHtml(record.photo_url)}" alt="Submission photo for ${escapeHtml(record.title)}" />
        </section>
      `
    : record.has_photo
      ? `
        <section class="review-photo-block">
          <h3 class="legend-group-title">Photo evidence</h3>
          <p class="legend-copy">A photo is on file for this submission, but a temporary review image URL could not be generated right now.</p>
        </section>
      `
      : "";

  elements.detailPanel.innerHTML = `
    <div class="detail-title-row">
      <h3 class="detail-title">${escapeHtml(record.title)}</h3>
      <span class="mini-tag">
        <span class="swatch" style="background:${category.color}"></span>
        ${escapeHtml(category.label)}
      </span>
    </div>
    <p class="detail-body">${escapeHtml(record.description || "No description provided.")}</p>
    <div class="detail-meta">
      ${metaRows
        .map(
          ([label, value]) => `
            <div class="detail-meta-row">
              <span class="detail-meta-label">${escapeHtml(label)}</span>
              <span>${escapeHtml(String(value))}</span>
            </div>
          `,
        )
        .join("")}
    </div>
    ${photoMarkup}
  `;
}

function updateMarkerVisibility() {
  const visibleIds = new Set(reviewState.filteredRecords.map((record) => record.id));
  reviewState.markerEntries.forEach((entry) => {
    const shouldShow = visibleIds.has(entry.id);
    const layerHasMarker = reviewState.submissionLayer && reviewState.submissionLayer.hasLayer(entry.marker);

    if (shouldShow && !layerHasMarker) {
      entry.marker.addTo(reviewState.submissionLayer);
    }

    if (!shouldShow && layerHasMarker) {
      reviewState.submissionLayer.removeLayer(entry.marker);
    }
  });
}

function refreshMarkerStyles() {
  reviewState.markerEntries.forEach((entry) => {
    const record = reviewState.allRecords.find((item) => item.id === entry.id);
    const category = getSubmissionCategory(record);
    const isSelected = reviewState.selectedId === entry.id;

    entry.marker.setStyle({
      radius: isSelected ? 9 : 7,
      fillColor: "#ffffff",
      color: isSelected ? "#203847" : category.color,
      weight: isSelected ? 4 : 3,
      fillOpacity: isSelected ? 0.98 : 0.94,
    });
  });
}

function buildRepeatMap(records) {
  const repeats = new Map(records.map((record) => [record.id, new Set()]));

  for (let index = 0; index < records.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < records.length; compareIndex += 1) {
      const first = records[index];
      const second = records[compareIndex];
      if (recordsAppearRelated(first, second)) {
        repeats.get(first.id).add(second.id);
        repeats.get(second.id).add(first.id);
      }
    }
  }

  return repeats;
}

function recordsAppearRelated(first, second) {
  const sameLocationText =
    normalizeLocationText(first.location_text) &&
    normalizeLocationText(first.location_text) === normalizeLocationText(second.location_text);

  if (sameLocationText) {
    return true;
  }

  if (
    Number.isFinite(first.latitude) &&
    Number.isFinite(first.longitude) &&
    Number.isFinite(second.latitude) &&
    Number.isFinite(second.longitude)
  ) {
    return distanceBetween(first.latitude, first.longitude, second.latitude, second.longitude) <= 120;
  }

  return false;
}

function getRepeatTotal(id) {
  const neighbors = reviewState.repeatMap.get(id);
  return neighbors && neighbors.size > 0 ? neighbors.size + 1 : 1;
}

function normalizeLocationText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function distanceBetween(latA, lonA, latB, lonB) {
  const earthRadiusMeters = 6371000;
  const latDelta = degreesToRadians(latB - latA);
  const lonDelta = degreesToRadians(lonB - lonA);
  const normalizedLatA = degreesToRadians(latA);
  const normalizedLatB = degreesToRadians(latB);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(normalizedLatA) * Math.cos(normalizedLatB) * Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function getSubmissionCategory(record) {
  if (record.submission_type === "destination_request") {
    return (
      DESTINATION_CATEGORIES.find((category) => category.id === record.category) || {
        id: record.category,
        label: formatCategoryLabel(record.category),
        color: "#6b7a8a",
      }
    );
  }

  return (
    HOTSPOT_CATEGORIES.find((category) => category.id === record.category) || {
      id: record.category,
      label: formatCategoryLabel(record.category),
      color: "#5f6573",
    }
  );
}

function getHotspotCategory(categoryId) {
  return (
    HOTSPOT_CATEGORIES.find((category) => category.id === categoryId) || {
      id: categoryId,
      label: formatCategoryLabel(categoryId),
      color: "#5f6573",
    }
  );
}

function humanizeSubmissionType(value) {
  return value === "destination_request" ? "Route request" : "Trouble spot";
}

function humanizeReviewStatus(value) {
  return REVIEW_STATUS_LABELS[value] || formatCategoryLabel(value || "under_review");
}

function formatModeList(values) {
  const labels = values.map(formatModeValue).filter(Boolean);

  if (labels.length === 0) {
    return "Not specified";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function formatModeValue(value) {
  const labels = {
    walking: "Walking",
    rolling: "Rolling",
    cycling: "Cycling",
    safety: "Safety emphasis",
  };

  return labels[value] || formatCategoryLabel(value);
}

function formatCategoryLabel(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatShortDate(value) {
  if (!value) {
    return "Date unavailable";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatLongDate(value) {
  if (!value) {
    return "Date unavailable";
  }

  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ensureLeafletAvailable() {
  if (typeof window.L !== "undefined") {
    return true;
  }

  showMapFailure();
  return false;
}

function showMapFailure() {
  elements.mapStatus.hidden = false;
}

function hideMapFailure() {
  elements.mapStatus.hidden = true;
}

function applyReviewMapTheme() {
  if (!reviewState.baseTileLayer || !reviewState.labelTileLayer) {
    return;
  }

  const tileConfig = getTileConfig();
  reviewState.baseTileLayer.setUrl(tileConfig.baseUrl);
  reviewState.labelTileLayer.setUrl(tileConfig.labelUrl);
}

function getTileConfig() {
  const isDarkTheme = document.documentElement.dataset.theme === "dark";
  return isDarkTheme
    ? {
        baseUrl: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
        labelUrl: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
      }
    : {
        baseUrl: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
        labelUrl: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
      };
}

function getApiUrl(path) {
  return `${API_CONFIG.baseUrl.replace(/\/+$/, "")}${path}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

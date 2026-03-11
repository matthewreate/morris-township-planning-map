const HOTSPOT_CATEGORIES = [
  {
    id: "sidewalk_gap",
    label: "Sidewalk Gap",
    description: "Missing or incomplete sidewalk connections.",
    color: "#b85b3e",
  },
  {
    id: "unsafe_crossing",
    label: "Unsafe Crossing",
    description: "Crossings or intersections that need improvement.",
    color: "#9e3a35",
  },
  {
    id: "visibility_issue",
    label: "Visibility Issue",
    description: "Sightlines or awareness concerns.",
    color: "#7c5d32",
  },
  {
    id: "speeding_concern",
    label: "Speeding Concern",
    description: "Reported speeding or driver behavior concerns.",
    color: "#85564b",
  },
  {
    id: "accessibility_barrier",
    label: "Accessibility Barrier",
    description: "Barriers affecting accessible travel.",
    color: "#4f7077",
  },
  {
    id: "general_hotspot",
    label: "General Hotspot",
    description: "Other notable trouble spots.",
    color: "#5f6573",
  },
];

const DESTINATION_CATEGORIES = {
  park: { label: "Park", color: "#2e6f63" },
  school: { label: "School", color: "#3d6380" },
  trail_access: { label: "Trail Access", color: "#466d52" },
  business: { label: "Business", color: "#76604a" },
  civic: { label: "Civic", color: "#505c79" },
};

const CONTEXT_GROUPS = [
  {
    id: "sidewalks",
    label: "Sidewalk Network",
    description: "Concrete and asphalt sidewalks from the TAC source map.",
    color: "#8ca76f",
    weight: 1.6,
    opacity: 0.6,
    dashArray: "",
  },
  {
    id: "trails",
    label: "Trails and Paths",
    description: "Township and county trail alignments for context.",
    color: "#4d7b68",
    weight: 1.9,
    opacity: 0.58,
    dashArray: "6 4",
  },
  {
    id: "crosswalks",
    label: "Marked Crosswalks",
    description: "Existing marked crosswalk segments from the TAC source map.",
    color: "#cf8a45",
    weight: 1.8,
    opacity: 0.64,
    dashArray: "3 4",
  },
  {
    id: "border",
    label: "Township Border",
    description: "Morris Township border context from the TAC source map.",
    color: "#4b5d78",
    weight: 2.5,
    opacity: 0.85,
    dashArray: "8 5",
  },
];

const REVIEW_LAYER_GROUPS = [
  {
    id: "resident_input",
    label: "Resident Input / Under Review",
    description: "Sample resident submissions held apart from official planning data.",
    color: "#6b7a8a",
  },
];

const appState = {
  map: null,
  baseTileLayer: null,
  labelTileLayer: null,
  hotspotEntries: [],
  destinationEntries: [],
  residentEntries: [],
  contextLayers: {},
  activeHotspotCategories: new Set(HOTSPOT_CATEGORIES.map((category) => category.id)),
  activeContextGroups: new Set(CONTEXT_GROUPS.map((group) => group.id)),
  activeReviewLayers: new Set(REVIEW_LAYER_GROUPS.map((group) => group.id)),
  selectedFeature: null,
  hotspotLayerGroup: null,
  destinationLayerGroup: null,
  residentLayerGroup: null,
};

const elements = {
  hotspotTotal: document.getElementById("hotspot-total"),
  visibleCount: document.getElementById("visible-count"),
  categoryFilters: document.getElementById("category-filters"),
  layerToggles: document.getElementById("layer-toggles"),
  reviewLayerToggles: document.getElementById("review-layer-toggles"),
  visibleHotspots: document.getElementById("visible-hotspots"),
  detailPanel: document.getElementById("detail-panel"),
  referenceContent: document.getElementById("reference-content"),
  mapStatus: document.getElementById("map-status"),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    showMapFailure();
    elements.detailPanel.innerHTML =
      '<p class="detail-empty">The map data could not be loaded. Check the console and confirm the site is running from a local or hosted web server.</p>';
  });
});

async function init() {
  const [hotspots, destinations, contextLines, residentSubmissions] = await Promise.all([
    loadGeoJSON("data/hotspots.geojson"),
    loadGeoJSON("data/destinations.geojson"),
    loadGeoJSON("data/context-lines.geojson"),
    loadJSON("data/resident-submissions.json"),
  ]);

  renderCategoryFilters(hotspots.features);
  renderLayerToggles();
  renderReviewLayerToggles();
  renderMapReference();
  if (!ensureLeafletAvailable()) {
    elements.detailPanel.innerHTML =
      '<p class="detail-empty">The planning records are available, but the interactive map could not be initialized right now.</p>';
    return;
  }

  initializeMap();
  applyMapTheme();
  buildContextLayers(contextLines.features);
  buildDestinations(destinations.features);
  buildHotspots(hotspots.features);
  buildResidentSubmissions(residentSubmissions);
  renderReviewSummary(residentSubmissions);
  addMorristownMask();
  appState.map.on("moveend", renderVisibleHotspotsList);
  window.addEventListener("morris-theme-change", applyMapTheme);
  renderVisibleHotspotsList();
}

async function loadGeoJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function initializeMap() {
  const map = L.map("map", {
    center: [40.7965, -74.4815],
    zoom: 13,
    zoomControl: true,
    preferCanvas: true,
  });

  const tileConfig = getTileConfig();

  appState.baseTileLayer = L.tileLayer(tileConfig.baseUrl, {
    subdomains: "abcd",
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  appState.labelTileLayer = L.tileLayer(tileConfig.labelUrl, {
    subdomains: "abcd",
    maxZoom: 19,
    pane: "overlayPane",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  map.createPane("contextPane");
  map.getPane("contextPane").style.zIndex = 320;

  map.createPane("maskPane");
  map.getPane("maskPane").style.zIndex = 350;

  map.createPane("destinationPane");
  map.getPane("destinationPane").style.zIndex = 430;

  map.createPane("residentPane");
  map.getPane("residentPane").style.zIndex = 440;

  map.createPane("hotspotPane");
  map.getPane("hotspotPane").style.zIndex = 450;

  appState.map = map;
  hideMapFailure();

  requestAnimationFrame(() => {
    map.invalidateSize();
  });

  window.setTimeout(() => {
    map.invalidateSize();
  }, 180);
}

function buildHotspots(features) {
  const hotspotLayerGroup = L.layerGroup().addTo(appState.map);
  appState.hotspotLayerGroup = hotspotLayerGroup;
  appState.hotspotEntries = features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const category = getHotspotCategory(feature.properties.category);
    const marker = L.circleMarker([latitude, longitude], {
      pane: "hotspotPane",
      radius: 7,
      fillColor: category.color,
      color: "#fffaf3",
      weight: 2,
      fillOpacity: 0.94,
    });

    marker.bindPopup(buildPopupMarkup(feature, "hotspot"), {
      className: "map-popup",
      maxWidth: 280,
    });

    marker.on("click", () => {
      selectFeature({
        kind: "hotspot",
        feature,
        marker,
        openPopup: false,
      });
    });

    marker.addTo(hotspotLayerGroup);

    return {
      feature,
      marker,
      latlng: marker.getLatLng(),
      kind: "hotspot",
    };
  });

  updateHotspotVisibility();
}

function buildDestinations(features) {
  const destinationLayerGroup = L.layerGroup().addTo(appState.map);
  appState.destinationLayerGroup = destinationLayerGroup;
  appState.destinationEntries = features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const category = DESTINATION_CATEGORIES[feature.properties.category] || {
      label: "Destination",
      color: "#274c5e",
    };
    const marker = L.circleMarker([latitude, longitude], {
      pane: "destinationPane",
      radius: 6,
      fillColor: category.color,
      color: "#f8f5ee",
      weight: 2,
      fillOpacity: 0.82,
      opacity: 0.95,
    });

    marker.bindPopup(buildPopupMarkup(feature, "destination"), {
      className: "map-popup",
      maxWidth: 280,
    });

    marker.on("click", () => {
      selectFeature({
        kind: "destination",
        feature,
        marker,
        openPopup: false,
      });
    });

    marker.addTo(destinationLayerGroup);

    return {
      feature,
      marker,
      latlng: marker.getLatLng(),
      kind: "destination",
    };
  });
}

function buildContextLayers(features) {
  CONTEXT_GROUPS.forEach((group) => {
    const groupFeatures = features.filter(
      (feature) => feature.properties.display_group === group.id,
    );

    const layer = L.geoJSON(groupFeatures, {
      pane: "contextPane",
      interactive: false,
      style: {
        color: group.color,
        weight: group.weight,
        opacity: group.opacity,
        dashArray: group.dashArray,
      },
    });

    layer.addTo(appState.map);
    appState.contextLayers[group.id] = layer;
  });
}

function buildResidentSubmissions(records) {
  const residentLayerGroup = L.layerGroup().addTo(appState.map);
  appState.residentLayerGroup = residentLayerGroup;
  appState.residentEntries = records
    .filter((record) => typeof record.latitude === "number" && typeof record.longitude === "number")
    .map((record) => {
      const marker = L.circleMarker([record.latitude, record.longitude], {
        pane: "residentPane",
        radius: 7,
        fillColor: "#ffffff",
        fillOpacity: 0.7,
        color: "#6b7a8a",
        weight: 3,
        dashArray: "2 3",
      });

      marker.bindPopup(buildResidentPopupMarkup(record), {
        className: "map-popup",
        maxWidth: 300,
      });

      marker.on("click", () => {
        selectFeature({
          kind: "resident_submission",
          feature: { properties: record },
          marker,
          openPopup: false,
        });
      });

      marker.addTo(residentLayerGroup);

      return {
        feature: { properties: record },
        marker,
      };
    });
}

function addMorristownMask() {
  L.circle([40.7965, -74.4815], {
    pane: "maskPane",
    radius: 1650,
    stroke: false,
    fillColor: "#a7afb5",
    fillOpacity: 0.22,
    interactive: false,
  }).addTo(appState.map);

  L.circle([40.7965, -74.4815], {
    pane: "maskPane",
    radius: 1650,
    color: "#5f6774",
    weight: 1,
    opacity: 0.25,
    fillOpacity: 0,
    interactive: false,
    dashArray: "10 8",
  }).addTo(appState.map);
}

function renderCategoryFilters(features) {
  const counts = HOTSPOT_CATEGORIES.reduce((accumulator, category) => {
    accumulator[category.id] = 0;
    return accumulator;
  }, {});

  features.forEach((feature) => {
    const category = feature.properties.category;
    counts[category] = (counts[category] || 0) + 1;
  });

  elements.hotspotTotal.textContent = `${features.length} total`;
  elements.categoryFilters.innerHTML = "";

  HOTSPOT_CATEGORIES.forEach((category) => {
    const wrapper = document.createElement("details");
    wrapper.className = "control-item control-item-collapsible";
    wrapper.innerHTML = `
      <summary class="control-summary">
        <span class="control-main">
          <input type="checkbox" name="hotspot-category" value="${category.id}" checked />
          <span class="swatch" style="background:${category.color}"></span>
          <span class="control-text">
            <span class="control-label">${category.label}</span>
          </span>
        </span>
        <span class="pill">${counts[category.id] || 0}</span>
      </summary>
      <div class="control-body">
        <p class="control-hint">${category.description}</p>
      </div>
    `;
    elements.categoryFilters.append(wrapper);
  });

  bindControlToggleGuards(elements.categoryFilters);
  elements.categoryFilters.addEventListener("change", () => {
    const checkedValues = Array.from(
      elements.categoryFilters.querySelectorAll("input:checked"),
      (input) => input.value,
    );
    appState.activeHotspotCategories = new Set(checkedValues);
    updateHotspotVisibility();
  });
}

function renderLayerToggles() {
  elements.layerToggles.innerHTML = "";

  CONTEXT_GROUPS.forEach((group) => {
    const wrapper = document.createElement("details");
    wrapper.className = "control-item control-item-collapsible";
    wrapper.innerHTML = `
      <summary class="control-summary">
        <span class="control-main">
          <input type="checkbox" name="context-group" value="${group.id}" checked />
          <span class="swatch-line" style="border-top-color:${group.color}"></span>
          <span class="control-text">
            <span class="control-label">${group.label}</span>
          </span>
        </span>
      </summary>
      <div class="control-body">
        <p class="control-hint">${group.description}</p>
      </div>
    `;
    elements.layerToggles.append(wrapper);
  });

  bindControlToggleGuards(elements.layerToggles);
  elements.layerToggles.addEventListener("change", () => {
    const checkedValues = Array.from(
      elements.layerToggles.querySelectorAll("input:checked"),
      (input) => input.value,
    );
    appState.activeContextGroups = new Set(checkedValues);

    CONTEXT_GROUPS.forEach((group) => {
      const layer = appState.contextLayers[group.id];
      if (!layer) {
        return;
      }
      if (appState.activeContextGroups.has(group.id)) {
        layer.addTo(appState.map);
      } else {
        appState.map.removeLayer(layer);
      }
    });
  });
}

function renderReviewLayerToggles() {
  elements.reviewLayerToggles.innerHTML = "";

  REVIEW_LAYER_GROUPS.forEach((group) => {
    const wrapper = document.createElement("details");
    wrapper.className = "control-item control-item-collapsible";
    wrapper.innerHTML = `
      <summary class="control-summary">
        <span class="control-main">
          <input type="checkbox" name="review-layer" value="${group.id}" checked />
          <span class="swatch" style="background:#ffffff; box-shadow: 0 0 0 2px ${group.color}"></span>
          <span class="control-text">
            <span class="control-label">${group.label}</span>
          </span>
        </span>
      </summary>
      <div class="control-body">
        <p class="control-hint">${group.description}</p>
      </div>
    `;
    elements.reviewLayerToggles.append(wrapper);
  });

  bindControlToggleGuards(elements.reviewLayerToggles);
  elements.reviewLayerToggles.addEventListener("change", () => {
    const checkedValues = Array.from(
      elements.reviewLayerToggles.querySelectorAll("input:checked"),
      (input) => input.value,
    );
    appState.activeReviewLayers = new Set(checkedValues);

    if (!appState.residentLayerGroup) {
      return;
    }

    if (appState.activeReviewLayers.has("resident_input")) {
      appState.residentLayerGroup.addTo(appState.map);
    } else {
      appState.map.removeLayer(appState.residentLayerGroup);
    }
  });
}

function bindControlToggleGuards(container) {
  container.addEventListener("click", (event) => {
    if (event.target instanceof HTMLInputElement) {
      event.stopPropagation();
    }
  });
}

function renderMapReference() {
  const hotspotItems = HOTSPOT_CATEGORIES.map(
    (category) => `
      <div class="legend-item">
        <span class="swatch" style="background:${category.color}"></span>
        <span>${category.label}</span>
      </div>
    `,
  ).join("");

  const destinationItems = Object.values(DESTINATION_CATEGORIES)
    .map(
      (category) => `
        <div class="legend-item">
          <span class="swatch" style="background:${category.color}"></span>
          <span>${category.label}</span>
        </div>
      `,
    )
    .join("");

  const contextItems = CONTEXT_GROUPS.map(
    (group) => `
      <div class="legend-item">
        <span class="swatch-line" style="border-top-color:${group.color}"></span>
        <span>${group.label}</span>
      </div>
    `,
  ).join("");

  const reviewItems = REVIEW_LAYER_GROUPS.map(
    (group) => `
      <div class="legend-item">
        <span class="swatch" style="background:#ffffff; box-shadow: 0 0 0 2px ${group.color}"></span>
        <span>${group.label}</span>
      </div>
    `,
  ).join("");

  elements.referenceContent.innerHTML = `
    <div class="reference-summary">
      <p class="reference-summary-line">Official planning data is the primary working record on this page.</p>
      <p class="reference-summary-line">Survey input remains under review and separate from the official planning map.</p>
      <p class="reference-summary-line">Reference destinations and context layers support interpretation rather than equal evidentiary weight.</p>
    </div>
    <details class="reference-details" open>
      <summary class="reference-toggle">Data Status</summary>
      <div class="legend-section">
        <div class="legend-items">
          <div class="legend-item">
            <span class="swatch" style="background:#9e3a35"></span>
            <span>Official planning data: TAC and working-group records used as the current planning base.</span>
          </div>
          <div class="legend-item">
            <span class="swatch" style="background:#ffffff; box-shadow: 0 0 0 2px #6b7a8a"></span>
            <span>Resident input / under review: sample submissions held apart from the official map.</span>
          </div>
          <div class="legend-item">
            <span class="swatch" style="background:#274c5e"></span>
            <span>Reference destinations: civic anchors used to interpret where people are trying to go.</span>
          </div>
          <div class="legend-item">
            <span class="swatch-line" style="border-top-color:#4b5d78"></span>
            <span>Context layers: sidewalks, trails, borders, and crosswalks shown for orientation.</span>
          </div>
        </div>
      </div>
    </details>
    <details class="reference-details">
      <summary class="reference-toggle">Map Symbols</summary>
      <div class="legend-section">
        <div>
          <h4 class="legend-group-title">Official Planning Data</h4>
          <div class="legend-items">${hotspotItems}</div>
        </div>
        <div>
          <h4 class="legend-group-title">Reference Destinations</h4>
          <div class="legend-items">${destinationItems}</div>
        </div>
        <div>
          <h4 class="legend-group-title">Resident Input / Under Review</h4>
          <div class="legend-items">${reviewItems}</div>
        </div>
        <div>
          <h4 class="legend-group-title">Context</h4>
          <div class="legend-items">${contextItems}</div>
        </div>
      </div>
    </details>
    <details class="reference-details">
      <summary class="reference-toggle">Use in This Phase</summary>
      <div class="legend-section">
        <p class="legend-copy">Use this map to review known issues, compare them with destinations and context, and prepare survey and workshop questions. It is not a complete inventory of every walking or biking condition in the township.</p>
      </div>
    </details>
    <details class="reference-details">
      <summary class="reference-toggle">Map Context</summary>
      <div class="legend-section">
        <p class="legend-copy">The central gray mask de-emphasizes Morristown for this Morris Township-focused discussion. It is not an official boundary.</p>
      </div>
    </details>
  `;
}

function updateHotspotVisibility() {
  if (!appState.hotspotEntries.length) {
    return;
  }

  appState.hotspotEntries.forEach((entry) => {
    const isVisible = appState.activeHotspotCategories.has(
      entry.feature.properties.category,
    );

    if (isVisible && !appState.hotspotLayerGroup.hasLayer(entry.marker)) {
      entry.marker.addTo(appState.hotspotLayerGroup);
    }

    if (!isVisible && appState.hotspotLayerGroup.hasLayer(entry.marker)) {
      appState.hotspotLayerGroup.removeLayer(entry.marker);
    }
  });

  if (
    appState.selectedFeature &&
    appState.selectedFeature.kind === "hotspot" &&
    !appState.activeHotspotCategories.has(appState.selectedFeature.category)
  ) {
    clearSelectedFeature();
  }

  renderVisibleHotspotsList();
  refreshMarkerStyles();
}

function renderVisibleHotspotsList() {
  if (!appState.map) {
    return;
  }

  const bounds = appState.map.getBounds();
  const center = appState.map.getCenter();
  const visibleEntries = appState.hotspotEntries
    .filter(
      (entry) =>
        appState.activeHotspotCategories.has(entry.feature.properties.category) &&
        bounds.contains(entry.latlng),
    )
    .sort(
      (entryA, entryB) =>
        center.distanceTo(entryA.latlng) - center.distanceTo(entryB.latlng),
    );

  elements.visibleCount.textContent = `${visibleEntries.length} in view`;
  elements.visibleHotspots.innerHTML = "";

  if (!visibleEntries.length) {
    elements.visibleHotspots.innerHTML =
      '<p class="hotspot-list-empty">No hotspots are visible in the current map view. Pan, zoom, or adjust the filters to see more.</p>';
    return;
  }

  visibleEntries.forEach((entry) => {
    const feature = entry.feature;
    const category = getHotspotCategory(feature.properties.category);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hotspot-card";
    if (
      appState.selectedFeature &&
      appState.selectedFeature.kind === "hotspot" &&
      appState.selectedFeature.id === feature.properties.id
    ) {
      button.classList.add("is-active");
    }

    button.innerHTML = `
      <div class="hotspot-card-header">
        <p class="hotspot-card-title">${escapeHtml(feature.properties.title)}</p>
        <span class="mini-tag">
          <span class="swatch" style="background:${category.color}"></span>
          ${category.label}
        </span>
      </div>
      <p>${escapeHtml(feature.properties.description || "No description provided.")}</p>
    `;

    button.addEventListener("click", () => {
      appState.map.panTo(entry.latlng);
      entry.marker.openPopup();
      selectFeature({
        kind: "hotspot",
        feature,
        marker: entry.marker,
        openPopup: false,
      });
    });

    elements.visibleHotspots.append(button);
  });
}

function selectFeature({ kind, feature, marker, openPopup }) {
  appState.selectedFeature = {
    id: feature.properties.id,
    title: feature.properties.title || feature.properties.location_text,
    category: feature.properties.category,
    kind,
  };

  if (marker && openPopup !== false) {
    marker.openPopup();
  }

  renderDetailPanel(kind, feature);
  refreshMarkerStyles();
  renderVisibleHotspotsList();
}

function clearSelectedFeature() {
  appState.selectedFeature = null;
  if (appState.map) {
    appState.map.closePopup();
  }
  elements.detailPanel.innerHTML =
    '<p class="detail-empty">Select an official record, reference destination, or resident submission to view its description, category, and review details.</p>';
  refreshMarkerStyles();
}

function renderDetailPanel(kind, feature) {
  const properties = feature.properties;
  const categoryMeta =
    kind === "hotspot"
      ? getHotspotCategory(properties.category)
      : kind === "resident_submission"
        ? getResidentCategoryMeta(properties)
      : DESTINATION_CATEGORIES[properties.category] || {
          label: "Destination",
          color: "#274c5e",
        };

  const metaRows =
    kind === "hotspot"
      ? [
          ["Category", categoryMeta.label],
          ["Record Status", "Official planning data"],
          ["Source Layer", properties.source_layer || "Unspecified"],
          ["Working Status", properties.status || "Unspecified"],
          ["Source", properties.source || "Unspecified"],
          ["Notes", properties.notes || "None added yet"],
        ]
      : kind === "resident_submission"
        ? [
          ["Category", categoryMeta.label],
          ["Record Status", "Under review"],
          ["Record Type", properties.submission_type === "destination_request" ? "Destination request" : "Resident hotspot report"],
          ["Review Status", humanizeReviewStatus(properties.review_status)],
          ["Location", properties.location_text || "Unspecified"],
          ["Requested Destination", properties.desired_destination || "Not specified"],
          ["Concern Mode", (properties.concern_mode || []).join(", ") || "Not specified"],
          ["Submitted", properties.submitted_at || "Unspecified"],
        ]
      : [
          ["Category", categoryMeta.label],
          ["Record Status", "Reference destination"],
          ["Record Type", "Reference destination"],
          ["Coordinates", `${properties.latitude.toFixed(5)}, ${properties.longitude.toFixed(5)}`],
        ];

  elements.detailPanel.innerHTML = `
    <div class="detail-title-row">
      <h3 class="detail-title">${escapeHtml(properties.title)}</h3>
      <span class="mini-tag">
        <span class="swatch" style="background:${categoryMeta.color}"></span>
        ${categoryMeta.label}
      </span>
    </div>
    <p class="detail-body">${escapeHtml(properties.description || "No description provided.")}</p>
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
  `;
}

function refreshMarkerStyles() {
  appState.hotspotEntries.forEach((entry) => {
    const category = getHotspotCategory(entry.feature.properties.category);
    const isSelected =
      appState.selectedFeature &&
      appState.selectedFeature.kind === "hotspot" &&
      appState.selectedFeature.id === entry.feature.properties.id;

    entry.marker.setStyle({
      radius: isSelected ? 10 : 7,
      fillColor: category.color,
      color: isSelected ? "#203847" : "#fffaf3",
      weight: isSelected ? 3 : 2,
      fillOpacity: isSelected ? 1 : 0.94,
    });
  });

  appState.destinationEntries.forEach((entry) => {
    const category = DESTINATION_CATEGORIES[entry.feature.properties.category] || {
      color: "#274c5e",
    };
    const isSelected =
      appState.selectedFeature &&
      appState.selectedFeature.kind === "destination" &&
      appState.selectedFeature.id === entry.feature.properties.id;

    entry.marker.setStyle({
      radius: isSelected ? 8 : 6,
      fillColor: category.color,
      color: isSelected ? "#203847" : "#f8f5ee",
      weight: isSelected ? 3 : 2,
      fillOpacity: isSelected ? 0.95 : 0.82,
    });
  });

  appState.residentEntries.forEach((entry) => {
    const isSelected =
      appState.selectedFeature &&
      appState.selectedFeature.kind === "resident_submission" &&
      appState.selectedFeature.id === entry.feature.properties.id;

    entry.marker.setStyle({
      radius: isSelected ? 9 : 7,
      fillColor: "#ffffff",
      color: isSelected ? "#203847" : "#6b7a8a",
      weight: isSelected ? 4 : 3,
      fillOpacity: isSelected ? 0.82 : 0.7,
    });
  });
}

function buildPopupMarkup(feature, kind) {
  const properties = feature.properties;
  const categoryMeta =
    kind === "hotspot"
      ? getHotspotCategory(properties.category)
      : DESTINATION_CATEGORIES[properties.category] || { label: "Destination" };
  const statusLabel =
    kind === "hotspot" ? "Official planning data" : "Reference destination";

  return `
    <h3>${escapeHtml(properties.title)}</h3>
    <p><strong>${statusLabel}</strong></p>
    <p><strong>${categoryMeta.label}</strong></p>
    <p>${escapeHtml(properties.description || "No description provided.")}</p>
  `;
}

function buildResidentPopupMarkup(record) {
  return `
    <h3>${escapeHtml(record.title || record.location_text)}</h3>
    <p><strong>Under review</strong></p>
    <p>${escapeHtml(record.description || "No description provided.")}</p>
  `;
}

function renderReviewSummary(records) {
  const categoryCounts = new Map();
  const locationCounts = new Map();
  const destinationCounts = new Map();

  records.forEach((record) => {
    categoryCounts.set(record.category, (categoryCounts.get(record.category) || 0) + 1);
    if (record.location_text) {
      locationCounts.set(record.location_text, (locationCounts.get(record.location_text) || 0) + 1);
    }
    if (record.desired_destination) {
      destinationCounts.set(record.desired_destination, (destinationCounts.get(record.desired_destination) || 0) + 1);
    }
  });

  elements.referenceContent.insertAdjacentHTML("beforeend", `
    <details class="reference-details">
      <summary class="reference-toggle">Review Summary</summary>
      <div class="legend-section">
        <p class="legend-copy">Prototype planning-group view of recurring resident input now under review.</p>
      </div>
      ${renderSummaryGroup("Counts by issue", categoryCounts, formatCategoryLabel)}
      ${renderSummaryGroup("Repeated locations", locationCounts, null)}
      ${renderSummaryGroup("Requested destinations", destinationCounts, null)}
    </details>
  `);
}

function renderSummaryGroup(title, counts, formatter) {
  const items = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);

  return `
    <section class="summary-group">
      <h3 class="summary-title">${escapeHtml(title)}</h3>
      <div class="summary-items">
        ${items.length
          ? items
              .map(
                ([label, count]) => `
                  <div class="summary-item">
                    <span>${escapeHtml(formatter ? formatter(label) : label)}</span>
                    <span>${count}</span>
                  </div>
                `,
              )
              .join("")
          : '<p class="subdued">No review data available.</p>'}
      </div>
    </section>
  `;
}

function getResidentCategoryMeta(record) {
  if (record.submission_type === "destination_request") {
    return DESTINATION_CATEGORIES[record.category] || {
      label: formatCategoryLabel(record.category),
      color: "#6b7a8a",
    };
  }

  return getHotspotCategory(record.category);
}

function formatCategoryLabel(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeReviewStatus(status) {
  return formatCategoryLabel(status || "under_review");
}

function getHotspotCategory(categoryId) {
  return (
    HOTSPOT_CATEGORIES.find((category) => category.id === categoryId) || {
      id: categoryId,
      label: categoryId,
      color: "#5f6573",
      description: "",
    }
  );
}

function ensureLeafletAvailable() {
  if (typeof window.L !== "undefined") {
    return true;
  }

  showMapFailure();
  return false;
}

function applyMapTheme() {
  if (!appState.baseTileLayer || !appState.labelTileLayer) {
    return;
  }

  const tileConfig = getTileConfig();
  appState.baseTileLayer.setUrl(tileConfig.baseUrl);
  appState.labelTileLayer.setUrl(tileConfig.labelUrl);
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

function showMapFailure() {
  elements.mapStatus.hidden = false;
}

function hideMapFailure() {
  elements.mapStatus.hidden = true;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

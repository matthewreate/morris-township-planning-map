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

const appState = {
  map: null,
  hotspotEntries: [],
  destinationEntries: [],
  contextLayers: {},
  activeHotspotCategories: new Set(HOTSPOT_CATEGORIES.map((category) => category.id)),
  activeContextGroups: new Set(CONTEXT_GROUPS.map((group) => group.id)),
  selectedFeature: null,
  hotspotLayerGroup: null,
  destinationLayerGroup: null,
};

const elements = {
  hotspotTotal: document.getElementById("hotspot-total"),
  visibleCount: document.getElementById("visible-count"),
  categoryFilters: document.getElementById("category-filters"),
  layerToggles: document.getElementById("layer-toggles"),
  legend: document.getElementById("legend"),
  visibleHotspots: document.getElementById("visible-hotspots"),
  detailPanel: document.getElementById("detail-panel"),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    elements.detailPanel.innerHTML =
      '<p class="detail-empty">The map data could not be loaded. Check the console and confirm the site is running from a local or hosted web server.</p>';
  });
});

async function init() {
  const [hotspots, destinations, contextLines] = await Promise.all([
    loadGeoJSON("data/hotspots.geojson"),
    loadGeoJSON("data/destinations.geojson"),
    loadGeoJSON("data/context-lines.geojson"),
  ]);

  renderCategoryFilters(hotspots.features);
  renderLayerToggles();
  renderLegend();
  initializeMap();
  buildContextLayers(contextLines.features);
  buildDestinations(destinations.features);
  buildHotspots(hotspots.features);
  addMorristownMask();
  appState.map.on("moveend", renderVisibleHotspotsList);
  renderVisibleHotspotsList();
}

async function loadGeoJSON(path) {
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

  map.createPane("contextPane");
  map.getPane("contextPane").style.zIndex = 320;

  map.createPane("maskPane");
  map.getPane("maskPane").style.zIndex = 350;

  map.createPane("destinationPane");
  map.getPane("destinationPane").style.zIndex = 430;

  map.createPane("hotspotPane");
  map.getPane("hotspotPane").style.zIndex = 450;

  appState.map = map;
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
    const wrapper = document.createElement("label");
    wrapper.className = "control-item";
    wrapper.innerHTML = `
      <span class="control-main">
        <input type="checkbox" name="hotspot-category" value="${category.id}" checked />
        <span class="swatch" style="background:${category.color}"></span>
        <span class="control-text">
          <span class="control-label">${category.label}</span>
          <span class="control-hint">${category.description}</span>
        </span>
      </span>
      <span class="pill">${counts[category.id] || 0}</span>
    `;
    elements.categoryFilters.append(wrapper);
  });

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
    const wrapper = document.createElement("label");
    wrapper.className = "control-item";
    wrapper.innerHTML = `
      <span class="control-main">
        <input type="checkbox" name="context-group" value="${group.id}" checked />
        <span class="swatch-line" style="border-top-color:${group.color}"></span>
        <span class="control-text">
          <span class="control-label">${group.label}</span>
          <span class="control-hint">${group.description}</span>
        </span>
      </span>
    `;
    elements.layerToggles.append(wrapper);
  });

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

function renderLegend() {
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

  elements.legend.innerHTML = `
    <div>
      <h3 class="legend-group-title">Hotspots</h3>
      <div class="legend-items">${hotspotItems}</div>
    </div>
    <div>
      <h3 class="legend-group-title">Destinations</h3>
      <div class="legend-items">${destinationItems}</div>
    </div>
    <div>
      <h3 class="legend-group-title">Context</h3>
      <div class="legend-items">${contextItems}</div>
    </div>
    <p class="subdued">
      The central gray mask is a visual cue to de-emphasize Morristown for this
      Morris Township-focused discussion. It is not an official boundary.
    </p>
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
    title: feature.properties.title,
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
    '<p class="detail-empty">Select a hotspot or destination to view its description, category, and source details.</p>';
  refreshMarkerStyles();
}

function renderDetailPanel(kind, feature) {
  const properties = feature.properties;
  const categoryMeta =
    kind === "hotspot"
      ? getHotspotCategory(properties.category)
      : DESTINATION_CATEGORIES[properties.category] || {
          label: "Destination",
          color: "#274c5e",
        };

  const metaRows =
    kind === "hotspot"
      ? [
          ["Category", categoryMeta.label],
          ["Source Layer", properties.source_layer || "Unspecified"],
          ["Status", properties.status || "Unspecified"],
          ["Source", properties.source || "Unspecified"],
          ["Notes", properties.notes || "None added yet"],
        ]
      : [
          ["Category", categoryMeta.label],
          ["Record Type", "Destination placeholder"],
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
}

function buildPopupMarkup(feature, kind) {
  const properties = feature.properties;
  const categoryMeta =
    kind === "hotspot"
      ? getHotspotCategory(properties.category)
      : DESTINATION_CATEGORIES[properties.category] || { label: "Destination" };

  return `
    <h3>${escapeHtml(properties.title)}</h3>
    <p><strong>${categoryMeta.label}</strong></p>
    <p>${escapeHtml(properties.description || "No description provided.")}</p>
  `;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

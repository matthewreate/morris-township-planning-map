# Morris Township Planning Map

Static Leaflet prototype for reviewing Morris Township walkability and bikeability issues with a small working group. The site is designed to run as a lightweight GitHub Pages project with no build step and no backend.

## File Structure

- `index.html` sets up the page shell, sidebar sections, and Leaflet map container.
- `styles.css` contains the responsive layout and the civic/editorial visual styling.
- `script.js` loads the local GeoJSON files, initializes the Leaflet map, and manages filters, layer toggles, the visible-hotspots list, popups, and the detail panel.
- `data/hotspots.geojson` stores the TAC hotspot points normalized into the project taxonomy.
- `data/destinations.geojson` stores curated reference destinations used to interpret hotspot demand and travel patterns.
- `data/context-lines.geojson` stores sidewalk, trail, crosswalk, and township-border linework for subdued map context.
- `Incoming Data/*.kmz` contains the raw KMZ layer exports used to assemble the local planning data.

## Local Preview

Because the page fetches local GeoJSON files, open it through a small static server instead of `file://`.

```bash
cd /Users/matthewreate/Desktop/Township\ Map
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## GitHub Pages Deployment

1. Push this folder to a GitHub repository.
2. In the repository settings, open `Pages`.
3. Set the source to `Deploy from a branch`.
4. Choose your main branch and the `/ (root)` folder.
5. Save the setting and wait for GitHub Pages to publish the site.

No build process is required. All paths are relative, so the site works directly from the repository root.

## Replacing the Sample and TAC Data Later

The shipped prototype reads only local GeoJSON files at runtime. To replace the current data:

1. Export the latest Google My Maps / KML data or convert another source into GeoJSON.
2. Keep hotspot points in `data/hotspots.geojson`, destination points in `data/destinations.geojson`, and contextual linework in `data/context-lines.geojson`.
3. Preserve the existing property names used by the UI:
   - Hotspots: `id`, `title`, `category`, `description`, `status`, `source`, `notes`, `source_layer`, `latitude`, `longitude`
   - Destinations: `id`, `title`, `category`, `description`, `latitude`, `longitude`
   - Context lines: `id`, `display_group`, `source_layer`, optionally `title`, `description`
4. Keep GeoJSON coordinates in standard `[longitude, latitude]` order.
5. If you add new hotspot categories, update `HOTSPOT_CATEGORIES` in [script.js](/Users/matthewreate/Desktop/Township%20Map/script.js).

The destination layer is intentionally small and curated. It should function as a civic reference set, not an exhaustive amenity inventory.

## Future Public Input Prototype

This phase adds a static prototype of a future resident-input workflow. The public-input form, under-review map layer, and planning-group summary panel are included to demonstrate how submissions could be captured and reviewed while remaining separate from official TAC planning data.

The intended next live step is to connect the front-end submission form to a lightweight review pipeline such as Google Apps Script to Google Sheets. In that setup, new reports would enter with `review_status=under_review`, staff would review them outside the public map, and approved records could later be exported back into the site data.

The map is meant to be read in a clear hierarchy: official planning data forms the current working base, resident submissions remain separate and under review, and context layers support orientation rather than equal evidentiary weight.

## Easiest Next Steps

1. Review the imported hotspot points and confirm the category mapping from the TAC source map.
2. Keep the destination layer limited to stable schools, parks, trailheads, museums, and civic sites that help explain walking and biking demand.
3. Decide whether the full context linework is useful as-is or should be thinned into a smaller set of overlays for easier public reading.
4. If the working group wants to test real submissions, connect the prototype form to Google Sheets or another lightweight review queue before exposing anything publicly.

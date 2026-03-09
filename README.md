# Morris Township Planning Map

Static Leaflet prototype for reviewing Morris Township walkability and bikeability issues with a small working group. The site is designed to run as a lightweight GitHub Pages project with no build step and no backend.

## File Structure

- `index.html` sets up the page shell, sidebar sections, and Leaflet map container.
- `styles.css` contains the responsive layout and the civic/editorial visual styling.
- `script.js` loads the local GeoJSON files, initializes the Leaflet map, and manages filters, layer toggles, the visible-hotspots list, popups, and the detail panel.
- `data/hotspots.geojson` stores the TAC hotspot points normalized into the project taxonomy.
- `data/destinations.geojson` stores placeholder destination points for version 1.
- `data/context-lines.geojson` stores sidewalk, trail, crosswalk, and township-border linework for subdued map context.
- `Incoming Data/TAC Hot Spots Map.kmz` is the source file that points to Neil's Google My Maps export.

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

Version 1 uses placeholder destinations because Neil's TAC map did not include destination points. Those should be replaced with a working-group-approved destination list before any broader public sharing.

## Easiest Next Steps

1. Review the imported hotspot points and confirm the category mapping from the TAC source map.
2. Replace the placeholder destinations with a real list of schools, parks, trailheads, business nodes, and civic destinations the group wants to discuss.
3. Decide whether the full context linework is useful as-is or should be thinned into a smaller set of overlays for easier public reading.
4. Once the working group is comfortable with the prototype, add a structured public-input layer such as a survey link or a submission workflow backed by a separate service.

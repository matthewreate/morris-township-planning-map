# Morris Township Planning Map

Static Leaflet prototype for reviewing Morris Township walkability and bikeability issues with a small working group. The public site runs as a lightweight GitHub Pages project with no build step, and it can now be paired with a minimal Cloudflare Worker for live survey intake.

The project now has three distinct surfaces:
- `index.html` is the official planning reference used for working-group review and orientation.
- `survey.html` is the April survey-phase intake tool, where responses remain under review and separate from the official planning map.
- `review.html` is an unlinked working-group review board for reading live submissions, photos, and repeat-report signals before records are curated further.

## File Structure

- `index.html` sets up the official planning-view page shell, sidebar sections, and Leaflet map container.
- `survey.html` provides the guided Survey Mode intake page for the April survey phase.
- `review.html` provides the unlinked Working Group Review Mode page for reading live survey submissions in place.
- `styles.css` contains the responsive layout and the civic/editorial visual styling.
- `script.js` loads the local GeoJSON files, initializes the Leaflet map, and manages filters, layer toggles, the visible-hotspots list, popups, and the detail panel.
- `survey.js` manages the Survey Mode map, form switching, map-click capture, and live submission handoff to the Cloudflare intake API.
- `review.js` manages the Working Group Review Mode map, filter rail, repeat-report signals, and signed photo-detail loading.
- `cloudflare/src/index.mjs` is the minimal Worker that creates submission records, issues photo-upload authorization, and finalizes uploaded photo metadata.
- `cloudflare/schema.sql` defines the D1 schema for the live intake database.
- `cloudflare/wrangler.toml` contains the Worker bindings and placeholder environment configuration.
- `vendor/leaflet/` stores a local copy of Leaflet JS/CSS and image assets so the live map does not depend on a third-party CDN for bootstrap.
- `data/hotspots.geojson` stores the TAC hotspot points normalized into the project taxonomy.
- `data/destinations.geojson` stores curated reference destinations used to interpret hotspot demand and travel patterns.
- `data/context-lines.geojson` stores sidewalk, trail, crosswalk, and township-border linework for subdued map context.
- `data/survey-sample-submissions.json` stores mock survey-phase entries used by the Survey Mode page.
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

Core map assets are vendored locally in `vendor/leaflet/` to reduce the chance of live map bootstrap failures caused by third-party CDN availability.

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

## Live Submission Path: Cloudflare Worker + D1 + R2

The public website remains the map and survey interface. When live intake is enabled, Survey Mode submits structured records to a small Cloudflare Worker:
- the Worker stores structured submission data in D1
- optional photos are uploaded to R2
- the planning group later reviews submissions in `review.html` before anything enters the official planning record

This keeps the public site simple while still allowing real uploads from a phone or computer. The only server-side component is the Worker.

The map is meant to be read in a clear hierarchy: official planning data forms the current working base, survey responses remain separate and under review, and context layers support orientation rather than equal evidentiary weight.

## Cloudflare Setup

The minimal live stack is:
- `GitHub Pages` for the public site
- `Cloudflare Worker` for intake APIs
- `D1` for structured submission records
- `R2` for optional uploaded photos

### 1. Create the Cloudflare resources

Create:
- one D1 database
- one private R2 bucket
- one Worker using the files in `cloudflare/`

Apply the schema:

```bash
cd /Users/matthewreate/Desktop/Township\ Map/cloudflare
wrangler d1 execute morris-township-survey --file=schema.sql
```

### 2. Configure the Worker

Update `cloudflare/wrangler.toml`:
- `database_id`
- `bucket_name`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `ALLOWED_ORIGINS`

Set the R2 secret access key:

```bash
wrangler secret put R2_SECRET_ACCESS_KEY
```

The Worker expects these bindings:
- `SUBMISSIONS_DB`
- `SUBMISSION_PHOTOS`

### 3. Configure R2 CORS

Because the browser uploads directly to R2 using a short-lived signed URL, set bucket CORS to allow:
- origin: your GitHub Pages domain and local preview origin
- methods: `PUT`, `HEAD`
- headers: `Content-Type`

Keep the bucket private. Do not enable public listing.

If this is missing, the survey form will usually fail during the photo-upload step with a browser-level network error such as `Load failed`, even though the Worker itself is working.

Recommended R2 CORS values for this project:
- origins:
  - `https://matthewreate.github.io`
  - `http://localhost:8000`
- methods:
  - `PUT`
  - `HEAD`
- allowed headers:
  - `Content-Type`

### 4. Connect Survey Mode to the Worker

`survey.js` includes an `API_CONFIG` object near the top of the file.

To enable live intake:
1. Deploy the Worker.
2. Copy its public base URL into `API_CONFIG.baseUrl`.
3. Set `API_CONFIG.enabled` to `true`.

The client will then:
1. `POST /api/submissions`
2. if a photo exists, request `POST /api/submissions/:id/photo-upload-url`
3. upload the image directly to R2 with the signed URL
4. call `POST /api/submissions/:id/finalize-photo`

## Worker API

### `POST /api/submissions`
Creates a new `under_review` submission in D1.

Request body:
- `submission_type`
- `category`
- `location_text`
- `origin_area`
- `desired_destination`
- `latitude`
- `longitude`
- `description`
- `concern_mode`
- `additional_notes`
- `photo_present`

Response:
- `id`
- `review_status`
- `photo_upload_required`

### `POST /api/submissions/:id/photo-upload-url`
Returns a short-lived signed R2 upload URL for one optional image.

Request body:
- `filename`
- `content_type`

Response:
- `upload_url`
- `photo_key`
- `max_photo_size_bytes`

### `POST /api/submissions/:id/finalize-photo`
Confirms that the uploaded object exists and stores the photo metadata on the submission record.

Request body:
- `photo_key`
- `filename`
- `content_type`

### `GET /api/submissions?limit=250`
Returns the most recent submission metadata for Working Group Review Mode.

Response:
- `submissions`
- `limit`

Each submission includes:
- `id`
- `submission_type`
- `category`
- `title`
- `location_text`
- `origin_area`
- `desired_destination`
- `latitude`
- `longitude`
- `description`
- `concern_mode`
- `review_status`
- `submitted_at`
- `has_photo`

### `GET /api/submissions/:id`
Returns one full submission record for the review detail panel.

Response:
- `submission`

If a photo exists, the detail response also includes a short-lived signed `photo_url` for review display.

## Survey Mode

`survey.html` is the guided intake page for the April survey phase. It is intentionally distinct from the official planning viewer in `index.html`.

Survey Mode:
- collects two structured types of resident input: problem spots and route / destination requests
- supports map-assisted point capture or typed location text
- frames all responses as `under_review`
- accepts one optional photo upload
- submits directly to the Cloudflare intake API when `API_CONFIG` is wired in `survey.js`
- uses `data/survey-sample-submissions.json` as a sample under-review layer rather than live public storage

The planning viewer and Survey Mode are intentionally labeled as different phases of the same process:
- `Official Planning View` = working-group reference and orientation
- `Survey Intake View` = April resident input held under review
- `Working Group Review Mode` = raw submission review, repeat-report reading, and photo checking before curation

## Easiest Next Steps

1. Review the imported hotspot points and confirm the category mapping from the TAC source map.
2. Keep the destination layer limited to stable schools, parks, trailheads, museums, and civic sites that help explain walking and biking demand.
3. Decide whether the full context linework is useful as-is or should be thinned into a smaller set of overlays for easier public reading.
4. When the working group is ready for live intake, deploy the Cloudflare Worker, wire `API_CONFIG` in `survey.js`, and verify D1/R2 review flow before exposing submissions publicly.

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HOTSPOT_CATEGORIES = new Set([
  "sidewalk_gap",
  "unsafe_crossing",
  "visibility_issue",
  "speeding_concern",
  "accessibility_barrier",
  "general_hotspot",
]);
const DESTINATION_CATEGORIES = new Set(["park", "school", "trail_access", "civic", "business"]);
const SUBMISSION_TYPES = new Set(["hotspot", "destination_request"]);
const HOTSPOT_MODES = new Set(["walking", "rolling", "cycling", "safety"]);
const DESTINATION_MODES = new Set(["walking", "rolling", "cycling"]);

// Expected Worker environment:
// - binding: SUBMISSIONS_DB (D1)
// - binding: SUBMISSION_PHOTOS (R2)
// - var: ALLOWED_ORIGINS
// - var: R2_ACCOUNT_ID
// - var: R2_BUCKET_NAME
// - secret: R2_ACCESS_KEY_ID
// - secret: R2_SECRET_ACCESS_KEY

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originResponse = validateOrigin(request, env);
    if (originResponse) {
      return originResponse;
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    try {
      if (url.pathname === "/api/submissions" && request.method === "GET") {
        return await listSubmissions(request, env, url);
      }

      if (url.pathname === "/api/submissions" && request.method === "POST") {
        return await createSubmission(request, env);
      }

      const detailMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)$/);
      if (detailMatch && request.method === "GET") {
        return await getSubmissionDetail(request, env, detailMatch[1]);
      }

      const uploadMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)\/photo-upload-url$/);
      if (uploadMatch && request.method === "POST") {
        return await createPhotoUploadUrl(request, env, uploadMatch[1]);
      }

      const finalizeMatch = url.pathname.match(/^\/api\/submissions\/([^/]+)\/finalize-photo$/);
      if (finalizeMatch && request.method === "POST") {
        return await finalizePhoto(request, env, finalizeMatch[1]);
      }

      return jsonResponse(request, env, { error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse(
        request,
        env,
        {
          error: error instanceof Error ? error.message : "Unexpected server error",
        },
        500,
      );
    }
  },
};

async function createSubmission(request, env) {
  const body = await readJson(request);
  const submission = validateSubmissionPayload(body);
  const id = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const title = buildSubmissionTitle(submission);

  await env.SUBMISSIONS_DB.prepare(
    `INSERT INTO submissions (
      id, submission_type, category, title, location_text, origin_area, desired_destination,
      latitude, longitude, description, concern_mode, additional_notes, review_status, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'under_review', ?)`,
  )
    .bind(
      id,
      submission.submission_type,
      submission.category,
      title,
      submission.location_text,
      submission.origin_area,
      submission.desired_destination,
      submission.latitude,
      submission.longitude,
      submission.description,
      JSON.stringify(submission.concern_mode),
      submission.additional_notes,
      submittedAt,
    )
    .run();

  return jsonResponse(request, env, {
    id,
    review_status: "under_review",
    photo_upload_required: Boolean(submission.photo_present),
  });
}

async function listSubmissions(request, env, url) {
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 250) : 250;

  const result = await env.SUBMISSIONS_DB.prepare(
    `SELECT
      id,
      submission_type,
      category,
      title,
      location_text,
      origin_area,
      desired_destination,
      latitude,
      longitude,
      description,
      concern_mode,
      review_status,
      submitted_at,
      CASE WHEN photo_key IS NOT NULL AND photo_key != '' THEN 1 ELSE 0 END AS has_photo
    FROM submissions
    ORDER BY submitted_at DESC
    LIMIT ?`,
  )
    .bind(limit)
    .all();

  const submissions = (result.results || []).map((row) => serializeSubmissionRow(row));

  return jsonResponse(request, env, {
    submissions,
    limit,
  });
}

async function getSubmissionDetail(request, env, submissionId) {
  const row = await env.SUBMISSIONS_DB.prepare(
    `SELECT
      id,
      submission_type,
      category,
      title,
      location_text,
      origin_area,
      desired_destination,
      latitude,
      longitude,
      description,
      concern_mode,
      additional_notes,
      photo_key,
      photo_filename,
      photo_content_type,
      photo_uploaded_at,
      review_status,
      submitted_at
    FROM submissions
    WHERE id = ?`,
  )
    .bind(submissionId)
    .first();

  if (!row) {
    return jsonResponse(request, env, { error: "Submission not found." }, 404);
  }

  const submission = serializeSubmissionRow(row);
  let photoUrl = null;

  if (submission.photo_key) {
    const existingObject = await env.SUBMISSION_PHOTOS.head(submission.photo_key);
    if (existingObject) {
      photoUrl = await createSignedR2GetUrl(env, submission.photo_key, 600);
    }
  }

  return jsonResponse(request, env, {
    submission: {
      ...submission,
      photo_url: photoUrl,
    },
  });
}

async function createPhotoUploadUrl(request, env, submissionId) {
  const body = await readJson(request);
  const filename = sanitizeFilename(body.filename || "");
  const contentType = String(body.content_type || "").trim().toLowerCase();
  const size = Number(body.size || 0);

  if (!filename) {
    return jsonResponse(request, env, { error: "A photo filename is required." }, 400);
  }

  if (!ACCEPTED_PHOTO_TYPES.has(contentType)) {
    return jsonResponse(request, env, { error: "Only JPG, PNG, or WebP images are accepted." }, 400);
  }

  if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_SIZE_BYTES) {
    return jsonResponse(request, env, { error: "Photo size must be less than 10 MB." }, 400);
  }

  const submission = await getSubmission(env, submissionId);
  if (!submission) {
    return jsonResponse(request, env, { error: "Submission not found." }, 404);
  }

  if (submission.photo_key) {
    return jsonResponse(request, env, { error: "A photo is already attached to this submission." }, 409);
  }

  const now = new Date();
  const photoKey = buildPhotoKey(now, submissionId, filename);
  const uploadUrl = await createSignedR2PutUrl(env, photoKey, contentType, 300);

  return jsonResponse(request, env, {
    upload_url: uploadUrl,
    photo_key: photoKey,
    max_photo_size_bytes: MAX_PHOTO_SIZE_BYTES,
  });
}

async function finalizePhoto(request, env, submissionId) {
  const body = await readJson(request);
  const photoKey = String(body.photo_key || "").trim();
  const filename = sanitizeFilename(body.filename || "");
  const contentType = String(body.content_type || "").trim().toLowerCase();

  if (!photoKey || !filename || !ACCEPTED_PHOTO_TYPES.has(contentType)) {
    return jsonResponse(request, env, { error: "Photo metadata is incomplete." }, 400);
  }

  const submission = await getSubmission(env, submissionId);
  if (!submission) {
    return jsonResponse(request, env, { error: "Submission not found." }, 404);
  }

  const existingObject = await env.SUBMISSION_PHOTOS.head(photoKey);
  if (!existingObject) {
    return jsonResponse(request, env, { error: "Uploaded photo was not found in storage." }, 400);
  }

  if (existingObject.size > MAX_PHOTO_SIZE_BYTES) {
    await env.SUBMISSION_PHOTOS.delete(photoKey);
    return jsonResponse(request, env, { error: "Uploaded photo exceeds the 10 MB limit." }, 400);
  }

  await env.SUBMISSIONS_DB.prepare(
    `UPDATE submissions
      SET photo_key = ?, photo_filename = ?, photo_content_type = ?, photo_uploaded_at = ?
      WHERE id = ?`,
  )
    .bind(photoKey, filename, contentType, new Date().toISOString(), submissionId)
    .run();

  return jsonResponse(request, env, {
    id: submissionId,
    review_status: "under_review",
    photo_attached: true,
  });
}

async function getSubmission(env, submissionId) {
  const result = await env.SUBMISSIONS_DB.prepare(
    "SELECT id, photo_key FROM submissions WHERE id = ?",
  )
    .bind(submissionId)
    .first();

  return result || null;
}

function serializeSubmissionRow(row) {
  return {
    id: row.id,
    submission_type: row.submission_type,
    category: row.category,
    title: row.title,
    location_text: row.location_text,
    origin_area: row.origin_area || "",
    desired_destination: row.desired_destination || "",
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    description: row.description,
    concern_mode: parseConcernMode(row.concern_mode),
    additional_notes: row.additional_notes || "",
    review_status: row.review_status,
    submitted_at: row.submitted_at,
    has_photo: Boolean(row.has_photo || row.photo_key),
    photo_key: row.photo_key || "",
    photo_filename: row.photo_filename || "",
    photo_content_type: row.photo_content_type || "",
    photo_uploaded_at: row.photo_uploaded_at || null,
  };
}

function parseConcernMode(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function validateSubmissionPayload(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Submission payload must be a JSON object.");
  }

  const submissionType = String(body.submission_type || "").trim();
  const category = String(body.category || "").trim();
  const locationText = String(body.location_text || "").trim();
  const originArea = String(body.origin_area || "").trim();
  const desiredDestination = String(body.desired_destination || "").trim();
  const description = String(body.description || "").trim();
  const additionalNotes = String(body.additional_notes || "").trim();
  const concernMode = Array.isArray(body.concern_mode)
    ? body.concern_mode.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const latitude = parseCoordinate(body.latitude);
  const longitude = parseCoordinate(body.longitude);
  const photoPresent = Boolean(body.photo_present);

  if (!SUBMISSION_TYPES.has(submissionType)) {
    throw new Error("Submission type is invalid.");
  }

  if (!locationText) {
    throw new Error("Location description is required.");
  }

  if (!description) {
    throw new Error("A description is required.");
  }

  if (concernMode.length === 0) {
    throw new Error("At least one travel mode is required.");
  }

  const categorySet = submissionType === "destination_request" ? DESTINATION_CATEGORIES : HOTSPOT_CATEGORIES;
  if (!categorySet.has(category)) {
    throw new Error("Category is invalid.");
  }

  const allowedModes = submissionType === "destination_request" ? DESTINATION_MODES : HOTSPOT_MODES;
  if (concernMode.some((mode) => !allowedModes.has(mode))) {
    throw new Error("Mode selection is invalid.");
  }

  if (submissionType === "destination_request") {
    if (!originArea) {
      throw new Error("Origin area is required for route requests.");
    }

    if (!desiredDestination) {
      throw new Error("Destination is required for route requests.");
    }
  }

  return {
    submission_type: submissionType,
    category,
    location_text: locationText,
    origin_area: originArea,
    desired_destination: desiredDestination,
    latitude,
    longitude,
    description,
    concern_mode: concernMode,
    additional_notes: additionalNotes,
    photo_present: photoPresent,
  };
}

function parseCoordinate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildSubmissionTitle(submission) {
  if (submission.submission_type === "destination_request") {
    const fromText = submission.origin_area ? `From ${submission.origin_area}` : "Route request";
    const destinationText = submission.desired_destination ? `to ${submission.desired_destination}` : "to destination";
    const modeText = submission.concern_mode.length > 0 ? `by ${formatModeList(submission.concern_mode)}` : "";
    return `${fromText} ${destinationText}${modeText ? ` ${modeText}` : ""}`;
  }

  return submission.location_text;
}

function buildPhotoKey(date, submissionId, filename) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `submissions/${year}/${month}/${submissionId}/${filename}`;
}

function sanitizeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

async function createSignedR2PutUrl(env, photoKey, contentType, expiresInSeconds) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const method = "PUT";
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${awsEncodeUriPath(env.R2_BUCKET_NAME)}/${awsEncodeUriPath(photoKey)}`;
  const signedHeaders = "content-type;host";

  const queryParams = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${env.R2_ACCESS_KEY_ID}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  const canonicalQueryString = queryParams
    .slice()
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${awsEncodeQueryValue(key)}=${awsEncodeQueryValue(value)}`)
    .join("&");

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(env.R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

async function createSignedR2GetUrl(env, photoKey, expiresInSeconds) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const method = "GET";
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${awsEncodeUriPath(env.R2_BUCKET_NAME)}/${awsEncodeUriPath(photoKey)}`;
  const signedHeaders = "host";

  const queryParams = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${env.R2_ACCESS_KEY_ID}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  const canonicalQueryString = queryParams
    .slice()
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${awsEncodeQueryValue(key)}=${awsEncodeQueryValue(value)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(env.R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function formatAmzDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

async function getSignatureKey(secretKey, dateStamp, regionName, serviceName) {
  const kDate = await hmacRaw(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacRaw(kDate, regionName);
  const kService = await hmacRaw(kRegion, serviceName);
  return hmacRaw(kService, "aws4_request");
}

async function hmacRaw(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toUint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, toUint8Array(value));
  return new Uint8Array(signature);
}

async function hmacHex(key, value) {
  const bytes = await hmacRaw(key, value);
  return toHex(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", toUint8Array(value));
  return toHex(new Uint8Array(digest));
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  return new TextEncoder().encode(String(value));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function awsEncodeUriPath(value) {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function awsEncodeQueryValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatModeList(values) {
  const labels = values.map(formatModeValue).filter(Boolean);

  if (labels.length === 0) {
    return "unspecified mode";
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
    walking: "walking",
    rolling: "rolling",
    cycling: "cycling",
    safety: "safety emphasis",
  };

  return labels[value] || value;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_error) {
    throw new Error("Request body must be valid JSON.");
  }
}

function validateOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || originAllowed(origin, env)) {
    return null;
  }

  return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
}

function originAllowed(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    return true;
  }

  return allowed.includes(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin && originAllowed(origin, env) ? origin : "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

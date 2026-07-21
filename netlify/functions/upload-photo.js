// Uploads a property photo (already resized/compressed client-side) into
// assets/properties/ in the misbaah-BigB/huvadhoo-website repo via the
// GitHub API, gated behind the same admin_session cookie as
// save-homepage.js. The session-cookie verification below is duplicated
// from save-homepage.js rather than shared — see that file's top comment
// for why (these are two independent serverless functions and this is a
// from-scratch reimplementation of the same signing scheme, HMAC-SHA256
// keyed on a SHA-256 hash of ADMIN_PASSWORD over "<expiry-ms>"). Keep the
// two in sync if that scheme ever changes.
const crypto = require("crypto");

const COOKIE_NAME = "admin_session";
const REPO_OWNER = "misbaah-BigB";
const REPO_NAME = "huvadhoo-website";
const TARGET_BRANCH = "main";
const UPLOAD_DIR = "assets/properties";

// Matches the client's compression target (resize to <=1600px longest side,
// ~80% JPEG quality) with headroom — a photo that's still this big after
// compression is almost certainly not a normal property photo.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_FILENAME_ATTEMPTS = 5;

function signSession(expiry, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  return crypto.createHmac("sha256", key).update(String(expiry)).digest("hex");
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function verifySessionCookieValue(value, secret) {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [expiryStr, signature] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const expected = signSession(expiry, secret);
  return timingSafeEqualHex(signature, expected);
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, private" },
    body: JSON.stringify(body),
  };
}

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "property-photo";
}

function randomSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return jsonResponse(503, { error: "This dashboard is not yet configured. The site owner needs to set the ADMIN_PASSWORD environment variable." });
  }

  const cookieHeader = (event.headers && (event.headers.cookie || event.headers.Cookie)) || "";
  const sessionValue = getCookie(cookieHeader, COOKIE_NAME);
  const authenticated = verifySessionCookieValue(sessionValue, adminPassword);
  if (!authenticated) {
    return jsonResponse(401, { error: "Your session has expired. Please log in again." });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return jsonResponse(500, { error: "Photo uploads aren't configured yet. The site owner needs to set the GITHUB_TOKEN environment variable." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return jsonResponse(400, { error: "Invalid request — could not read the uploaded photo data." });
  }

  const rawImage = typeof payload.imageBase64 === "string" ? payload.imageBase64 : "";
  const imageBase64 = rawImage.replace(/^data:[^;]+;base64,/, "");
  if (!imageBase64) {
    return jsonResponse(400, { error: "No photo data was received." });
  }

  let buffer;
  try {
    buffer = Buffer.from(imageBase64, "base64");
  } catch (err) {
    return jsonResponse(400, { error: "The photo data could not be read." });
  }

  if (!buffer.length) {
    return jsonResponse(400, { error: "No photo data was received." });
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);
    return jsonResponse(400, { error: `That photo is still too large (${sizeMb} MB) after compression. Please choose a smaller photo.` });
  }

  const nameHint = typeof payload.nameHint === "string" ? payload.nameHint : "";
  const slug = slugify(nameHint);

  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "huvadhoo-admin-dashboard",
  };

  // Pick a filename that doesn't already exist in the repo. A random 8-hex
  // suffix makes a collision astronomically unlikely on the first try, but
  // we check with GitHub and retry with a fresh suffix just in case.
  let filename = null;
  let apiUrl = null;
  for (let attempt = 0; attempt < MAX_FILENAME_ATTEMPTS; attempt++) {
    const candidate = `${slug}-${randomSuffix()}.jpg`;
    const candidateUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${UPLOAD_DIR}/${candidate}`;

    let checkRes;
    try {
      checkRes = await fetch(`${candidateUrl}?ref=${TARGET_BRANCH}`, { headers: githubHeaders });
    } catch (err) {
      return jsonResponse(502, { error: "Could not reach GitHub to prepare the upload." });
    }

    if (checkRes.status === 404) {
      filename = candidate;
      apiUrl = candidateUrl;
      break;
    }
    if (checkRes.status === 401 || checkRes.status === 403) {
      return jsonResponse(502, { error: "GitHub rejected the request — the GITHUB_TOKEN may be invalid or missing permission." });
    }
    // Any other outcome (200 = filename taken, or a transient error) just
    // means we try again with a new random suffix.
  }

  if (!filename) {
    return jsonResponse(502, { error: "Could not generate a unique filename for this photo. Please try again." });
  }

  const path = `${UPLOAD_DIR}/${filename}`;

  let putRes;
  try {
    putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...githubHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Upload property photo (${filename}) via admin dashboard`,
        content: imageBase64,
        branch: TARGET_BRANCH,
      }),
    });
  } catch (err) {
    return jsonResponse(502, { error: "Could not reach GitHub to upload the photo." });
  }

  if (!putRes.ok) {
    let details = "";
    try {
      const errBody = await putRes.json();
      details = errBody && errBody.message ? errBody.message : "";
    } catch (err) {
      // ignore — details stays empty
    }
    const suffix = details ? `: ${details}` : "";
    if (putRes.status === 401 || putRes.status === 403) {
      return jsonResponse(502, { error: `GitHub rejected the upload — the GITHUB_TOKEN may be invalid or missing permission${suffix}` });
    }
    return jsonResponse(502, { error: `Could not upload the photo to GitHub (status ${putRes.status})${suffix}` });
  }

  return jsonResponse(200, { success: true, path, size: buffer.length });
};

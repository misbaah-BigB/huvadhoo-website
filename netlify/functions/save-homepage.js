// Reads and updates a page's content/<page>.json file in the
// misbaah-BigB/huvadhoo-website repo via the GitHub API, gated behind the
// same admin_session cookie the password-gate edge function
// (admin/netlify/edge-functions/admin-gate.ts) issues on login. This
// function can't literally share code with that Deno edge function, so the
// session-cookie verification below is a from-scratch reimplementation of
// the *same* signing scheme (HMAC-SHA256, keyed on a SHA-256 hash of
// ADMIN_PASSWORD, over "<expiry-ms>") using Node's built-in crypto module —
// it must stay in sync if that scheme ever changes.
const crypto = require("crypto");

const COOKIE_NAME = "admin_session";
const REPO_OWNER = "misbaah-BigB";
const REPO_NAME = "huvadhoo-website";
const TARGET_BRANCH = "main";

// Whitelist of editable pages — the GitHub API call is built from this, so a
// request can never be used to read/write any file outside content/*.json.
const PAGES = {
  homepage: { file: "content/homepage.json", label: "Homepage" },
  resorts: { file: "content/resorts.json", label: "Resorts" },
  guesthouses: { file: "content/guesthouses.json", label: "Guesthouses" },
  combo: { file: "content/combo.json", label: "Combo" },
  honeymoon: { file: "content/honeymoon.json", label: "Honeymoon" },
  family: { file: "content/family.json", label: "Family" },
  diving: { file: "content/diving.json", label: "Diving" },
  fishing: { file: "content/fishing.json", label: "Fishing" },
  camping: { file: "content/camping.json", label: "Camping" },
};
const DEFAULT_PAGE = "homepage";

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

exports.handler = async (event) => {
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
    return jsonResponse(500, { error: "Saving isn't configured yet. The site owner needs to set the GITHUB_TOKEN environment variable." });
  }

  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "huvadhoo-admin-dashboard",
  };

  if (event.httpMethod === "GET") {
    const pageKey = (event.queryStringParameters && event.queryStringParameters.page) || DEFAULT_PAGE;
    const page = PAGES[pageKey];
    if (!page) {
      return jsonResponse(400, { error: `Unknown page "${pageKey}".` });
    }
    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${page.file}`;
    return readCurrentContent(apiUrl, githubHeaders);
  }

  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch (err) {
      return jsonResponse(400, { error: "Invalid request — could not read the submitted form data." });
    }

    const pageKey = typeof payload.page === "string" ? payload.page : DEFAULT_PAGE;
    const page = PAGES[pageKey];
    if (!page) {
      return jsonResponse(400, { error: `Unknown page "${pageKey}".` });
    }
    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${page.file}`;
    return saveNewContent(apiUrl, githubHeaders, page.label, payload);
  }

  return jsonResponse(405, { error: "Method not allowed." });
};

async function readCurrentContent(apiUrl, githubHeaders) {
  let getRes;
  try {
    getRes = await fetch(`${apiUrl}?ref=${TARGET_BRANCH}`, { headers: githubHeaders });
  } catch (err) {
    return jsonResponse(502, { error: "Could not reach GitHub to load the current banner content." });
  }

  if (!getRes.ok) {
    return jsonResponse(502, { error: `Could not load the current banner content from GitHub (status ${getRes.status}).` });
  }

  let file;
  try {
    file = await getRes.json();
  } catch (err) {
    return jsonResponse(502, { error: "GitHub returned an unexpected response while loading the current content." });
  }

  let parsed;
  try {
    const raw = Buffer.from(file.content, "base64").toString("utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    return jsonResponse(502, { error: "The current content file could not be read as valid JSON." });
  }

  return jsonResponse(200, {
    bannerImage: parsed.bannerImage || "",
    bannerHeadline: parsed.bannerHeadline || "",
    bannerSubtext: parsed.bannerSubtext || "",
  });
}

async function saveNewContent(apiUrl, githubHeaders, pageLabel, payload) {
  const bannerHeadline = typeof payload.bannerHeadline === "string" ? payload.bannerHeadline : "";
  const bannerSubtext = typeof payload.bannerSubtext === "string" ? payload.bannerSubtext : "";
  const bannerImage = typeof payload.bannerImage === "string" ? payload.bannerImage : "";

  if (!bannerHeadline.trim() || !bannerImage.trim()) {
    return jsonResponse(400, { error: "Headline and image path can't be empty." });
  }

  // 1. Fetch the current file to get its sha — the GitHub API requires this
  // to prove we're updating the version we think we're updating.
  let getRes;
  try {
    getRes = await fetch(`${apiUrl}?ref=${TARGET_BRANCH}`, { headers: githubHeaders });
  } catch (err) {
    return jsonResponse(502, { error: "Could not reach GitHub to prepare the save." });
  }

  if (!getRes.ok) {
    return jsonResponse(502, { error: `Could not read the current file from GitHub before saving (status ${getRes.status}).` });
  }

  let currentFile;
  try {
    currentFile = await getRes.json();
  } catch (err) {
    return jsonResponse(502, { error: "GitHub returned an unexpected response while preparing the save." });
  }

  const sha = currentFile.sha;
  if (!sha) {
    return jsonResponse(502, { error: "Could not determine the current file version on GitHub." });
  }

  // 2. Write the update.
  const newContent = JSON.stringify({ bannerImage, bannerHeadline, bannerSubtext }, null, 2) + "\n";
  const contentBase64 = Buffer.from(newContent, "utf-8").toString("base64");

  let putRes;
  try {
    putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...githubHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Update ${pageLabel} banner via admin dashboard`,
        content: contentBase64,
        sha,
        branch: TARGET_BRANCH,
      }),
    });
  } catch (err) {
    return jsonResponse(502, { error: "Could not reach GitHub to save the update." });
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
      return jsonResponse(502, { error: `GitHub rejected the save — the GITHUB_TOKEN may be invalid or missing permission${suffix}` });
    }
    return jsonResponse(502, { error: `Could not save the update to GitHub (status ${putRes.status})${suffix}` });
  }

  return jsonResponse(200, { success: true, bannerImage, bannerHeadline, bannerSubtext });
}

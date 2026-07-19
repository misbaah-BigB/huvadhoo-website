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

// Each editable page/section maps to exactly one file and one "prepare"
// function that both validates the submitted content and rebuilds it field
// by field (rather than writing the raw request body) so a save can never
// smuggle in unexpected keys. The GitHub API call is always built from this
// whitelist, so a request can never be used to read/write any file outside
// content/*.json.
const PAGES = {
  homepage: { file: "content/homepage.json", prepare: prepareBannerContent, commitMessage: "Update Homepage banner via admin dashboard" },
  resorts: { file: "content/resorts.json", prepare: prepareBannerContent, commitMessage: "Update Resorts banner via admin dashboard" },
  guesthouses: { file: "content/guesthouses.json", prepare: prepareBannerContent, commitMessage: "Update Guesthouses banner via admin dashboard" },
  combo: { file: "content/combo.json", prepare: prepareBannerContent, commitMessage: "Update Combo banner via admin dashboard" },
  honeymoon: { file: "content/honeymoon.json", prepare: prepareBannerContent, commitMessage: "Update Honeymoon banner via admin dashboard" },
  family: { file: "content/family.json", prepare: prepareBannerContent, commitMessage: "Update Family banner via admin dashboard" },
  diving: { file: "content/diving.json", prepare: prepareBannerContent, commitMessage: "Update Diving banner via admin dashboard" },
  fishing: { file: "content/fishing.json", prepare: prepareBannerContent, commitMessage: "Update Fishing banner via admin dashboard" },
  camping: { file: "content/camping.json", prepare: prepareBannerContent, commitMessage: "Update Camping banner via admin dashboard" },
  "resorts-pricing": { file: "content/resorts-pricing.json", prepare: prepareResortsPricingContent, commitMessage: "Update Resorts Pricing via admin dashboard" },
};
const DEFAULT_PAGE = "homepage";

function str(value) {
  return typeof value === "string" ? value : "";
}

function prepareBannerContent(payload) {
  const bannerHeadline = str(payload.bannerHeadline);
  const bannerSubtext = str(payload.bannerSubtext);
  const bannerImage = str(payload.bannerImage);
  if (!bannerHeadline.trim() || !bannerImage.trim()) {
    return { error: "Headline and image path can't be empty." };
  }
  return { content: { bannerImage, bannerHeadline, bannerSubtext } };
}

function prepareResortsPricingContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const intro = str(payload.intro);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.categories) || payload.categories.length === 0) {
    return { error: "At least one category is required." };
  }

  const categories = [];
  for (const raw of payload.categories) {
    const cat = raw && typeof raw === "object" ? raw : {};
    const name = str(cat.name);
    const price = str(cat.price);
    if (!name.trim() || !price.trim()) {
      return { error: "Each category needs at least a name and a price." };
    }
    categories.push({
      tier: str(cat.tier),
      name,
      description: str(cat.description),
      bestFor: str(cat.bestFor),
      price,
    });
  }

  return { content: { eyebrow, heading, intro, categories } };
}

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
    return saveNewContent(apiUrl, githubHeaders, page, payload);
  }

  return jsonResponse(405, { error: "Method not allowed." });
};

async function readCurrentContent(apiUrl, githubHeaders) {
  let getRes;
  try {
    getRes = await fetch(`${apiUrl}?ref=${TARGET_BRANCH}`, { headers: githubHeaders });
  } catch (err) {
    return jsonResponse(502, { error: "Could not reach GitHub to load the current content." });
  }

  if (!getRes.ok) {
    return jsonResponse(502, { error: `Could not load the current content from GitHub (status ${getRes.status}).` });
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

  return jsonResponse(200, parsed);
}

async function saveNewContent(apiUrl, githubHeaders, page, payload) {
  const prepared = page.prepare(payload);
  if (prepared.error) {
    return jsonResponse(400, { error: prepared.error });
  }
  const content = prepared.content;

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
  const newContent = JSON.stringify(content, null, 2) + "\n";
  const contentBase64 = Buffer.from(newContent, "utf-8").toString("base64");

  let putRes;
  try {
    putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...githubHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: page.commitMessage,
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

  return jsonResponse(200, Object.assign({ success: true }, content));
}

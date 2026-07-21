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
  "resorts-comparison": { file: "content/resorts-comparison.json", prepare: prepareResortsComparisonContent, commitMessage: "Update Resorts Comparison Table via admin dashboard" },
  "resorts-why-us": { file: "content/resorts-why-us.json", prepare: prepareResortsWhyUsContent, commitMessage: "Update Resorts Why Us section via admin dashboard" },
  "resorts-cta": { file: "content/resorts-cta.json", prepare: prepareResortsCtaContent, commitMessage: "Update Resorts CTA band via admin dashboard" },
  properties: { file: "content/properties.json", prepare: preparePropertiesContent, commitMessage: "Update Properties via admin dashboard" },
  "guesthouses-price-band": { file: "content/guesthouses-price-band.json", prepare: prepareGuesthousesPriceBandContent, commitMessage: "Update Guesthouses Price Band via admin dashboard" },
  "guesthouses-included": { file: "content/guesthouses-included.json", prepare: prepareGuesthousesIncludedContent, commitMessage: "Update Guesthouses \"What's included\" section via admin dashboard" },
  "guesthouses-islands": { file: "content/guesthouses-islands.json", prepare: prepareGuesthousesIslandsContent, commitMessage: "Update Guesthouses Popular Islands grid via admin dashboard" },
  "guesthouses-rules": { file: "content/guesthouses-rules.json", prepare: prepareGuesthousesRulesContent, commitMessage: "Update Guesthouses Local Island Rules callout via admin dashboard" },
  "guesthouses-why-us": { file: "content/guesthouses-why-us.json", prepare: prepareGuesthousesWhyUsContent, commitMessage: "Update Guesthouses Why Us section via admin dashboard" },
  "guesthouses-cta": { file: "content/guesthouses-cta.json", prepare: prepareGuesthousesCtaContent, commitMessage: "Update Guesthouses CTA band via admin dashboard" },
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

function prepareResortsComparisonContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const intro = str(payload.intro);
  const factorLabel = str(payload.factorLabel);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
    return { error: "At least one column is required." };
  }
  const columns = payload.columns.map(str);
  if (columns.some((c) => !c.trim())) {
    return { error: "Column headers can't be empty." };
  }
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    return { error: "At least one row is required." };
  }

  const rows = [];
  for (const raw of payload.rows) {
    const row = raw && typeof raw === "object" ? raw : {};
    const factor = str(row.factor);
    if (!factor.trim()) {
      return { error: "Each row needs a factor label." };
    }
    const values = Array.isArray(row.values) ? row.values.map(str) : [];
    if (values.length !== columns.length) {
      return { error: "Each row must have exactly one value per column." };
    }
    rows.push({ factor, values });
  }

  return { content: { eyebrow, heading, intro, factorLabel, columns, rows } };
}

function prepareResortsWhyUsContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.cards) || payload.cards.length === 0) {
    return { error: "At least one card is required." };
  }

  const cards = [];
  for (const raw of payload.cards) {
    const card = raw && typeof raw === "object" ? raw : {};
    const title = str(card.title);
    if (!title.trim()) {
      return { error: "Each card needs a title." };
    }
    cards.push({ title, text: str(card.text) });
  }

  return { content: { eyebrow, heading, cards } };
}

function prepareResortsCtaContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const subtext = str(payload.subtext);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }

  return { content: { eyebrow, heading, subtext } };
}

const PROPERTY_CATEGORIES = ["resort", "guesthouse", "city-hotel", "dive-centre", "fishing-charter"];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Unlike every other page here, content/properties.json is a variable-length
// list: entries get added, edited, and deleted from the admin dashboard. The
// client always sends the *entire* intended array back (its own local copy,
// mutated for whichever add/edit/delete just happened) rather than a single
// entry — so this still fits the same "replace the whole file with this
// validated content" shape as every other prepare function, it just
// validates a list instead of a fixed set of fields.
function preparePropertiesContent(payload) {
  if (!Array.isArray(payload.properties)) {
    return { error: "Properties must be a list." };
  }

  const seenIds = new Set();
  const properties = [];
  for (const raw of payload.properties) {
    const prop = raw && typeof raw === "object" ? raw : {};
    const id = str(prop.id).trim();
    const name = str(prop.name).trim();
    const category = str(prop.category).trim();

    if (!id || !SLUG_PATTERN.test(id)) {
      return { error: `Each property needs a valid URL-safe id (got "${id || "(empty)"}").` };
    }
    if (seenIds.has(id)) {
      return { error: `Duplicate property id "${id}" — ids must be unique.` };
    }
    seenIds.add(id);

    if (!name) {
      return { error: "Each property needs a name." };
    }
    if (!PROPERTY_CATEGORIES.includes(category)) {
      return { error: `Unknown category "${category}".` };
    }

    const photos = Array.isArray(prop.photos)
      ? prop.photos.map(str).map((s) => s.trim()).filter(Boolean)
      : [];
    const highlights = Array.isArray(prop.highlights)
      ? prop.highlights.map(str).map((s) => s.trim()).filter(Boolean)
      : [];

    properties.push({
      id,
      category,
      name,
      location: str(prop.location),
      shortIntro: str(prop.shortIntro),
      photos,
      highlights,
    });
  }

  return { content: properties };
}

function prepareGuesthousesPriceBandContent(payload) {
  if (!Array.isArray(payload.stats) || payload.stats.length === 0) {
    return { error: "At least one stat is required." };
  }

  const stats = [];
  for (const raw of payload.stats) {
    const stat = raw && typeof raw === "object" ? raw : {};
    const label = str(stat.label);
    const value = str(stat.value);
    if (!label.trim() || !value.trim()) {
      return { error: "Each stat needs at least a label and a value." };
    }
    stats.push({ label, value, sublabel: str(stat.sublabel) });
  }

  return { content: { stats } };
}

function prepareGuesthousesIncludedContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.cards) || payload.cards.length === 0) {
    return { error: "At least one card is required." };
  }

  const cards = [];
  for (const raw of payload.cards) {
    const card = raw && typeof raw === "object" ? raw : {};
    const title = str(card.title);
    if (!title.trim()) {
      return { error: "Each card needs a title." };
    }
    cards.push({ title, text: str(card.text) });
  }

  return { content: { eyebrow, heading, cards } };
}

function prepareGuesthousesIslandsContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const intro = str(payload.intro);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.islands) || payload.islands.length === 0) {
    return { error: "At least one island is required." };
  }

  const islands = [];
  for (const raw of payload.islands) {
    const island = raw && typeof raw === "object" ? raw : {};
    const name = str(island.name);
    if (!name.trim()) {
      return { error: "Each island needs a name." };
    }
    islands.push({ atoll: str(island.atoll), name, description: str(island.description) });
  }

  return { content: { eyebrow, heading, intro, islands } };
}

function prepareGuesthousesRulesContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const intro = str(payload.intro);
  const linkText = str(payload.linkText);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.rules) || payload.rules.length === 0) {
    return { error: "At least one rule is required." };
  }

  const rules = [];
  for (const raw of payload.rules) {
    const rule = raw && typeof raw === "object" ? raw : {};
    const label = str(rule.label);
    const value = str(rule.value);
    if (!label.trim() || !value.trim()) {
      return { error: "Each rule needs both a label and a value." };
    }
    rules.push({ label, value });
  }

  return { content: { eyebrow, heading, intro, linkText, rules } };
}

function prepareGuesthousesWhyUsContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }
  if (!Array.isArray(payload.cards) || payload.cards.length === 0) {
    return { error: "At least one card is required." };
  }

  const cards = [];
  for (const raw of payload.cards) {
    const card = raw && typeof raw === "object" ? raw : {};
    const title = str(card.title);
    if (!title.trim()) {
      return { error: "Each card needs a title." };
    }
    cards.push({ title, text: str(card.text) });
  }

  return { content: { eyebrow, heading, cards } };
}

function prepareGuesthousesCtaContent(payload) {
  const eyebrow = str(payload.eyebrow);
  const heading = str(payload.heading);
  const subtext = str(payload.subtext);

  if (!heading.trim()) {
    return { error: "Heading can't be empty." };
  }

  return { content: { eyebrow, heading, subtext } };
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

  // Keep this consistent with the POST success response below: an
  // array-shaped file (content/properties.json) is always returned wrapped
  // as { properties: [...] }, never as a bare top-level array, so the client
  // doesn't need two different code paths depending on request method.
  return jsonResponse(200, Array.isArray(parsed) ? { properties: parsed } : parsed);
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

  // content/properties.json's content is an array (unlike every other page's
  // object), so it can't just be spread onto { success: true } the way the
  // others are — that would scatter it across numeric keys instead of
  // returning a usable list. Wrap it under a "properties" key instead.
  const responseBody = Array.isArray(content)
    ? { success: true, properties: content }
    : Object.assign({ success: true }, content);
  return jsonResponse(200, responseBody);
}

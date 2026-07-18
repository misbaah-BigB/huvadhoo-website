import type { Context } from "@netlify/edge-functions";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const PAGE_STYLE = `
  :root{ --sand:#F5EEDF; --ink:#0B2A2E; --teal:#1F7A6C; }
  *{box-sizing:border-box;}
  html,body{height:100%;}
  body{
    margin:0; display:flex; align-items:center; justify-content:center;
    min-height:100vh; background:var(--sand); color:var(--ink);
    font-family:'Inter', sans-serif; text-align:center; padding:24px;
  }
  .admin-box{max-width:440px;}
  h1{
    font-family:'Fraunces', serif; font-weight:600;
    font-size:clamp(24px,4vw,32px); margin:0 0 12px;
  }
  p.lede{ margin:0 0 24px; font-size:15.5px; color:var(--ink); opacity:.75; }
  p.error{ margin:0 0 18px; font-size:14px; color:#b23b3b; font-weight:600; }
  input[type="password"]{
    width:100%; font-family:'Inter', sans-serif; font-size:15px;
    padding:12px 16px; border:1px solid rgba(11,42,46,.25); border-radius:10px;
    margin-bottom:16px; background:#fff; color:var(--ink);
  }
  button{
    font-family:'Inter', sans-serif; font-weight:600; font-size:15.5px;
    color:#fff; background:var(--teal); border:none; border-radius:999px;
    padding:14px 34px; cursor:pointer; transition:transform .2s ease, box-shadow .2s ease;
  }
  button:hover{ transform:translateY(-2px); box-shadow:0 10px 24px rgba(31,122,108,.3); }
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Huvadhoo Admin</title>
${FONT_LINK}
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="admin-box">
${body}
</div>
</body>
</html>`;
}

function notConfiguredHtml(): string {
  return pageShell(
    "Admin Setup Needed",
    `<h1>Huvadhoo Admin</h1>
<p class="lede">This page is not yet configured. The site owner needs to set the ADMIN_PASSWORD environment variable.</p>`
  );
}

function passwordFormHtml(showError: boolean): string {
  return pageShell(
    "Admin Login",
    `<h1>Huvadhoo Admin</h1>
<p class="lede">Enter the admin password to continue.</p>
${showError ? '<p class="error">Incorrect password. Please try again.</p>' : ""}
<form method="POST" action="/">
  <input type="password" name="password" placeholder="Password" required autofocus>
  <button type="submit">Log In</button>
</form>`
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}

// Constant-time comparison so a mismatch can't be timed to leak how many
// leading characters/bytes were correct.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function passwordsMatch(submitted: string, correct: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(submitted), sha256Hex(correct)]);
  return timingSafeEqual(a, b);
}

// Session tokens are "<expiry>.<hmac>", signed with a key derived from the
// admin password itself — so changing ADMIN_PASSWORD instantly invalidates
// every existing session, with no separate session secret to manage.
async function signSession(expiry: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiry)));
  return toHex(sig);
}

async function createSessionCookieValue(secret: string): Promise<string> {
  const expiry = Date.now() + SESSION_TTL_MS;
  const signature = await signSession(expiry, secret);
  return `${expiry}.${signature}`;
}

async function verifySessionCookieValue(value: string, secret: string): Promise<boolean> {
  const [expiryStr, signature] = value.split(".");
  if (!expiryStr || !signature) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const expected = await signSession(expiry, secret);
  return timingSafeEqual(signature, expected);
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookieHeader(value: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

// Every response below is specific to one visitor's auth state (the gate
// itself, or their freshly-unlocked dashboard) and must never be reused for
// a different visitor by a shared cache — so every response, including the
// pass-through to the real dashboard, gets these headers explicitly rather
// than trusting whatever a static asset's own default caching headers are.
function noStoreHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers({ "cache-control": "no-store, private" });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return headers;
}

export default async (request: Request, context: Context) => {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");

  if (!adminPassword) {
    return new Response(notConfiguredHtml(), {
      status: 503,
      headers: noStoreHeaders({ "content-type": "text/html; charset=utf-8" }),
    });
  }

  const url = new URL(request.url);

  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: noStoreHeaders({
        "location": "/",
        "set-cookie": sessionCookieHeader("", 0),
      }),
    });
  }

  if (request.method === "POST" && url.pathname === "/") {
    const form = await request.formData();
    const submitted = String(form.get("password") ?? "");
    const isMatch = await passwordsMatch(submitted, adminPassword);

    if (!isMatch) {
      return new Response(passwordFormHtml(true), {
        status: 401,
        headers: noStoreHeaders({ "content-type": "text/html; charset=utf-8" }),
      });
    }

    const cookieValue = await createSessionCookieValue(adminPassword);
    return new Response(null, {
      status: 302,
      headers: noStoreHeaders({
        "location": "/",
        "set-cookie": sessionCookieHeader(cookieValue, SESSION_TTL_MS / 1000),
      }),
    });
  }

  const sessionCookie = getCookie(request, COOKIE_NAME);
  const authenticated = sessionCookie
    ? await verifySessionCookieValue(sessionCookie, adminPassword)
    : false;

  if (authenticated) {
    const dashboardResponse = await context.next();
    const headers = new Headers(dashboardResponse.headers);
    headers.set("cache-control", "no-store, private");
    return new Response(dashboardResponse.body, {
      status: dashboardResponse.status,
      statusText: dashboardResponse.statusText,
      headers,
    });
  }

  return new Response(passwordFormHtml(false), {
    status: 401,
    headers: noStoreHeaders({ "content-type": "text/html; charset=utf-8" }),
  });
};

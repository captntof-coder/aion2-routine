// AION 2 Routine — Cloudflare Worker, Discord OAuth2 & D1.
// Aucune clé privée ne doit être placée dans le dépôt GitHub.
const SESSION_COOKIE = "aion2_session";
const OAUTH_COOKIE = "aion2_oauth_state";
const SESSION_DURATION = 30 * 24 * 60 * 60;
const CATEGORY = new Set(["daily", "weekly", "plan", "craft", "resource", "level"]);
const PERIOD = /^(global|\d{4}-\d{2}-\d{2})$/;

function cookie(request, name) {
  const parts = (request.headers.get("cookie") || "").split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + "=")) return trimmed.slice(name.length + 1);
  }
  return "";
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function tokenHash(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}
function redirect(to, cookies = []) {
  const headers = new Headers({ location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}
function sessionCookie(token) {
  return SESSION_COOKIE + "=" + token + "; Max-Age=" + SESSION_DURATION + "; Path=/; Secure; HttpOnly; SameSite=Lax";
}
function clearSessionCookie() {
  return SESSION_COOKIE + "=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax";
}
function oauthCookie(token) {
  return OAUTH_COOKIE + "=" + token + "; Max-Age=600; Path=/auth; Secure; HttpOnly; SameSite=Lax";
}
function clearOauthCookie() {
  return OAUTH_COOKIE + "=; Max-Age=0; Path=/auth; Secure; HttpOnly; SameSite=Lax";
}
function originFor(request, env) {
  const origin = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw new Error("PUBLIC_ORIGIN doit être une origine HTTPS");
  return origin.replace(/\/+$/, "");
}
function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
async function loggedUser(request, env) {
  const token = cookie(request, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT user_id, username FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await tokenHash(token), Math.floor(Date.now() / 1000)).first();
  return row ? { id: row.user_id, name: row.username } : null;
}
function validRow(row) {
  if (!row || !CATEGORY.has(row.category) || typeof row.period !== "string" || !PERIOD.test(row.period)) return false;
  if (typeof row.item_id !== "string" || !/^[a-zA-Z0-9_:.-]{1,120}$/.test(row.item_id)) return false;
  const daily = row.category === "daily";
  const global = row.category === "resource" || row.category === "level";
  if (global !== (row.period === "global")) return false;
  if (daily || row.category === "weekly" || row.category === "plan") return typeof row.value === "boolean";
  return typeof row.value === "number" && Number.isSafeInteger(row.value) && row.value >= 0 && row.value <= 999999;
}
async function startLogin(request, env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: "Connexion Discord non configurée" }, 503);
  const state = randomToken();
  const redirectUri = originFor(request, env) + "/auth/callback";
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return redirect(url.toString(), [oauthCookie(state)]);
}
async function callback(request, env) {
  const url = new URL(request.url);
  const state = cookie(request, OAUTH_COOKIE);
  const code = url.searchParams.get("code");
  if (!state || !/^[a-f0-9]{64}$/.test(state) || !code || url.searchParams.get("state") !== state) {
    return redirect("/?auth=error", [clearOauthCookie()]);
  }
  const redirectUri = originFor(request, env) + "/auth/callback";
  const payload = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID || "",
    client_secret: env.DISCORD_CLIENT_SECRET || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });
  const tokens = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload
  });
  if (!tokens.ok) return redirect("/?auth=error", [clearOauthCookie()]);
  const auth = await tokens.json();
  if (!auth.access_token) return redirect("/?auth=error", [clearOauthCookie()]);
  const identity = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { authorization: "Bearer " + auth.access_token }
  });
  if (!identity.ok) return redirect("/?auth=error", [clearOauthCookie()]);
  const profile = await identity.json();
  if (!/^\d{10,25}$/.test(String(profile.id))) return redirect("/?auth=error", [clearOauthCookie()]);
  const name = String(profile.global_name || profile.username || "Joueur Discord").slice(0, 80);
  const session = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, username, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(session), String(profile.id), name, Math.floor(Date.now() / 1000) + SESSION_DURATION).run();
  return redirect("/", [clearOauthCookie(), sessionCookie(session)]);
}
async function readProgress(request, env, user) {
  const params = new URL(request.url).searchParams.getAll("period");
  const periods = [...new Set(params)];
  if (!periods.length || periods.length > 3 || !periods.every(p => PERIOD.test(p))) return json({ error: "Périodes invalides" }, 400);
  const placeholders = periods.map(() => "?").join(", ");
  const sql = "SELECT category, period, item_id, value FROM progress WHERE user_id = ? AND period IN (" + placeholders + ")";
  const { results } = await env.DB.prepare(sql).bind(user.id, ...periods).all();
  return json({ rows: results.map(r => ({ ...r, value: JSON.parse(r.value) })) });
}
async function writeProgress(request, env, user) {
  if (!requireSameOrigin(request)) return json({ error: "Origine invalide" }, 403);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ error: "JSON requis" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 20000) return json({ error: "Requête trop volumineuse" }, 413);
  let body;
  try { body = await request.text(); if (body.length > 20000) return json({ error: "Requête trop volumineuse" }, 413); body = JSON.parse(body); }
  catch { return json({ error: "JSON invalide" }, 400); }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 100 || !body.rows.every(validRow)) {
    return json({ error: "Données invalides" }, 400);
  }
  const statements = body.rows.map(r => env.DB.prepare(
    "INSERT INTO progress (user_id, category, period, item_id, value, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id, category, period, item_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).bind(user.id, r.category, r.period, r.item_id, JSON.stringify(r.value), Date.now()));
  await env.DB.batch(statements);
  return json({ saved: body.rows.length });
}
async function signOut(request, env) {
  if (!requireSameOrigin(request)) return json({ error: "Origine invalide" }, 403);
  const token = cookie(request, SESSION_COOKIE);
  if (/^[a-f0-9]{64}$/.test(token)) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
  }
  return redirect("/", [clearSessionCookie()]);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/health" && request.method === "GET") {
        return json({ ok: true, database: !!env.DB, discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) });
      }
      if (path === "/auth/discord" && request.method === "GET") return startLogin(request, env);
      if (path === "/auth/callback" && request.method === "GET") return callback(request, env);
      if (path === "/api/me" && request.method === "GET") return json({ user: await loggedUser(request, env) });
      if (path === "/api/logout" && request.method === "POST") return signOut(request, env);
      if (path === "/api/progress") {
        const user = await loggedUser(request, env);
        if (!user) return json({ error: "Authentification requise" }, 401);
        if (request.method === "GET") return readProgress(request, env, user);
        if (request.method === "POST") return writeProgress(request, env, user);
        return json({ error: "Méthode interdite" }, 405);
      }
      if (path.startsWith("/api/") || path.startsWith("/auth/")) return json({ error: "Route introuvable" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("AION2 Worker error", e?.message || "internal error");
      return json({ error: "Erreur serveur temporaire" }, 500);
    }
  }
};

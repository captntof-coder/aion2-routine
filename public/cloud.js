// AION 2 Routine — synchronisation navigateur vers Worker + D1.
// La session Discord est un cookie HttpOnly : aucun jeton Discord n'est exposé au JS.
const $ = id => document.getElementById(id);
const app = window.AionRoutine;
const guestStore = "aion2-routine-personal-v1";
const login = $("loginDiscord"), logout = $("logoutDiscord"), sync = $("syncNow"), migrate = $("migrateGuest");
let uid = null, name = "", pending = new Map(), flushing = false, retryTimer = 0, ready = false, syncError = false;

function identity(row) { return [row.category, row.period, row.item_id].join("|"); }
function validRow(row) {
  return row && typeof row.category === "string" &&
    ["daily", "weekly", "plan", "craft", "resource", "level"].includes(row.category) &&
    typeof row.period === "string" && typeof row.item_id === "string" &&
    (typeof row.value === "boolean" || typeof row.value === "number");
}
function setStatus(heading, status, mode = "") {
  $("syncHeading").textContent = heading;
  $("syncStatus").textContent = status;
  $("syncIndicator").className = "account-indicator" + (mode ? " " + mode : "");
}
function controls() {
  login.hidden = !!uid;
  logout.hidden = !uid;
  sync.hidden = !uid;
  migrate.hidden = !uid;
}
function queueKey(id) { return guestStore + ":pending:" + id; }
function saveQueue() {
  if (!uid) return;
  try { localStorage.setItem(queueKey(uid), JSON.stringify([...pending.values()])); }
  catch (_) { /* mode privé : sauvegarde locale non disponible */ }
}
function restoreQueue(id) {
  try {
    const list = JSON.parse(localStorage.getItem(queueKey(id)) || "[]");
    if (Array.isArray(list)) return new Map(list.filter(validRow).map(r => [identity(r), r]));
  } catch (_) {}
  return new Map();
}
function setBusy(enabled) { document.body.classList.toggle("sync-wait", enabled); }
function statusReady() {
  if (!uid) return;
  if (syncError) setStatus(name, "⚠️ Réseau indisponible : les changements restent en attente sur cet appareil.", "problem");
  else if (pending.size) setStatus(name, "☁️ " + pending.size + " changement(s) en attente…");
  else setStatus(name, "✓ Progression synchronisée avec ton compte Discord.", "synced");
}
function scheduleFlush(ms = 500) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(flush, ms);
}
async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw Error(error.error || "Erreur HTTP " + res.status);
  }
  return res.json();
}
async function fetchRows() {
  const search = new URLSearchParams();
  for (const period of app.periods()) search.append("period", period);
  const data = await api("/api/progress?" + search.toString());
  return data.rows || [];
}
async function flush() {
  if (!uid || !ready || flushing || pending.size === 0) return;
  flushing = true;
  const userId = uid, batch = [...pending.values()].slice(0, 75);
  const signatures = new Map(batch.map(row => [identity(row), JSON.stringify(row)]));
  try {
    await api("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: batch })
    });
    if (uid !== userId) return;
    for (const [key, signature] of signatures) {
      const current = pending.get(key);
      if (current && JSON.stringify(current) === signature) pending.delete(key);
    }
    syncError = false;
    saveQueue();
    statusReady();
  } catch (error) {
    if (uid === userId) {
      syncError = true;
      statusReady();
      console.warn("AION 2 : la synchronisation reprendra", error.message);
      scheduleFlush(12000);
    }
  } finally {
    flushing = false;
    if (uid === userId && pending.size && !syncError) scheduleFlush(150);
  }
}
function onChanges(rows) {
  if (!uid || !ready || !Array.isArray(rows)) return;
  for (const row of rows) if (validRow(row)) pending.set(identity(row), row);
  if (rows.length) { saveQueue(); statusReady(); scheduleFlush(); }
}
async function refresh() {
  if (!uid || !ready) return;
  const userId = uid;
  try {
    // Un changement pas encore envoyé ne doit pas être écrasé par l'état du serveur.
    const rows = await fetchRows();
    if (userId !== uid) return;
    const unsent = [...pending.values()];
    app.setAccountState(userId, rows);
    app.applyRemoteRows(unsent);
    syncError = false;
    statusReady();
    if (pending.size) scheduleFlush(100);
  } catch (error) {
    syncError = true;
    statusReady();
    console.warn("AION 2 : lecture cloud impossible", error.message);
  }
}
async function start() {
  controls();
  try {
    const info = await api("/api/me");
    const user = info.user;
    if (!user) {
      setStatus("Mode local", "Progression conservée sur cet appareil. Connecte-toi avec Discord pour la synchroniser.");
      return;
    }
    uid = String(user.id);
    name = user.name || "Joueur Discord";
    pending = restoreQueue(uid);
    controls();
    setBusy(true);
    setStatus(name, "Chargement de ta progression…");
    const rows = await fetchRows();
    app.setAccountState(uid, rows);
    app.applyRemoteRows([...pending.values()]);
    ready = true;
    syncError = false;
    statusReady();
    if (!rows.length && !pending.size) {
      $("syncStatus").textContent = "Compte connecté ! Tu peux importer tes anciennes coches locales.";
    }
    if (pending.size) scheduleFlush(100);
  } catch (error) {
    if (uid) {
      // Le compte est connu, mais pas le serveur : éviter de mélanger les données invité/compte.
      setStatus(name, "⚠️ Progression cloud momentanément inaccessible : recharge la page pour réessayer.", "problem");
    } else {
      setStatus("Mode local", "Connexion cloud indisponible ; sauvegarde locale active.", "problem");
    }
    console.warn("AION 2 : chargement de session impossible", error.message);
  } finally {
    // Si le chargement du compte échoue, ne pas laisser modifier par erreur les données invité.
    setBusy(!!(uid && !ready));
  }
}
login.addEventListener("click", () => { location.assign("/auth/discord"); });
logout.addEventListener("click", async () => {
  if (!uid) return;
  await flush();
  if (pending.size && !confirm("Des changements ne sont pas synchronisés. Ils resteront sur cet appareil. Se déconnecter ?")) return;
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    location.assign("/");
  } catch (error) {
    setStatus(name, "Déconnexion impossible : " + error.message, "problem");
  }
});
sync.addEventListener("click", async () => {
  if (!uid) return;
  if (!ready) { location.reload(); return; }
  await flush();
  await refresh();
});
migrate.addEventListener("click", async () => {
  if (!uid || !ready) return;
  if (!confirm("Remplacer la progression de ton compte Discord par les coches locales de cet appareil ?")) return;
  app.replaceCurrentAccount(app.getGuest());
  await flush();
  statusReady();
});
window.addEventListener("online", () => { if (uid && ready) { scheduleFlush(100); refresh(); } });
window.addEventListener("focus", () => { if (uid && ready) refresh(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && uid && ready) refresh();
});
window.addEventListener("aion2:cycle-changed", () => { if (uid && ready) refresh(); });
setInterval(() => { if (uid && ready && document.visibilityState === "visible") refresh(); }, 30000);
window.AionCloud = { onChanges };
start();

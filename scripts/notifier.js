/* Allez Hop : notifications push, envoyées par GitHub Actions (.github/workflows/notification-matin.yml).

   La tâche tourne aux 15 minutes. Pour chaque téléphone abonné (Firebase, collection « abonnements »),
   elle envoie la notification une fois par jour, dès que l'heure choisie dans l'app est passée.
   Heure avant midi : la journée même. Heure à partir de midi : le lendemain.

   Variables :
     VAPID_PUBLIC              clé publique (aussi dans app.js)
     VAPID_PRIVATE             clé privée (secret GitHub VAPID_PRIVATE_KEY)
     FIREBASE_SERVICE_ACCOUNT  clé de compte de service Firebase (secret GitHub)
     TEST=1                    envoie tout de suite à tous les téléphones, sans tenir compte de l'heure
     DRY=1                     affiche les notifications sans les envoyer */
import webpush from "web-push";
import { pathToFileURL } from "node:url";
import {
  chargerEnfant, ENFANT, LAST, PERIODES, EVENTS, WX_URL, addDays, parse, infoFor, specialsOf,
  summarize, deg, habits, precipShort, wxSub,
} from "../school.js";

const TZ = "America/Toronto";
const env = process.env;

// Date et heure à Montréal
function local(d = new Date()){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute };
}

// Jours où l'on avertit : jours d'école, premier jour d'un congé, ou tout jour avec un rappel ou une activité.
function aAnnoncer(k, nbRappels, nbActivites = 0){
  if (nbRappels || nbActivites) return true;
  const inf = infoFor(k);
  if (inf.kind === "ecole") return true;
  if (inf.kind === "weekend" || k > LAST) return false;
  let prev = addDays(k, -1);
  while ([0, 6].includes(parse(prev).getDay())) prev = addDays(prev, -1);
  return infoFor(prev).kind === "ecole";
}

const meteoCache = {};
async function meteo(k){
  try {
    if (!meteoCache[WX_URL]) {
      const r = await fetch(WX_URL);
      if (!r.ok) throw new Error("HTTP " + r.status);
      meteoCache[WX_URL] = summarize((await r.json()).hourly);
    }
    return meteoCache[WX_URL][k] || null;
  } catch (e) { console.log("Météo indisponible :", e.message); return null; }
}

const heureFr = h => { if (!h) return ""; const [a, b] = h.split(":"); return (+a) + " h" + (b && b !== "00" ? " " + b : ""); };
const objets = t => (t || "").split(/\n|,\s+/).map(x => x.trim()).filter(Boolean);

function message(k, rappels, w, demain, activites = []){
  const inf = infoFor(k), lines = [];
  const quand = demain ? " · demain" : "";
  let title;
  if (inf.kind === "ecole") {
    const sp = specialsOf(inf.jour);
    title = `${ENFANT.prenom} · Jour ${inf.jour}${quand}`;
    lines.push(sp.length ? sp.map(s => `${s.nom} ${PERIODES[s.p]}`).join(" · ") : "Pas de spécialiste");
    sp.filter(s => s.apporter).forEach(s => lines.push(`🎒 ${s.apporter}`));
  } else {
    title = `${ENFANT.prenom} · Pas d'école${quand}`;
    lines.push(inf.label);
  }
  activites.forEach(a => lines.push(`⭐ ${a.titre} ${heureFr(a.debut)}${a.fin ? " à " + heureFr(a.fin) : ""}`));
  (EVENTS[k] || []).forEach(([em, t, n]) => lines.push(`${em} ${t}${n ? ` (${n})` : ""}`));
  rappels.forEach(r => lines.push(`📌 ${r.titre}`));
  [...activites.flatMap(a => objets(a.apporter)), ...rappels.flatMap(r => objets(r.notes))].forEach(x => lines.push(`🎒 ${x}`));
  if (w) {
    lines.push(`${w.icon} ${deg(w.tmin)} → ${deg(w.tmax)} · ${precipShort(w)}`);
    const sub = wxSub(w); if (sub) lines.push(sub);
    lines.push(`👕 ${habits(w)}`);
  }
  return { title, body: lines.join("\n"), tag: "jour-" + k + "-" + ENFANT.prenom, url: "./" };
}

async function main(){
  const test = env.TEST === "1", dry = env.DRY === "1";
  if (!dry && (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE)) { console.log("Clés VAPID pas encore installées : rien n'est envoyé."); return; }
  if (!env.FIREBASE_SERVICE_ACCOUNT) { console.log("Secret FIREBASE_SERVICE_ACCOUNT manquant : rien n'est envoyé."); return; }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();

  const abonnements = (await db.collection("abonnements").get()).docs.filter(d => d.data().actif !== false && d.data().abonnement);
  if (!abonnements.length) { console.log("Aucun téléphone abonné."); return; }

  const now = local(), maintenant = now.h * 60 + now.m;
  const aTraiter = abonnements.filter(d => {
    if (test) return true;
    const x = d.data(), [hh, mm] = (x.heure || "07:00").split(":").map(Number), cible = hh * 60 + mm;
    // L'heure est passée (jusqu'à 3 h de retard toléré) et rien n'a encore été envoyé aujourd'hui.
    return x.dernierEnvoi !== now.date && maintenant >= cible && maintenant - cible <= 180;
  });
  if (!aTraiter.length) { console.log(`${now.date} ${now.h}:${String(now.m).padStart(2, "0")} : aucune notification à envoyer.`); return; }

  const enfants = (await db.collection("enfants").get()).docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.creeLe || 0) - (b.creeLe || 0));
  const rappels = (await db.collection("rappels").get()).docs.map(d => d.data());
  if (!enfants.length) { console.log("Aucune fiche d'enfant dans Firebase."); return; }

  if (!dry) webpush.setVapidDetails("https://noemilag.github.io/allezhop/", env.VAPID_PUBLIC, env.VAPID_PRIVATE);

  for (const d of aTraiter) {
    const x = d.data(), demain = +(x.heure || "07:00").slice(0, 2) >= 12;
    const jour = demain ? addDays(now.date, 1) : now.date;
    const messages = [];
    for (const e of enfants) {
      chargerEnfant(e);
      const siens = rappels.filter(r => r.date === jour && (r.enfant ? r.enfant === e.id : e.id === enfants[0].id))
        .sort((a, b) => (a.titre || "").localeCompare(b.titre || ""));
      const jourSem = parse(jour).getDay();
      const acts = (e.activites || []).filter(a => (a.jours || []).includes(jourSem) && (!a.du || jour >= a.du) && (!a.au || jour <= a.au)).sort((a, b) => (a.debut || "").localeCompare(b.debut || ""));
      if (!test && !aAnnoncer(jour, siens.length, acts.length)) continue;
      messages.push(message(jour, siens, await meteo(jour), demain, acts));
    }
    for (const m of messages) {
      if (test) m.title = "Test · " + m.title;
      console.log(`→ ${x.par || "?"} (${x.appareil || "?"}, ${x.heure || "07:00"})\n${m.title}\n${m.body}\n`);
      if (dry) continue;
      try { await webpush.sendNotification(x.abonnement, JSON.stringify(m), { TTL: 4 * 3600, urgency: "high" }); }
      catch (err) {
        if ([404, 410].includes(err.statusCode)) { console.log("Abonnement expiré : supprimé."); await d.ref.delete(); break; }
        console.log(`Échec (${err.statusCode || "?"}) ${err.body || err.message}`); process.exitCode = 1;
      }
    }
    if (!dry && !test) await d.ref.set({ dernierEnvoi: now.date }, { merge: true });
    if (!messages.length) console.log(`→ ${x.par || "?"} : rien à annoncer pour ${jour}.`);
  }
}

export { message, aAnnoncer };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

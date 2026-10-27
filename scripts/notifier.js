/* Allez Hop : notification push du matin, envoyée par GitHub Actions
   (.github/workflows/notification-matin.yml).

   Variables :
     HEURE               heure d'envoi à Montréal, ex. "07:00"
     CRON                horaire qui a lancé la tâche (github.event.schedule)
     TEST=1              envoie tout de suite, même la fin de semaine
     DRY=1               affiche la notification sans l'envoyer
     VAPID_PUBLIC        clé publique (aussi dans app.js)
     VAPID_PRIVATE       clé privée (secret GitHub VAPID_PRIVATE_KEY)
     FIREBASE_SERVICE_ACCOUNT  clé de compte de service Firebase (secret GitHub), pour lire la fiche de l'enfant
     PUSH_SUBSCRIPTIONS  codes des téléphones (secret GitHub, un code par ligne) */
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
// Instant (UTC) qui correspond à hh:mm à Montréal ce jour-là
function zoned(date, hh, mm){
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const l = local(new Date(guess));
  const offset = Date.UTC(...l.date.split("-").map((v, i) => i === 1 ? v - 1 : +v), l.h, l.m) - guess;
  return guess - offset;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Les jours de congé, on n'avertit que le premier jour (pas chaque jour des vacances).
function shouldNotify(k){
  const inf = infoFor(k);
  if (inf.kind === "ecole") return true;
  if (inf.kind === "weekend" || k > LAST) return false;
  let prev = addDays(k, -1);
  while ([0, 6].includes(parse(prev).getDay())) prev = addDays(prev, -1);
  return infoFor(prev).kind === "ecole";
}

// La fiche de l'enfant (prénom, calendrier, horaire) est dans Firebase, pas dans le code.
async function chargerDepuisFirebase(){
  if (!env.FIREBASE_SERVICE_ACCOUNT) return false;
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const snap = await getFirestore().collection("enfants").limit(1).get();
  if (snap.empty) return false;
  chargerEnfant(snap.docs[0].data());
  return true;
}

async function weather(k){
  try {
    const r = await fetch(WX_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return summarize((await r.json()).hourly)[k] || null;
  } catch (e) { console.log("Météo indisponible :", e.message); return null; }
}

function message(k, w){
  const inf = infoFor(k), lines = [];
  let title;
  if (inf.kind === "ecole") {
    const sp = specialsOf(inf.jour);
    title = `${ENFANT.prenom} · Jour ${inf.jour}`;
    lines.push(sp.length ? sp.map(s => `${s.nom} ${PERIODES[s.p]}`).join(" · ") : "Pas de spécialiste aujourd'hui");
    sp.filter(s => s.apporter).forEach(s => lines.push(`🎒 ${s.apporter}`));
  } else {
    title = `${ENFANT.prenom} · Pas d'école`;
    lines.push(inf.label);
  }
  (EVENTS[k] || []).forEach(([em, t, n]) => lines.push(`${em} ${t}${n ? ` (${n})` : ""}`));
  if (w) {
    lines.push(`${w.icon} ${deg(w.tmin)} → ${deg(w.tmax)} · ${precipShort(w)}`);
    const sub = wxSub(w); if (sub) lines.push(sub);
    lines.push(`👕 ${habits(w)}`);
  }
  return { title, body: lines.join("\n"), tag: "matin-" + k, url: "./" };
}

function subscriptions(){
  const raw = (env.PUSH_SUBSCRIPTIONS || "").trim();
  if (!raw) return [];
  try { const j = JSON.parse(raw); return Array.isArray(j) ? j : [j]; }
  catch (_) { return raw.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l)); }
}

async function main(){
  const test = env.TEST === "1", dry = env.DRY === "1";
  if (!dry && (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE)) { console.log("Clés VAPID pas encore installées (voir README) : rien n'est envoyé."); return; }
  if (!(await chargerDepuisFirebase())) { console.log("Fiche de l'enfant introuvable (secret FIREBASE_SERVICE_ACCOUNT manquant ou collection enfants vide) : rien n'est envoyé."); return; }
  const [hh, mm] = (env.HEURE || "07:00").split(":").map(Number);
  const now = local(), k = now.date;
  const target = zoned(k, hh, mm);

  if (!test) {
    // Deux horaires (heure d'été et heure normale) : seul celui qui tombe juste avant l'heure d'envoi continue.
    if (env.CRON) {
      const [cm, ch] = env.CRON.trim().split(/\s+/).map(Number);
      const d = new Date();
      const planned = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), ch, cm);
      if (planned > target || target - planned > 75 * 60e3) { console.log("Pas le bon horaire pour la saison : rien à faire."); return; }
    }
    if (!shouldNotify(k)) { console.log(`${k} : pas de notification (${infoFor(k).kind}).`); return; }
    const wait = target - Date.now();
    if (wait > 0) { console.log(`Attente de ${Math.round(wait / 60e3)} min jusqu'à ${env.HEURE || "07:00"}.`); await sleep(wait); }
  }

  const payload = message(k, await weather(k));
  if (test) payload.title = "Test · " + payload.title;
  console.log(payload.title + "\n" + payload.body);
  if (dry) return;

  const subs = subscriptions();
  if (!subs.length) { console.log("Aucun téléphone abonné (secret PUSH_SUBSCRIPTIONS vide)."); return; }
  webpush.setVapidDetails("https://noemilag.github.io/allezhop/", env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  let ok = 0;
  for (const [i, s] of subs.entries()) {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 4 * 3600, urgency: "high" }); ok++; }
    catch (e) {
      const why = [404, 410].includes(e.statusCode) ? "abonnement expiré : réactive les notifications dans l'app et remplace son code" : (e.body || e.message);
      console.log(`Téléphone ${i + 1} : échec (${e.statusCode || "?"}) ${why}`);
    }
  }
  console.log(`Envoyée à ${ok} téléphone(s) sur ${subs.length}.`);
  if (!ok) process.exitCode = 1;
}
export { message, shouldNotify, zoned };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

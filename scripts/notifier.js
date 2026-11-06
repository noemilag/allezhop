/* Allez Hop : notifications push, envoyées par GitHub Actions (.github/workflows/notification-matin.yml).

   La tâche tourne aux 15 minutes. Pour chaque téléphone abonné (Firebase), elle envoie la notification
   une fois par jour, dès que l'heure choisie dans l'app est passée.
   Elle sert chaque famille de la bêta (familles/{id}/abonnements, enfants, rappels) et, jusqu'à la migration,
   la famille d'origine (collections « abonnements », « enfants », « rappels » à la racine).
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
  chargerEnfant, ENFANT, LAST, EVENTS, addDays, parse, infoFor, specialsOf,
} from "../school.js";   // version complète (cycles A/B, pédagogiques d'école, matières libres) ; compatible avec l'ancienne fiche

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


const heureFr = h => { if (!h) return ""; const [a, b] = h.split(":"); return (+a) + " h" + (b && b !== "00" ? " " + b : ""); };
const objets = t => (t || "").split(/\n|,\s+/).map(x => x.trim()).filter(Boolean);

// Notification courte : « Prénom – Jour 4 », les spécialistes, puis les rappels (et activités) s'il y en a.
function message(k, rappels, w, demain, activites = []){
  const inf = infoFor(k), lines = [];
  const quand = demain ? " (demain)" : "";
  let title;
  if (inf.kind === "ecole") {
    const sp = specialsOf(inf.jour);
    title = `${ENFANT.prenom} – Jour ${inf.jour}${quand}`;
    lines.push(sp.length ? sp.map(s => s.nom).join(" – ") : "Pas de spécialiste");
  } else {
    title = `${ENFANT.prenom} – Congé${quand}`;
    if (inf.kind === "off" && inf.label) lines.push(inf.label);
  }
  const autres = [
    ...(EVENTS[k] || []).map(([, t]) => t),
    ...rappels.map(r => r.titre),
    ...activites.map(a => `${a.titre} ${heureFr(a.debut)}`),
  ];
  if (autres.length) lines.push(autres.join(" – "));
  return { title, body: lines.join("\n"), tag: "jour-" + k + "-" + ENFANT.prenom, url: "./" };
}

// Toutes les familles : celles de la bêta d'abord, puis la famille d'origine (anciennes collections à la racine).
async function lireFamilles(db){
  const lire = async (ref) => {
    const [ab, en, ra] = await Promise.all(["abonnements", "enfants", "rappels"].map(c => ref.collection(c).get()));
    return {
      abonnements: ab.docs,
      enfants: en.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.creeLe || 0) - (b.creeLe || 0)),
      rappels: ra.docs.map(d => d.data()),
    };
  };
  const out = [];
  for (const f of (await db.collection("familles").get()).docs) out.push({ id: f.id, ...(await lire(f.ref)) });
  const origine = await lire(db);
  if (origine.enfants.length || origine.abonnements.length) out.push({ id: "origine", ...origine });
  // Un même téléphone (même adresse d'abonnement) n'est servi qu'une fois : la bêta gagne sur l'ancienne base.
  // Les familles qui ont au moins un enfant passent d'abord : un téléphone abonné aussi dans une ancienne famille vide
  // (essai) est servi par la famille qui a vraiment une fiche. L'ancienne base reste en dernier.
  out.sort((x, y) => (x.id === "origine") - (y.id === "origine") || (y.enfants.length > 0) - (x.enfants.length > 0));
  const vus = new Set();
  for (const f of out) f.abonnements = f.abonnements.filter(d => {
    const ep = d.data().abonnement && d.data().abonnement.endpoint; if (!ep || vus.has(ep)) return false; vus.add(ep); return true; });
  return out;
}

async function main(){
  const test = env.TEST === "1", dry = env.DRY === "1";
  // En test, rien d'envoyé = échec visible (en rouge dans GitHub), avec la raison.
  const stop = msg => { console.log(msg); if (test) { console.log("::error::" + msg); process.exitCode = 1; } };
  if (!dry && (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE)) { stop("Clé VAPID manquante : vérifiez le secret VAPID_PRIVATE_KEY dans GitHub."); return; }
  if (!env.FIREBASE_SERVICE_ACCOUNT) { stop("Secret FIREBASE_SERVICE_ACCOUNT manquant dans GitHub."); return; }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  let compte;
  try { compte = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
  catch { stop("Le secret FIREBASE_SERVICE_ACCOUNT n'est pas un fichier JSON complet : recollez tout le contenu du fichier."); return; }
  initializeApp({ credential: cert(compte) });
  const db = getFirestore();

  const now = local(), maintenant = now.h * 60 + now.m;
  const familles = await lireFamilles(db);
  // en pause : rien
  familles.forEach(f => { f.abonnements = f.abonnements.filter(d => d.data().actif !== false && (test || d.data().pauseLe !== now.date)); });
  if (!familles.some(f => f.abonnements.length)) { stop("Aucun téléphone abonné : dans l'app (ouverte par son icône), Menu → Notifications → Activer."); return; }

  if (!dry) webpush.setVapidDetails("https://noemilag.github.io/allezhop/", env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  const hote = x => { try { return new URL(x.abonnement.endpoint).host; } catch { return "?"; } };
  // Envoie un message à un téléphone ; false si l'abonnement a expiré (il est alors supprimé).
  async function envoyer(d, m){
    const x = d.data();
    // Les journaux de GitHub sont publics : ni courriel, ni prénom, ni contenu du message (sauf en essai local, DRY=1).
    if (dry) console.log(`→ ${x.par || "?"} (${x.appareil || "?"})\n${m.title}\n${m.body}\n`); else console.log(`→ message pour ${x.appareil || "un appareil"}`);
    if (dry) return true;
    try {
      const r = await webpush.sendNotification(x.abonnement, JSON.stringify(m), { TTL: 4 * 3600, urgency: "high" });
      console.log(`::notice::Envoyé à ${x.appareil || "?"} (${hote(x)}) : réponse ${r.statusCode}`);
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) { console.log("Abonnement expiré : supprimé."); await d.ref.delete(); return false; }
      console.log(`::error::Échec de l'envoi (${err.statusCode || "?"}) ${err.body || err.message}`); process.exitCode = 1;
    }
    return true;
  }
  const activitesLe = (e, jour) => { const w = parse(jour).getDay();
    return (e.activites || []).filter(a => (a.jours || []).includes(w) && (!a.du || jour >= a.du) && (!a.au || jour <= a.au)).sort((a, b) => (a.debut || "").localeCompare(b.debut || "")); };

  let envoyesQuelquechose = false;

  // Bugs signalés depuis l'app (bouton « Signaler un bug ») : un message à la propriétaire, une seule fois par signalement.
  // Ses téléphones : ceux du compte ADMIN_EMAIL (secret GitHub facultatif), sinon ceux de la famille d'origine ou de la plus ancienne.
  try {
    const nouveaux = (await db.collection("signalements").get()).docs.filter(d => d.data().notifie !== true).slice(0, 5);
    if (nouveaux.length) {
      const admins = (env.ADMIN_EMAIL || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);   // une ou plusieurs adresses, séparées par une virgule
      const admin = admins.length > 0;
      const tous = familles.flatMap(f => f.abonnements);
      let appareils = admin ? tous.filter(d => admins.includes(String(d.data().par || "").toLowerCase()))
                            : (familles.find(f => f.id === "origine" && f.abonnements.length) || familles.find(f => f.abonnements.length) || { abonnements: [] }).abonnements;
      console.log(`Alertes de bugs : ${nouveaux.length} à envoyer ; ADMIN_EMAIL ${admins.length ? "défini (" + admins.length + " adresse(s))" : "absent ou vide"} ; ${appareils.length} appareil(s) retenu(s) sur ${tous.length} abonné(s).`);
      if (!appareils.length) console.log(`${nouveaux.length} bug(s) signalé(s), mais aucun téléphone à prévenir : ${admins.length ? "ADMIN_EMAIL est défini, mais aucun des " + tous.length + " téléphone(s) abonné(s) ne correspond" : "ADMIN_EMAIL n'est pas défini et aucun téléphone n'est abonné"}.`);
      else for (const doc of nouveaux) {
        const b = doc.data();
        const m = { title: "🐞 Bug signalé", body: [b.etape, b.code, String(b.detail || "").replace(/\s+/g, " ").slice(0, 110)].filter(Boolean).join(" · ") || "Ouvrez la console Firebase", tag: "bug-" + doc.id, url: "./" };
        let ok = false;
        for (const d of appareils) if (await envoyer(d, m)) ok = true;
        if (ok && !dry) await doc.ref.set({ notifie: true }, { merge: true });
        if (ok) envoyesQuelquechose = true;
      }
    }
  } catch (err) { console.log("Signalements : " + (err.message || err)); }

  for (const f of familles) {
    const { abonnements, enfants, rappels } = f;
    if (!abonnements.length) continue;
    if (!enfants.length) { console.log("Une famille n'a aucune fiche d'enfant."); continue; }
    const aTraiter = abonnements.filter(d => {
      if (test) return true;
      const x = d.data(), [hh, mm] = (x.heure || "07:00").split(":").map(Number), cible = hh * 60 + mm;
      // L'heure est passée (jusqu'à 3 h de retard toléré) et rien n'a encore été envoyé aujourd'hui.
      return x.dernierEnvoi !== now.date && maintenant >= cible && maintenant - cible <= 180;
    });
    // Alertes avant les activités choisies dans l'app (ex. « Karaté à 18 h 30 », 1 h avant)
    const avecAlertes = test ? [] : abonnements.filter(d => (d.data().alertes || []).length);

    for (const d of avecAlertes) {
      const x = d.data(), avance = x.avance ?? 60, faits = (x.alertesEnvoyees || []).filter(c => c.endsWith("@" + now.date)), nouveaux = [];
      for (const e of enfants) {
        chargerEnfant(e);
        for (const a of activitesLe(e, now.date)) {
          if (!(x.alertes || []).includes(a.id) || !a.debut) continue;
          const [hh, mm] = a.debut.split(":").map(Number), debut = hh * 60 + mm, cle = a.id + "@" + now.date;
          if (maintenant < debut - avance || maintenant >= debut || faits.includes(cle)) continue;
          const sac = objets(a.apporter);
          const ok = await envoyer(d, { title: `${ENFANT.prenom} – ${a.titre} à ${heureFr(a.debut)}`, body: sac.length ? sac.join(" – ") : "Dans " + (debut - maintenant) + " min", tag: "act-" + cle, url: "./" });
          if (!ok) break;
          nouveaux.push(cle); envoyesQuelquechose = true;
        }
      }
      if (nouveaux.length && !dry) await d.ref.set({ alertesEnvoyees: [...faits, ...nouveaux] }, { merge: true });
    }

    for (const d of aTraiter) {
      const x = d.data(), demain = +(x.heure || "07:00").slice(0, 2) >= 12;
      const jour = demain ? addDays(now.date, 1) : now.date;
      const messages = [];
      for (const e of enfants) {
        chargerEnfant(e);
        const siens = rappels.filter(r => r.date === jour && (r.enfant ? r.enfant === e.id : e.id === enfants[0].id))
          .sort((a, b) => (a.titre || "").localeCompare(b.titre || ""));
        const acts = activitesLe(e, jour);
        if (!test && !aAnnoncer(jour, siens.length, acts.length)) continue;
        // Option dans l'app : pas de notification les jours sans école
        if (!test && x.conges === false && infoFor(jour).kind !== "ecole") continue;
        messages.push(message(jour, siens, null, demain, acts));
      }
      let vivant = true;
      for (const m of messages) {
        if (test) m.title = "Test · " + m.title;
        if (!(vivant = await envoyer(d, m))) break;
        envoyesQuelquechose = true;
      }
      if (!vivant) continue;
      if (!dry && !test) await d.ref.set({ dernierEnvoi: now.date }, { merge: true });
      if (!messages.length) console.log(`→ ${x.appareil || "un appareil"} : rien à annoncer pour ${jour}.`);
    }
  }
  if (!envoyesQuelquechose) console.log(`${now.date} ${now.h}:${String(now.m).padStart(2, "0")} : aucune notification à envoyer.`);
}

export { message, aAnnoncer };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err => { console.log("::error::" + (err.message || err)); process.exitCode = 1; });

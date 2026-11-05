/* Allez Hop, essai B : assistant d'accueil d'une famille.
   Étapes : l'enfant → photo de l'horaire → photo du calendrier scolaire → vérification → enregistrement.
   L'IA (Gemini, par Firebase AI Logic) lit les photos ; tout se vérifie et se corrige avant d'enregistrer. */
import { SUBJ, cleMatiere, matiere } from "./school.js?v=202611052239";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const parse = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const key = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
const longDate = k => { const d = parse(k); return JOURS[d.getDay()] + " " + (d.getDate() === 1 ? "1er" : d.getDate()) + " " + MOIS[d.getMonth()]; };
const heureFr = h => { if (!h) return ""; const [a, b] = h.split(":"); return (+a) + " h" + (b && b !== "00" ? " " + b : ""); };

/* ---------- Photos : réduites avant l'envoi (plus rapide, et suffisant pour lire) ---------- */
async function photoEnBase64(fichier, max = 2000){
  if (fichier.type === "application/pdf"){
    const b = new Uint8Array(await fichier.arrayBuffer()); let t = "";
    for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return { data: btoa(t), mimeType: "application/pdf", apercu: null };
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", .85).split(",")[1], mimeType: "image/jpeg", apercu: c.toDataURL("image/jpeg", .5) };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Ce qu'on demande à l'IA ---------- */
const CONSIGNE_PRIVEE = "Ne recopie jamais d'informations personnelles (nom d'élève, courriel, mot de passe, numéro d'élève, code) : elles ne servent pas.";
const PROMPT_HORAIRE = `Tu lis la photo d'un horaire de classe d'une école primaire du Québec, organisé en cycle de jours (Jour 1, Jour 2, … ou 1A à 5B pour des semaines A et B).
Repère les colonnes (jours du cycle, dans l'ordre) et les lignes (périodes avec leurs heures).
Donne le nom court de chaque colonne : « Jour 3 » → "3", « Jour 2B » ou « Mardi B » en semaine B → "2B".
Les cases « Accueil », « Récréation », « Dîner », « Autobus » ne sont pas des périodes de cours : ignore-les et ne les compte pas.
Numérote les périodes de cours de 1 à N, dans l'ordre de la journée, et donne l'heure de début de chacune au format HH:MM.
Pour chaque jour du cycle, donne seulement les cours avec un spécialiste (les cases écrites, souvent à la main et en abrégé).
Écris le nom complet de la matière en français : Angl. → Anglais, Éduc. → Éducation physique, Mus. → Musique,
biblio → Bibliothèque, Ordis → Ordinateurs, CCQ → Culture et citoyenneté, Arts → Arts plastiques. Sinon, garde le nom lu.
${CONSIGNE_PRIVEE}
Réponds seulement en JSON :
{"jours": ["1","2",…], "periodes": {"1":"HH:MM", …}, "cycle": {"<nom court du jour>": {"<numéro de période>": "<matière>"}, …}, "doutes": ["<ce qui était difficile à lire>"]}`;

// Le calendrier est lu en DEUX demandes en parallèle (chacune la moitié des mois) : deux fois moins long à écrire pour l'IA.
const MOITIES = [
  "juillet, août, septembre, octobre, novembre et décembre (première année : 2026 par exemple)",
  "janvier, février, mars, avril, mai et juin (deuxième année : 2027 par exemple)",
];
function promptCalendrier(moitie){
  return `Tu lis un calendrier scolaire d'une école primaire du Québec (une année scolaire, d'août à juin), en photo ou en PDF.
IMPORTANT : cette demande ne porte QUE sur les mois de ${MOITIES[moitie]}. Ignore complètement les autres mois (pour les jours, les totaux, les noms de congés et les événements).
Travaille MOIS PAR MOIS, ligne par ligne, avec soin : chaque case est une date.
Réponds de façon COMPACTE : un objet par mois, avec pour clé le numéro du jour dans le mois (seulement lundi à vendredi), par exemple
"2026-09": {"1":"2","2":"3","3":"4","4":"5","7":"C", …}.
Pour CHAQUE jour de semaine (lundi à vendredi) d'août à juin, donne son état en une courte valeur :
- le numéro du jour du cycle s'il est écrit près de la date (petit chiffre en exposant ou sous la date, parfois avec une lettre A ou B), ex. "3" ou "2B" ;
- "P" si c'est une journée pédagogique (souvent la date est entourée d'un cercle ou d'une forme, selon la légende) ;
- "E" si c'est une journée pédagogique propre à l'école, quand la légende la distingue des autres pédagogiques (par exemple « pédagogique école » avec un soleil, une étoile ou une autre petite image) ;
- "C" si c'est un congé (férié, vacances, relâche ; souvent une case colorée, selon la légende) ;
- "R" si c'est une journée de reprise ou de réserve prévue en cas de force majeure (tempête, fermeture de l'école) : normalement c'est un congé, sans numéro de cycle ;
- "-" s'il n'y a pas de classe parce que l'année n'est pas commencée ou est finie.
Lis bien la LÉGENDE pour savoir quel symbole veut dire quoi. Une date qui porte un numéro de cycle est un jour de classe.
Donne aussi le nom des congés connus (ex. « Action de grâce », « Congé des Fêtes », « Relâche »).
Les événements sont presque toujours sur un jour de classe. Pour les événements, commence par lire attentivement la LÉGENDE : note chaque petite image ou symbole et ce qu'il signifie
(ex. un appareil photo ou un casque jaune = photographie scolaire ; une coche ou un crayon = première communication ; un personnage avec des feuilles = bulletin ; [ et ] = début et fin d'étape ; une cloche = entrée des élèves).
Mets ce que tu lis dans "legende". Ensuite relève TOUS les événements : chaque case qui porte l'un de ces symboles, avec le nom donné par la légende
pour CE symbole. Un même symbole revient souvent plusieurs fois dans l'année (le bulletin, par exemple, 2 ou 3 fois ; la première communication une fois ;
la photo scolaire une fois). Ne nomme pas un événement d'après un autre symbole.
Donne pour chacun sa date, un titre court en français (ex. « Photo scolaire », « Première communication », « Bulletin », « Fin de la 1re étape ») et le JOUR DE LA SEMAINE
de la colonne où se trouve le symbole (lundi, mardi, mercredi, jeudi ou vendredi) : regarde l'en-tête de la colonne (L, M, M, J, V), cela permet de vérifier la date.
Ne les confonds pas avec les congés ni les journées pédagogiques (qui sont déjà dans « jours »).
Si le calendrier IMPRIME le nombre de jours de classe de chaque mois (par exemple « 20 jours », « 20 jours / 1 péd. » ou « (20) » dans ou sous le tableau du mois), donne-le dans "joursParMois" ;
sinon laisse "joursParMois" vide. Ne le calcule pas toi-même : recopie seulement ce qui est imprimé. Ce total sert à vérifier ta lecture, surtout le premier et le dernier mois.
Toutes les dates au format AAAA-MM-JJ ; août à décembre sont de la première année, janvier à juin de la deuxième.
${CONSIGNE_PRIVEE}
Réponds seulement en JSON :
{"ecole": "nom de l'école ou vide", "jours": {"2026-08": {"24":"-","25":"P", …}, "2026-09": {…}, …}, "joursParMois": {"2026-08": 1, "2026-09": 20, …}, "noms": [{"date":"AAAA-MM-JJ","nom":"…"}],
 "legende": [{"symbole":"description courte du symbole","evenement":"…"}],
 "evenements": [{"date":"AAAA-MM-JJ","titre":"…","jour":"mercredi"}], "doutes": ["…"]}`;
}

// Fusionne les deux moitiés du calendrier lues séparément
function fusionnerCalendrier(rs){
  const out = { ecole: "", jours: {}, joursParMois: {}, noms: [], legende: [], evenements: [], doutes: [] };
  for (const r of rs){
    if (!r) continue;
    out.ecole = out.ecole || r.ecole || "";
    Object.assign(out.jours, r.jours || {}); Object.assign(out.joursParMois, r.joursParMois || {});
    out.noms.push(...(r.noms || [])); out.legende.push(...(r.legende || [])); out.doutes.push(...(r.doutes || []));
    out.evenements.push(...(r.evenements || []));
  }
  const vus = new Set(); out.evenements = out.evenements.filter(x => { const c = x.date + "|" + x.titre; if (vus.has(c)) return false; vus.add(c); return true; });
  return out;
}

/* ---------- Le cycle, calculé comme dans l'app : il avance seulement les jours de classe ---------- */
// Noms des jours du cycle dans l'ordre : "1".."N", ou "1A".."5A","1B".."5B" pour des semaines A et B
const ordreDe = e => e.ordre && e.ordre.length ? e.ordre : Array.from({ length: +e.joursCycle || 6 }, (_, i) => String(i + 1));
const ordreAB = () => [..."ABCD".slice(0, 2)].flatMap(l => [1, 2, 3, 4, 5].map(i => i + l));
function cycleDe(e){
  const off = new Set(Object.keys(e.off || {}));
  const o = ordreDe(e), out = {};
  for (let k = e.annee.debut, i = e.debutIdx || 0; k <= e.annee.fin; k = addDays(k, 1)){
    const w = parse(k).getDay();
    if (w > 0 && w < 6){
      if (!off.has(k)){ out[k] = o[i % o.length]; i++; }
      else if (e.off[k].compte) i++;   // pédagogique d'école : le cycle avance quand même
    }
  }
  return out;
}

// Regroupe les jours sans classe consécutifs (fins de semaine comprises) en congés « du … au … »
function congesDe(e){
  const out = [];
  Object.keys(e.off || {}).sort().forEach(d => {
    const o = e.off[d], der = out[out.length - 1];
    let k = der ? addDays(der.au, 1) : null; while (k && k < d && [0, 6].includes(parse(k).getDay())) k = addDays(k, 1);
    if (der && k === d && der.type === o.type && der.label === o.label && !!der.compte === !!o.compte) der.au = d;
    else out.push({ du: d, au: d, type: o.type, label: o.label, ...(o.compte ? { compte: true } : {}) });
  });
  return out;
}
// Les numéros du cycle écrits sur le calendrier permettent de corriger les erreurs de lecture des congés :
// on essaie d'enlever un congé (ou d'en ajouter un là où aucun numéro n'est écrit) et on garde ce qui fait mieux concorder.
function accordDe(e, lus){
  const c = cycleDe(e); let n = 0, t = 0;
  for (const [d, v] of Object.entries(lus)) if (d >= e.annee.debut && d <= e.annee.fin){ t++; if (c[d] === v) n++; }
  return t ? n / t : 1;
}
// On compare les numéros écrits sur le calendrier DEUX PAR DEUX (d'un jour numéroté au suivant) :
// si l'écart ne correspond pas au nombre de jours de classe entre les deux, l'erreur est dans ces quelques jours.
// Chaque intervalle est réglé séparément : une erreur à un endroit ne dérange pas le reste de l'année.
// Retourne les jours changés (avec .notes) ; les jours où classe et « pédagogique d'école » sont possibles sont dans .aConfirmer.
function autoCorriger(e, lus){
  const changes = []; changes.notes = {}; changes.aConfirmer = [];
  const o = ordreDe(e), n = o.length, idx = v => o.indexOf(v);
  const dans = d => d >= e.annee.debut && d <= e.annee.fin;
  const semaine = d => { const w = parse(d).getDay(); return w > 0 && w < 6; };
  const num = Object.keys(lus).filter(d => dans(d) && semaine(d) && idx(lus[d]) >= 0).sort();
  if (!e.annee.debut || num.length < 20) return changes;
  const entre = (p, q) => { const out = []; for (let k = addDays(p, 1); k < q; k = addDays(k, 1)) if (semaine(k)) out.push(k); return out; };
  const etat = d => e.off[d] ? (e.off[d].compte ? "compte" : "ferme") : "classe";
  const modn = x => ((x % n) + n) % n;
  const ecart = i => {
    const p = num[i - 1], q = num[i], attendu = 1 + entre(p, q).filter(d => etat(d) !== "ferme").length;
    let d = modn(modn(idx(lus[q]) - idx(lus[p])) - modn(attendu)); if (d > n / 2) d -= n; return d;
  };
  const deltas = num.map((_, i) => i ? ecart(i) : 0);
  for (let i = 1; i < num.length; i++){
    const delta = deltas[i]; if (!delta) continue;
    // un chiffre mal lu fait deux écarts opposés de suite : on n'y touche pas
    if (deltas[i + 1] === -delta || deltas[i - 1] === -delta) continue;
    const b = entre(num[i - 1], num[i]);
    if (delta > 0){
      // il manque des jours qui comptent : des jours fermés lus à tort, ou des pédagogiques d'école. Les « E » d'abord, puis dans l'ordre.
      const fermes = b.filter(d => etat(d) === "ferme").sort((x, y) => (e.off[y].ecole ? 1 : 0) - (e.off[x].ecole ? 1 : 0));
      if (fermes.length < delta) continue;
      fermes.slice(0, delta).forEach(d => {
        // « E » (pédagogique d'école reconnue par l'IA) : fermé, le cycle avance. Sinon : jour de classe.
        // Dans les deux cas le numéro du cycle est juste ; l'utilisateur confirme s'il y a classe ou non.
        if (e.off[d].ecole) e.off[d] = { ...e.off[d], type: "ped", compte: true };
        else delete e.off[d];
        changes.push(d); changes.aConfirmer.push(d);
        changes.notes[d] = "le cycle avance ce jour-là";
      });
    } else {
      const comptes = b.filter(d => etat(d) !== "ferme");
      if (comptes.length < -delta) continue;
      comptes.slice(0, -delta).forEach(d => { e.off[d] = { type: "ped", label: "Journée pédagogique" }; changes.push(d); changes.notes[d] = "pas de classe ce jour-là"; });
    }
  }
  return changes;
}
const ICONES_EVT = { photo: "photo", bulletin: "bulletin", communication: "communication", etape: "flag", entree: "bell" };
function iconeEvenement(t){ const n = (t || "").toLowerCase();
  if (n.includes("photo")) return ICONES_EVT.photo; if (n.includes("bulletin")) return ICONES_EVT.bulletin;
  if (n.includes("communication")) return ICONES_EVT.communication; if (n.includes("étape") || n.includes("etape")) return ICONES_EVT.etape;
  if (n.includes("entrée") || n.includes("rentrée")) return ICONES_EVT.entree; return "pin"; }

/* ---------- L'assistant ---------- */
export function demarrerAssistant({ icone, lireIA, enregistrer, toast, annuler, enfant, signaler }){
  const ico = n => icone ? icone(n) : "";
  const box = document.createElement("section");
  box.className = "assistant"; box.id = "assistant";
  document.body.appendChild(box);
  const e = { prenom: "", classe: "", ecole: "", ville: "", joursCycle: 6, periodes: {}, cycle: {}, annee: { debut: "", fin: "" }, conges: [], evenements: [] };
  // Mise à jour d'un enfant déjà enregistré (nouvelle année scolaire) : on repart de ses informations
  const maj = !!enfant;
  if (maj){ e.prenom = enfant.prenom || ""; e.classe = enfant.classe || ""; e.ecole = enfant.ecole || ""; e.ville = enfant.ville || ""; }
  const hhmm = t => { const m = /(\d{1,2})\s*h\s*(\d{2})?/.exec(t || ""); return m ? m[1].padStart(2, "0") + ":" + (m[2] || "00") : ""; };
  let doutes = [], lus = {}, lusBrut = {}, utiliserLus = null, corriges = [], etape = "enfant";
  // lus = numéros lus, décalés pour que le premier jour numéroté de l'année ait le numéro choisi (e.debutIdx)
  const appliquerDebut = () => {
    const o = ordreDe(e), prem = Object.keys(lusBrut).filter(d => d >= e.annee.debut && d <= e.annee.fin).sort()[0];
    lus = {}; if (!prem || o.indexOf(lusBrut[prem]) < 0) { lus = { ...lusBrut }; return; }
    const dec = o.indexOf(lusBrut[prem]);
    Object.entries(lusBrut).forEach(([d, v]) => { const i = o.indexOf(v); lus[d] = i < 0 ? v : o[(((i - dec + (e.debutIdx || 0)) % o.length) + o.length) % o.length]; });
  };

  const fermer = () => box.remove();
  const page = (titre, sousTitre, corps, boutons) => {
    box.innerHTML = `<div class="as-in"><div class="as-haut">${annuler ? `<button type="button" class="x-fermer as-x" aria-label="Fermer">${xIcon}</button>` : ""}
      <p class="as-etape">${esc(sousTitre)}</p><h2>${esc(titre)}</h2></div><div class="as-corps">${corps}</div><div class="as-bas">${boutons}</div></div>`;
    const x = box.querySelector(".as-x"); if (x) x.onclick = () => { fermer(); annuler(); };
    box.scrollTop = 0;
  };
  const xIcon = `<svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

  /* 1. L'enfant */
  function pageEnfant(){
    etape = "enfant";
    page(maj ? `Nouvelle année pour ${e.prenom}` : "Votre enfant", "Étape 1 de 4", `
      ${maj ? `<p>Vérifiez les informations. Les <b>rappels</b> et les <b>activités</b> de ${esc(e.prenom)} sont gardés.</p>` : ""}
      <div class="field"><label for="as-prenom">Prénom</label><input type="text" id="as-prenom" maxlength="40" autocomplete="off" value="${esc(e.prenom)}"></div>
      <div class="field"><label for="as-ecole">École</label><input type="text" id="as-ecole" maxlength="80" value="${esc(e.ecole)}"></div>
      <div class="field"><label for="as-ville">Ville (pour la météo)</label><input type="text" id="as-ville" maxlength="60" placeholder="Ex. : Sherbrooke" value="${esc(e.ville)}"></div>
      <p class="err" id="as-err" hidden></p>`,
      `<button type="button" class="btn primary" id="as-suivant">Continuer</button>`);
    $("as-suivant").onclick = async () => {
      e.prenom = $("as-prenom").value.trim(); e.ecole = $("as-ecole").value.trim(); e.ville = $("as-ville").value.trim();
      const err = $("as-err");
      if (!e.prenom){ err.textContent = "Écrivez le prénom de l'enfant."; err.hidden = false; return; }
      if (!e.ville){ err.textContent = "Écrivez la ville, pour la météo."; err.hidden = false; return; }
      // On vérifie la ville tout de suite : une ville qui n'existe pas donnerait la météo d'un endroit au hasard.
      const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const memeVille = maj && enfant && enfant.lat != null && norm(enfant.ville) === norm(e.ville);
      if (memeVille || (e.lieu && norm(e.lieu.name) === norm(e.ville))){ pageHoraire(); return; }
      const b = $("as-suivant"); b.disabled = true; b.textContent = "Vérification de la ville…";
      let res = null;
      try { res = (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e.ville)}&count=5&language=fr&countryCode=CA`).then(r => r.json())).results || []; } catch (x){ res = null; }
      b.disabled = false; b.textContent = "Continuer";
      if (res === null){ pageHoraire(); return; }   // pas de réseau : la ville sera vérifiée à l'enregistrement
      const exact = res.find(r => norm(r.name) === norm(e.ville));
      if (exact){ e.lieu = exact; pageHoraire(); return; }
      // Aucune réponse (faute de frappe, ex. « Monréal ») : on cherche les villes qui commencent pareil et on garde les plus ressemblantes
      if (!res.length){
        const base = norm(e.ville), debuts = [...new Set([base.slice(0, 3), base.slice(0, 4)].filter(d => d.length >= 3))];
        const dist = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
          for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
        const vus = new Map();
        for (const d of debuts){
          try { ((await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(d)}&count=60&language=fr&countryCode=CA`).then(r => r.json())).results || []).forEach(r => vus.set(r.id || r.name + r.admin1, r)); } catch (x){}
        }
        res = [...vus.values()].map(r => ({ r, d: dist(base, norm(r.name)) })).filter(x => x.d <= 3 && x.d <= Math.ceil(base.length / 3))
          .sort((x, y) => x.d - y.d || (y.r.population || 0) - (x.r.population || 0)).map(x => x.r);
      }
      if (!res.length){ err.textContent = `La ville « ${e.ville} » est introuvable. Vérifiez l'orthographe (ex. : Sherbrooke).`; err.hidden = false; return; }
      // Aucune ville exactement de ce nom : on propose les plus proches
      const lib = r => [r.name, r.admin1].filter(Boolean).join(", ");
      err.innerHTML = `Aucune ville nommée « ${esc(e.ville)} ». Vouliez-vous dire :<span class="as-prop">${res.slice(0, 3).map((r, i) => `<button type="button" class="btn ghost outline" data-i="${i}">${esc(lib(r))}</button>`).join("")}</span>`;
      err.hidden = false;
      err.querySelectorAll("[data-i]").forEach(bt => bt.onclick = () => { const r = res[+bt.dataset.i]; e.lieu = r; e.ville = r.name; pageHoraire(); });
    };
  }

  /* Prendre une photo ou choisir une image, puis la lire avec l'IA */
  function zonePhoto(id, texte){
    return `<label class="as-photo" for="${id}"><span class="as-photo-ic"><svg class="i" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></span>
      <b>${esc(texte)}</b><small>Prendre une photo, ou choisir une image ou un PDF</small></label>
      <input type="file" id="${id}" accept="image/*,application/pdf" hidden>
      <p class="note as-prive">🔒 Avant la photo, cachez ou coupez les informations personnelles (nom, courriel, mot de passe, numéro d'élève). Seul l'horaire est utile.</p>
      <div class="as-lecture" id="${id}-etat" hidden></div>`;
  }
  async function lirePhoto(input, prompt, quandFini, options = {}){
    const f = input.files[0]; if (!f) return;
    const etat = $(input.id + "-etat");
    etat.hidden = false; const quoi = options.fort ? "le calendrier" : "l'horaire", prenom = (e.prenom || "").trim();
    const attente = `Allez Hop! Nous assemblons ${quoi}${prenom ? " de " + esc(prenom) : ""}.`;
    etat.innerHTML = `<span class="as-spin"></span> ${attente} (${options.fort ? "environ une minute" : "environ 20 secondes"})`;
    const t0 = Date.now(), minuteur = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000), span = etat.querySelector(".as-attente"); if (span) span.textContent = ` ${sec} s`; }, 1000);
    try {
      const img = await photoEnBase64(f);
      etat.innerHTML = `${img.apercu ? `<img src="${img.apercu}" alt="">` : ""}<span><span class="as-spin"></span> ${attente}<span class="as-attente"></span><br><small>Gardez l'écran allumé. Si l'IA est occupée, l'app réessaie toute seule.</small></span>`;
      const r = Array.isArray(prompt) ? fusionnerCalendrier(await Promise.all(prompt.map(p => lireIA(p, img, options)))) : await lireIA(prompt, img, options);
      quandFini(r);
    } catch (err){
      console.error(err);
      // Le détail aide à trouver la cause (clé, accès à l'IA, modèle) : ce n'est pas toujours la photo.
      const detail = String(err.message || err).replace(/AIzaSy[\w-]+/g, "…").slice(0, 400);
      const delai = /abort|timed? ?out|timeout/i.test(detail);
      const surcharge = !delai && /\b(500|502|503|504)\b|overload|high demand|unavailable|try again later/i.test(detail);
      const credits = /prepayment|credits? (are|is) depleted|billing/i.test(detail);
      const quota = !credits && !surcharge && !delai && /429|quota|resource.?exhausted|rate.?limit/i.test(detail);
      const reseau = !credits && !quota && !surcharge && !delai && (err.code === "fetch-error" || /fetch|403|404|PERMISSION|API key|blocked/i.test(detail));
      etat.innerHTML = `<span class="err">${credits ? "La lecture automatique est momentanément indisponible. Vous pouvez remplir à la main, ou réessayer plus tard." : delai ? "La lecture a pris trop de temps (l'IA est lente ou la connexion est faible). Ce n'est pas votre photo : réessayez dans une minute." : surcharge ? "L'IA est très sollicitée en ce moment (ce n'est pas votre photo). Patientez une minute, puis réessayez." : quota ? "L'IA a atteint sa limite gratuite. Si vous avez déjà fait plusieurs lectures aujourd'hui, la limite du jour est atteinte : elle se renouvelle vers 3 h du matin. Sinon, patientez une minute. Vous pouvez aussi remplir à la main." : reseau ? "L'IA n'a pas pu être jointe : ce n'est pas la photo, c'est un réglage à vérifier." : "La lecture n'a pas fonctionné. Réessayez avec une photo plus nette, ou remplissez à la main."}</span>
        <button type="button" class="as-bug" aria-label="Signaler un bug"><svg class="i" viewBox="0 0 24 24"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg> Signaler un bug</button>
        <details class="as-detail"><summary>Détail pour le dépannage</summary><code>${esc((err.code ? err.code + " · " : "") + detail)}${err.tous ? esc("\n\nTous les essais :\n" + String(err.tous).replace(/AIzaSy[\w-]+/g, "…").slice(0, 900)) : ""}</code></details>`;
      const bug = etat.querySelector(".as-bug");
      if (bug) bug.onclick = async () => {
        bug.disabled = true;
        const rapport = { etape, code: String(err.code || ""), detail, tous: String(err.tous || "").replace(/AIzaSy[\w-]+/g, "…").slice(0, 1500) };
        try { if (!signaler) throw new Error("non disponible"); await signaler(rapport); bug.textContent = "✓ Merci, le bug est signalé"; }
        catch (x) {
          console.error(x);
          const cause = String((x && x.code) || (x && x.message) || x).slice(0, 80);
          const note = document.createElement("small"); note.className = "as-bug-note"; note.textContent = "Envoi impossible (" + cause + "). Le détail est copié à la place.";
          bug.after(note);
          const texte = "Allez Hop, bug à l'étape « " + etape + " » : " + (rapport.code ? rapport.code + " · " : "") + detail + (rapport.tous ? "\n" + rapport.tous : "");
          try { await navigator.clipboard.writeText(texte); toast("Le détail est copié : collez-le dans un message."); bug.textContent = "Détail copié"; }
          catch (y) { toast("Ouvrez « Détail pour le dépannage » et envoyez-en une capture."); bug.disabled = false; }
        }
      };
    } finally { clearInterval(minuteur); input.value = ""; }
  }

  /* 2. L'horaire de la classe */
  function pageHoraire(){
    etape = "horaire";
    page("L'horaire de la classe", "Étape 2 de 4", `
      <p>Prenez en photo la grille des <b>jours du cycle</b> (Jour 1, Jour 2…) avec les spécialistes. L'IA la lira, puis vous pourrez vérifier.</p>
      ${zonePhoto("as-f-horaire", "Photo de l'horaire")}`,
      `<button type="button" class="btn ghost" id="as-retour">Retour</button>${maj ? `<button type="button" class="btn ghost outline" id="as-garder">Garder l'horaire actuel</button>` : ""}<button type="button" class="btn ghost outline" id="as-main">Remplir à la main</button>`);
    $("as-retour").onclick = pageEnfant;
    if (maj) $("as-garder").onclick = () => {
      e.ordre = Array.isArray(enfant.ordreCycle) && enfant.ordreCycle.length ? enfant.ordreCycle.map(String) : null;
      e.joursCycle = e.ordre ? e.ordre.length : (enfant.joursCycle || 6);
      e.periodes = {}; Object.entries(enfant.periodes || {}).forEach(([k, h]) => { const x = hhmm(h); if (x) e.periodes[+k] = x; });
      e.cycle = {}; Object.entries(enfant.cycle || {}).forEach(([j, l]) => { e.cycle[j] = {}; Object.entries(l || {}).forEach(([k, m]) => { e.cycle[j][+k] = m; }); });
      doutes = []; pageVerifHoraire();
    };
    $("as-main").onclick = () => { if (!Object.keys(e.periodes).length) e.periodes = { 1: "08:00", 2: "09:00", 3: "10:15", 4: "11:00", 5: "13:00", 6: "14:00" }; pageVerifHoraire(); };
    $("as-f-horaire").onchange = ev => lirePhoto(ev.target, PROMPT_HORAIRE, r => {
      const jours = (r.jours || []).map(j => String(j).replace(/^jour\s*/i, "").trim().toUpperCase()).filter(Boolean);
      e.ordre = jours.length >= 2 && jours.length <= 12 ? jours : null;
      e.joursCycle = e.ordre ? e.ordre.length : Math.max(2, Math.min(10, parseInt(r.joursCycle, 10) || 6));
      e.periodes = {}; Object.entries(r.periodes || {}).forEach(([p, h]) => { if (/^\d{1,2}:\d{2}$/.test(h)) e.periodes[+p] = h.padStart(5, "0"); });
      e.cycle = {}; Object.entries(r.cycle || {}).forEach(([j, l]) => { j = String(j).replace(/^jour\s*/i, "").trim().toUpperCase(); e.cycle[j] = {}; Object.entries(l || {}).forEach(([p, m]) => { if (m) e.cycle[j][+p] = String(m).trim(); }); });
      doutes = r.doutes || [];
      pageVerifHoraire();
    });
  }

  /* 2b. Vérifier l'horaire : un tableau qu'on peut corriger */
  function pageVerifHoraire(){
    etape = "verif-horaire";
    const o = ordreDe(e), n = o.length, pers = Object.keys(e.periodes).map(Number).sort((a, b) => a - b);
    const estAB = o.length === 10 && o[0] === "1A";
    const noms = [...new Set([...Object.values(SUBJ).map(s => s.nom), ...Object.values(e.cycle).flatMap(l => Object.values(l).map(m => matiere(m).nom))])].sort((a, b) => a.localeCompare(b, "fr"));
    let t = `<div class="as-table"><table><thead><tr><th>Période</th>${o.map(j => `<th>Jour ${esc(j)}</th>`).join("")}</tr></thead><tbody>`;
    pers.forEach(p => {
      t += `<tr><th><span class="as-p">${p}<sup>${p === 1 ? "re" : "e"}</sup></span><input type="time" class="as-h" data-p="${p}" value="${esc(e.periodes[p])}" aria-label="Heure de la période ${p}"></th>`;
      for (const j of o){
        const v = e.cycle[j] && e.cycle[j][p] ? matiere(e.cycle[j][p]).nom : "";
        t += `<td><select data-j="${esc(j)}" data-p="${p}" aria-label="Jour ${esc(j)}, période ${p}"><option value="">—</option>${noms.map(m => `<option${m === v ? " selected" : ""}>${esc(m)}</option>`).join("")}<option value="__autre">Autre…</option></select></td>`;
      }
      t += `</tr>`;
    });
    t += `</tbody></table></div>`;
    page("Vérifiez l'horaire", "Étape 2 de 4", `
      <p>Voici ce que l'IA a lu. <b>Comparez avec la feuille</b> et corrigez au besoin : touchez une case pour changer la matière. « — » = cours avec l'enseignante.</p>
      ${doutes.length ? `<div class="as-doute">⚠️ À vérifier : ${doutes.map(esc).join(" · ")}</div>` : ""}
      <div class="as-ligne"><label for="as-n">Cycle</label><select id="as-n">${[4, 5, 6, 7, 8, 9, 10].map(x => `<option value="${x}"${!estAB && x === n ? " selected" : ""}>${x} jours (Jour 1 à ${x})</option>`).join("")}<option value="ab"${estAB ? " selected" : ""}>Semaines A et B (1A à 5B)</option></select></div>
      ${t}
      <div class="as-ligne"><button type="button" class="btn ghost outline as-petit" id="as-plus">+ Ajouter une période</button>${pers.length ? `<button type="button" class="btn ghost as-petit" id="as-moins">Retirer la dernière</button>` : ""}</div>`,
      `<button type="button" class="btn ghost" id="as-retour">Reprendre la photo</button><button type="button" class="btn primary" id="as-ok">C'est bon</button>`);
    const lire = () => {
      box.querySelectorAll(".as-h").forEach(i => { e.periodes[+i.dataset.p] = i.value; });
      box.querySelectorAll("select[data-j]").forEach(s => {
        const j = s.dataset.j, p = +s.dataset.p; e.cycle[j] ??= {};
        if (s.value) e.cycle[j][p] = s.value; else delete e.cycle[j][p];
      });
    };
    box.querySelectorAll("select[data-j]").forEach(s => s.onchange = () => {
      if (s.value !== "__autre") return;
      const nom = (prompt("Nom de la matière :") || "").trim();
      if (!nom){ s.value = ""; return; }
      lire(); e.cycle[s.dataset.j][+s.dataset.p] = nom; pageVerifHoraire();
    });
    $("as-n").onchange = () => { lire(); const v = $("as-n").value;
      if (v === "ab"){ e.ordre = ordreAB(); e.joursCycle = 10; } else { e.ordre = null; e.joursCycle = +v; }
      pageVerifHoraire(); };
    $("as-plus").onclick = () => { lire(); const p = (pers[pers.length - 1] || 0) + 1; e.periodes[p] = ""; pageVerifHoraire(); };
    if ($("as-moins")) $("as-moins").onclick = () => { lire(); const p = pers[pers.length - 1]; delete e.periodes[p]; Object.values(e.cycle).forEach(l => delete l[p]); pageVerifHoraire(); };
    $("as-retour").onclick = () => { lire(); pageHoraire(); };
    $("as-ok").onclick = () => {
      lire();
      if (Object.values(e.periodes).some(h => !h)){ toast("Indiquez l'heure de chaque période."); return; }
      pageCalendrier();
    };
  }

  /* 3. Le calendrier scolaire */
  function pageCalendrier(){
    etape = "calendrier";
    page("Le calendrier scolaire", "Étape 3 de 4", `
      <p>Prenez en photo le <b>calendrier de l'année</b> (les 12 mois sur une page). L'IA trouvera le début et la fin des classes, les congés et les journées pédagogiques.</p>
      ${zonePhoto("as-f-cal", "Photo du calendrier")}`,
      `<button type="button" class="btn ghost" id="as-retour">Retour</button><button type="button" class="btn ghost outline" id="as-main">Remplir à la main</button>`);
    $("as-retour").onclick = pageVerifHoraire;
    $("as-main").onclick = () => { const y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      if (!e.annee.debut) e.annee = { debut: `${y}-08-28`, fin: `${y + 1}-06-22` }; e.off ??= {}; lus = {}; doutes = []; pageVerifCalendrier(); };
    $("as-f-cal").onchange = ev => lirePhoto(ev.target, [promptCalendrier(0), promptCalendrier(1)], r => {
      const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
      if (!e.ecole && r.ecole) e.ecole = r.ecole;
      const noms = {}; (r.noms || []).forEach(x => { if (ok(x.date) && x.nom) noms[x.date] = x.nom; });
      lus = {}; e.off = {}; const classe = [];
      // Format compact { "AAAA-MM": { "jour": valeur } } ou ancien format { "AAAA-MM-JJ": valeur }
      const jours = {};
      Object.entries(r.jours || {}).forEach(([k, v]) => {
        if (/^\d{4}-\d{2}$/.test(k) && v && typeof v === "object") Object.entries(v).forEach(([j, x]) => { jours[k + "-" + String(j).padStart(2, "0")] = x; });
        else jours[k] = v;
      });
      Object.entries(jours).forEach(([d, v]) => {
        if (!ok(d) || [0, 6].includes(parse(d).getDay())) return;
        v = String(v ?? "").replace(/^jour\s*/i, "").trim().toUpperCase();
        if (v === "P" || v === "C" || v === "E") e.off[d] = { type: v === "C" ? "conge" : "ped", label: noms[d] || (v === "C" ? "Congé" : v === "E" ? "Pédagogique d'école" : "Journée pédagogique"), ...(v === "E" ? { ecole: true } : {}) };
        else if (v === "R") e.off[d] = { type: "conge", label: noms[d] || "Journée de reprise (si fermeture)" };
        else if (v && v !== "-"){ lus[d] = v; classe.push(d); }
      });
      classe.sort();
      const NOMS_J = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
      const recaler = (date, jour) => {
        const w = NOMS_J[String(jour || "").trim().toLowerCase()];
        if (w === undefined || parse(date).getDay() === w) return date;
        for (const dx of [-1, 1, -2, 2, -3, 3]) if (parse(addDays(date, dx)).getDay() === w) return addDays(date, dx);
        return date;
      };
      const evts = (r.evenements || []).filter(x => ok(x.date) && x.titre)
        .map(x => ({ date: recaler(x.date, x.jour), titre: String(x.titre).slice(0, 60), ic: iconeEvenement(x.titre) }));
      // Totaux de jours de classe imprimés pour chaque mois (si le calendrier en a)
      e.totaux = {}; Object.entries(r.joursParMois || {}).forEach(([m, n]) => { if (/^\d{4}-\d{2}$/.test(m) && Number.isFinite(+n) && +n >= 0) e.totaux[m] = +n; });
      // Le début et la fin de l'année sont vérifiés par des repères indépendants des numéros du cycle :
      // le total du mois imprimé, et l'événement « entrée des élèves ». Les jours en trop sont des pédagogiques.
      const retirer = d => { delete lus[d]; e.off[d] = { type: "ped", label: "Journée pédagogique" }; };
      let cl = classe.slice();
      const m1 = cl[0] && cl[0].slice(0, 7), m2 = cl.length && cl[cl.length - 1].slice(0, 7);
      if (m1 && e.totaux[m1] !== undefined){ const du = cl.filter(d => d.startsWith(m1)), extra = du.length - e.totaux[m1];
        if (extra > 0 && extra <= 8){ const out = du.slice(0, extra); out.forEach(retirer); cl = cl.filter(d => !out.includes(d)); } }
      if (m2 && e.totaux[m2] !== undefined){ const du = cl.filter(d => d.startsWith(m2)), extra = du.length - e.totaux[m2];
        if (extra > 0 && extra <= 8){ const out = du.slice(-extra); out.forEach(retirer); cl = cl.filter(d => !out.includes(d)); } }
      const entree = evts.find(x => /entr[ée]e|rentr[ée]e|premier jour/i.test(x.titre));
      if (entree && cl.length){ let d0 = entree.date; while ([0, 6].includes(parse(d0).getDay())) d0 = addDays(d0, 1);
        const avant = cl.filter(d => d < d0 && d >= addDays(d0, -10)); if (avant.length){ avant.forEach(retirer); cl = cl.filter(d => !avant.includes(d)); } }
      e.annee = { debut: cl[0] || "", fin: cl[cl.length - 1] || "" };
      // « Fin de l'année scolaire (élèves) » et « Début de l'année » tombent sur le dernier et le premier jour de classe :
      // si l'IA les a placés sur une journée pédagogique voisine, on les remet sur le bon jour.
      const proche = (x, d) => d && x.date !== d && Math.abs(parse(x.date) - parse(d)) <= 10 * 864e5;
      evts.forEach(x => {
        if (/fin de l.ann[ée]e|derni(er|ère) (jour|journ[ée]e)|fin des classes/i.test(x.titre) && proche(x, e.annee.fin)) x.date = e.annee.fin;
        else if (/d[ée]but de l.ann[ée]e|rentr[ée]e des [ée]l[èe]ves/i.test(x.titre) && proche(x, e.annee.debut)) x.date = e.annee.debut;
      });
      // seulement les congés pendant l'année (et la semaine avant la rentrée)
      Object.keys(e.off).forEach(d => { if (!e.annee.debut || d < addDays(e.annee.debut, -10) || d > e.annee.fin) delete e.off[d]; });
      e.evenements = evts.filter(x => x.date >= (e.annee.debut || "0") && x.date <= (e.annee.fin || "9"))
        .sort((a, b) => a.date.localeCompare(b.date));
      utiliserLus = null;
      doutes = r.doutes || [];
      // Les numéros lus sont recalés : le premier jour de classe est le jour 1 (modifiable dans la page de vérification).
      lusBrut = { ...lus }; e.debutIdx = 0; appliquerDebut();
      corriges = autoCorriger(e, lus);
      pageVerifCalendrier();
    }, { fort: true });
  }

  /* 3b. Vérifier le calendrier : les mois en petit, on touche un jour pour le corriger */
  function pageVerifCalendrier(){
    etape = "verif-cal";
    e.off ??= {};
    const valide = e.annee.debut && e.annee.fin && e.annee.debut < e.annee.fin;
    const cyc = valide ? cycleDe(e) : {};
    const dates = Object.keys(lus).filter(d => d >= e.annee.debut && d <= e.annee.fin);
    const diff = dates.filter(d => cyc[d] !== lus[d]);
    const accord = dates.length ? (dates.length - diff.length) / dates.length : 1;
    if (utiliserLus === null) utiliserLus = false;   // le calcul d'abord ; les numéros lus servent à vérifier
    const aff = d => utiliserLus && lus[d] ? lus[d] : cyc[d];
    const premierKo = diff.slice().sort()[0];
    const evtDe = {}, evtIc = {};
    e.evenements.forEach(x => { evtDe[x.date] = (evtDe[x.date] ? evtDe[x.date] + " · " : "") + x.titre; evtIc[x.date] = x.ic; });
    // Les totaux imprimés comptent aussi les pédagogiques d'école (jours où le cycle avance) : on fait pareil.
    const nbMois = {}; [...Object.keys(cyc), ...Object.keys(e.off).filter(d => e.off[d].compte && d >= e.annee.debut && d <= e.annee.fin)].forEach(d => { const m = d.slice(0, 7); nbMois[m] = (nbMois[m] || 0) + 1; });
    let mois = "";
    if (valide){
      for (let m = e.annee.debut.slice(0, 7) + "-01"; m <= e.annee.fin; m = (() => { const x = parse(m); x.setMonth(x.getMonth() + 1); return key(x); })()){
        const x = parse(m), nb = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
        let cases = "", premier = true;
        for (let j = 1; j <= nb; j++){
          const d = key(new Date(x.getFullYear(), x.getMonth(), j)), w = parse(d).getDay();
          if (w === 0 || w === 6) continue;
          if (premier){ cases += "<span></span>".repeat(w - 1); premier = false; }
          const o = e.off[d], hors = d < e.annee.debut || d > e.annee.fin, ko = !utiliserLus && d === premierKo;
          cases += `<button type="button" class="as-j${o ? " " + o.type : ""}${o && /reprise/i.test(o.label) ? " reprise" : ""}${o && o.compte ? " compte" : ""}${hors && !o ? " hors" : ""}${ko ? " ko" : ""}${corriges.includes(d) ? " corr" : ""}" data-d="${d}" ${hors && !o ? "disabled" : ""} title="${esc(longDate(d))}${o ? " : " + esc(o.label) : ""}"><b>${j}</b><i>${o ? (o.type === "ped" ? "péd." : /reprise/i.test(o.label) ? "reprise" : "congé") : hors ? "" : esc(aff(d) ?? "")}</i>${evtDe[d] ? `<em class="as-evt" title="${esc(evtDe[d])}">${ico(evtIc[d])}</em>` : ""}</button>`;
        }
        const ym = m.slice(0, 7), nbCl = nbMois[ym] || 0, tot = e.totaux && e.totaux[ym];
        const cpt = tot === undefined ? `<span class="as-mois-n">${nbCl} j.</span>` : nbCl === tot ? `<span class="as-mois-n ok">${nbCl} j. ✓</span>` : `<span class="as-mois-n ko">${nbCl} j. (calendrier : ${tot})</span>`;
        mois += `<div class="as-mois"><div class="as-mois-t">${MOIS[x.getMonth()]} ${x.getFullYear()} ${cpt}</div><div class="as-sem"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span></div><div class="as-grille">${cases}</div></div>`;
      }
    }
    const nbOff = Object.keys(e.off).filter(d => d >= e.annee.debut && d <= e.annee.fin).length;
    const ecartsMois = Object.keys(e.totaux || {}).filter(m => nbMois[m] !== undefined || (e.totaux[m] > 0 && m >= e.annee.debut.slice(0, 7) && m <= e.annee.fin.slice(0, 7)))
      .filter(m => (nbMois[m] || 0) !== e.totaux[m]).sort();
    page("Vérifiez le calendrier", "Étape 3 de 4", `
      <p>Comparez avec votre calendrier. <b>Touchez un jour pour le changer</b> : classe → pédagogique → pédagogique d'école → congé. Une journée de reprise (congé qui devient jour de classe en cas de fermeture) est un congé : touchez-la une fois de plus pour en faire un jour de classe.</p>
      <div class="as-legende"><span class="as-l"><i class="cl"></i>Classe (jour du cycle)</span><span class="as-l"><i class="ped"></i>Pédagogique</span><span class="as-l"><i class="ped compte"></i>Pédagogique d'école (le cycle avance)</span><span class="as-l"><i class="conge"></i>Congé</span><span class="as-l"><i class="conge reprise"></i>Reprise possible (tempête)</span></div>
      <div class="heures"><div><label for="as-debut">Premier jour de classe</label><input type="date" id="as-debut" value="${esc(e.annee.debut)}"></div>
        <div><label for="as-fin">Dernier jour</label><input type="date" id="as-fin" value="${esc(e.annee.fin)}"></div></div>
      <p class="note">Vérifiez avec votre calendrier : le <b>premier jour de classe</b> est celui de la rentrée des <b>élèves</b>. Les jours de formation du personnel (pédagogiques) juste avant n'en font pas partie.</p>
      <div class="field"><label for="as-pj">Au premier jour de classe, le cycle est au jour</label>
        <select id="as-pj" class="as-pj">${ordreDe(e).map((j, i) => `<option value="${i}"${(e.debutIdx || 0) === i ? " selected" : ""}>${esc(j)}</option>`).join("")}</select>
        <small class="note">Presque toujours le jour 1 : la rentrée des élèves commence le cycle.</small></div>
      ${dates.length ? (accord >= .95
        ? `<div class="as-ctrl ok">✓ Les numéros du cycle concordent avec votre calendrier.</div>`
        : `<div class="as-ctrl info"><b>À vérifier autour du ${esc(longDate(diff.sort()[0]))}</b> : à partir de cette date (en jaune), les numéros du cycle écrits sur votre calendrier ne suivent plus. Il y a sans doute un congé de trop ou manquant juste avant : touchez le jour pour le corriger.
            <label class="opt"><input type="checkbox" id="as-lus" ${utiliserLus ? "checked" : ""}><span>Suivre plutôt les numéros lus sur la photo<small>Seulement si votre école reprend le cycle autrement</small></span></label></div>`) : ""}
      ${corriges.length ? `<div class="as-ctrl ok"><b>✓ Le calendrier a permis de corriger ${corriges.length} jour(s)</b> (encadrés en vert), grâce aux numéros du cycle.
        ${(corriges.aConfirmer || []).length ? `<p class="as-conf-t">Le numéro du cycle avance ces jours-là. Mais y a-t-il classe pour les élèves? À vous de confirmer :</p>${corriges.aConfirmer.map(d => `<div class="as-conf"><span>${esc(longDate(d))}</span><span class="as-conf-b"><button type="button" data-conf="${d}" data-v="classe" class="${!e.off[d] ? "on" : ""}">Classe</button><button type="button" data-conf="${d}" data-v="ferme" class="${e.off[d] ? "on" : ""}">Pas de classe</button></span></div>`).join("")}` : ""}
        ${corriges.filter(d => !(corriges.aConfirmer || []).includes(d)).map(d => `<p class="as-conf-t">${esc(longDate(d))} : ${esc(corriges.notes[d] || "")}</p>`).join("")}</div>` : ""}
      ${ecartsMois.length ? `<div class="as-ctrl info"><b>Nombre de jours de classe à vérifier</b> : ${ecartsMois.map(m => `${esc(MOIS[+m.slice(5, 7) - 1])} (calendrier : ${e.totaux[m]}, ici : ${nbMois[m] || 0})`).join(" · ")}. Les mois concernés sont marqués en rouge ci-dessous.</div>` : ""}
      ${doutes.length ? `<details class="as-detail"><summary>Notes de l'IA</summary>${doutes.map(esc).join("<br>")}</details>` : ""}
      <div class="as-annee">${mois}</div>
      <div class="as-titre-liste">Événements de l'école (${e.evenements.length})</div>
      <ul class="as-conges">${e.evenements.map((x, i) => `<li><span class="as-ev-ic">${ico(x.ic)}</span><span><b>${esc(x.titre)}</b><small>${esc(longDate(x.date))}</small></span><button type="button" class="as-retirer as-ev-x" data-i="${i}" aria-label="Retirer">${xIcon}</button></li>`).join("") || "<li><small>Aucun événement relevé. Vous pouvez en ajouter.</small></li>"}</ul>
      <details class="as-ajout"><summary>+ Ajouter un événement</summary>
        <div class="heures"><div><label for="as-e-date">Date</label><input type="date" id="as-e-date"></div><div><label for="as-e-type">Genre</label><select id="as-e-type"><option value="photo|Photo scolaire">Photo scolaire</option><option value="communication|Première communication">Première communication</option><option value="bulletin|Bulletin">Bulletin</option><option value="flag|Fin d'étape">Fin d'étape</option><option value="pin|">Autre…</option></select></div></div>
        <input type="text" id="as-e-nom" placeholder="Nom (si « Autre »)" maxlength="60" class="as-ev-nom">
        <button type="button" class="btn ghost outline as-petit" id="as-e-ajout">Ajouter</button></details>
      <p class="note">${Object.keys(cyc).length} jours de classe · ${nbOff} jours pédagogiques ou de congé</p>`,
      `<button type="button" class="btn ghost" id="as-retour">Reprendre la photo</button><button type="button" class="btn primary" id="as-ok">C'est bon</button>`);
    const lireDates = () => { e.annee.debut = $("as-debut").value; e.annee.fin = $("as-fin").value; };
    $("as-debut").onchange = $("as-fin").onchange = () => { lireDates(); appliquerDebut(); pageVerifCalendrier(); };
    $("as-pj").onchange = () => { lireDates(); e.debutIdx = +$("as-pj").value; appliquerDebut(); pageVerifCalendrier(); };
    if ($("as-lus")) $("as-lus").onchange = () => { utiliserLus = $("as-lus").checked; pageVerifCalendrier(); };
    box.querySelectorAll("[data-conf]").forEach(b => b.onclick = () => {
      const d = b.dataset.conf, y = box.scrollTop;
      if (b.dataset.v === "classe") delete e.off[d]; else e.off[d] = { type: "ped", label: "Pédagogique d'école", compte: true, ecole: true };
      lireDates(); pageVerifCalendrier(); box.scrollTop = y;
    });
    box.querySelectorAll(".as-ev-x").forEach(b => b.onclick = () => { const y = box.scrollTop; lireDates(); e.evenements.splice(+b.dataset.i, 1); pageVerifCalendrier(); box.scrollTop = y; });
    $("as-e-ajout").onclick = () => {
      const date = $("as-e-date").value, [ic, titre0] = $("as-e-type").value.split("|"), titre = $("as-e-nom").value.trim() || titre0;
      if (!date || !titre){ toast("Choisissez une date et un nom."); return; }
      const y = box.scrollTop; lireDates();
      e.evenements.push({ date, titre, ic }); e.evenements.sort((a, b) => a.date.localeCompare(b.date));
      pageVerifCalendrier(); box.scrollTop = y;
    };
    box.querySelectorAll(".as-j[data-d]").forEach(b => b.onclick = () => {
      const d = b.dataset.d, o = e.off[d], y = box.scrollTop;
      if (!o) e.off[d] = { type: "ped", label: "Journée pédagogique" };
      else if (o.type === "ped" && !o.compte) e.off[d] = { type: "ped", label: "Pédagogique d'école", compte: true };
      else if (o.type === "ped") e.off[d] = { type: "conge", label: "Congé" };
      else delete e.off[d];
      pageVerifCalendrier(); box.scrollTop = y;
    });
    $("as-retour").onclick = () => { lireDates(); pageCalendrier(); };
    $("as-ok").onclick = () => { lireDates(); if (!valide){ toast("Vérifiez les dates de début et de fin."); return; } pageFin(); };
  }

  /* 4. Résumé et enregistrement */
  function pageFin(){
    etape = "fin";
    const cyc = cycleDe(e), jours = Object.keys(cyc).length;
    const nbSp = Object.values(e.cycle).reduce((s, l) => s + Object.keys(l).length, 0);
    page(`Tout est prêt pour ${e.prenom}`, "Étape 4 de 4", `
      <ul class="as-resume">
        <li><b>${esc(e.prenom)}</b>${e.ecole ? ` · ${esc(e.ecole)}` : ""}</li>
        <li>Cycle de <b>${ordreDe(e).length} jours</b> (${esc(ordreDe(e)[0])} à ${esc(ordreDe(e).at(-1))}), ${Object.keys(e.periodes).length} périodes, ${nbSp} cours avec un spécialiste</li>
        <li>Du ${esc(longDate(e.annee.debut))} au ${esc(longDate(e.annee.fin))} : <b>${jours} jours de classe</b></li>
        <li>${congesDe(e).length} congés et journées pédagogiques${e.evenements.length ? `, ${e.evenements.length} événements de l'école` : ""}</li>
        <li>Météo de <b>${esc(e.ville)}</b></li>
      </ul>
      <p class="note">Vous pourrez ajouter les choses à apporter (ex. espadrilles pour l'éduc) et les activités plus tard.</p>
      <p class="err" id="as-err" hidden></p>`,
      `<button type="button" class="btn ghost" id="as-retour">Retour</button><button type="button" class="btn primary" id="as-ok">Enregistrer</button>`);
    $("as-retour").onclick = pageVerifCalendrier;
    $("as-ok").onclick = async () => {
      const b = $("as-ok"); b.disabled = true; b.textContent = "Enregistrement…";
      try {
        // position pour la météo (Open-Meteo, sans clé)
        // Mise à jour sans changement de ville : on garde la position déjà connue
        const memeVille = maj && enfant.lat != null && (enfant.ville || "").trim().toLowerCase() === e.ville.trim().toLowerCase();
        const g = memeVille || (e.lieu && e.lieu.name === e.ville) ? {} : await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e.ville)}&count=1&language=fr&countryCode=CA`).then(r => r.json()).catch(() => ({}));
        const lieu = memeVille ? { name: enfant.ville, latitude: enfant.lat, longitude: enfant.lon } : (e.lieu && e.lieu.name === e.ville ? e.lieu : g.results && g.results[0]);
        if (!lieu) throw new Error(`Ville introuvable : « ${e.ville} ». Vérifiez l'orthographe à l'étape 1.`);
        const fin = e.annee.fin, finEte = addDays(fin, 7);
        const periodes = {}; Object.entries(e.periodes).forEach(([p, h]) => { periodes[p] = heureFr(h); });
        const o = ordreDe(e), num = o.every((j, i) => j === String(i + 1));
        const cycle = {}; Object.entries(e.cycle).forEach(([j, l]) => { if (o.includes(j) && Object.keys(l).length){ cycle[j] = {}; Object.entries(l).forEach(([p, m]) => { cycle[j][p] = cleMatiere(m) || m; }); } });
        o.forEach(j => cycle[j] ??= {});
        const evenements = [{ date: e.annee.debut, ic: "bell", titre: "Entrée des élèves" }, ...e.evenements.filter(x => x.date !== e.annee.debut)];
        await enregistrer({
          prenom: e.prenom, classe: e.classe, ecole: e.ecole, ville: lieu.name || e.ville,
          lat: Math.round(lieu.latitude * 1000) / 1000, lon: Math.round(lieu.longitude * 1000) / 1000,
          annee: { debut: e.annee.debut, fin, finEte }, joursCycle: o.length, ...(num ? {} : { ordreCycle: o }), ...(e.debutIdx ? { debutCycle: e.debutIdx } : {}), periodes, cycle, conges: congesDe(e), evenements,
          ...(utiliserLus && Object.keys(lus).length ? { calendrierCycle: lus } : {}),
        });
        fermer(); toast(maj ? `L'horaire de ${e.prenom} est à jour pour la nouvelle année 🎉` : `L'horaire de ${e.prenom} est enregistré 🎉`);
      } catch (err){
        b.disabled = false; b.textContent = "Enregistrer";
        const m = $("as-err"); m.textContent = err.message || "L'enregistrement n'a pas fonctionné. Réessayez."; m.hidden = false;
      }
    };
  }

  pageEnfant();
  return { fermer };
}

// pour les tests
export { cycleDe, congesDe, autoCorriger, accordDe };

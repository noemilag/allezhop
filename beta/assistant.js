/* Allez Hop, essai B : assistant d'accueil d'une famille.
   Étapes : l'enfant → photo de l'horaire → photo du calendrier scolaire → vérification → enregistrement.
   L'IA (Gemini, par Firebase AI Logic) lit les photos ; tout se vérifie et se corrige avant d'enregistrer. */
import { SUBJ, cleMatiere, matiere } from "./school.js?v=202610302011";

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

function promptCalendrier(){
  return `Tu lis la photo d'un calendrier scolaire d'une école primaire du Québec (une année scolaire, de juillet à juin).
Trouve : le premier et le dernier jour de classe des élèves ; tous les jours sans classe en semaine (congés et journées pédagogiques),
avec leur type ("ped" pour une journée pédagogique, "conge" pour un congé férié ou des vacances) et un court nom en français
(ex. « Journée pédagogique », « Action de grâce », « Congé des Fêtes », « Relâche ») ; regroupe les jours consécutifs (du … au …).
Les journées de réserve en cas de force majeure ne sont PAS des congés : ignore-les.
Note aussi les événements de la légende (photo scolaire, bulletin, première communication, fin d'étape) avec leur date.
Si les dates portent un numéro de jour du cycle (petit chiffre en exposant ou sous la date, parfois avec une lettre A ou B), relève-le pour CHAQUE jour de classe : "1", "2", … ou "1A", "2B".
Le document peut être une photo ou un PDF. Toutes les dates au format AAAA-MM-JJ ; juillet à décembre sont de la première année, janvier à juin de la deuxième.
${CONSIGNE_PRIVEE}
Réponds seulement en JSON :
{"ecole": "nom de l'école ou vide", "annee": {"debut": "AAAA-MM-JJ", "fin": "AAAA-MM-JJ"},
 "conges": [{"du":"AAAA-MM-JJ","au":"AAAA-MM-JJ","type":"ped|conge","label":"…"}],
 "evenements": [{"date":"AAAA-MM-JJ","titre":"…"}],
 "joursParDate": {"AAAA-MM-JJ": "numéro du jour du cycle", …}, "doutes": ["…"]}`;
}

/* ---------- Le cycle, calculé comme dans l'app : il avance seulement les jours de classe ---------- */
// Noms des jours du cycle dans l'ordre : "1".."N", ou "1A".."5A","1B".."5B" pour des semaines A et B
const ordreDe = e => e.ordre && e.ordre.length ? e.ordre : Array.from({ length: +e.joursCycle || 6 }, (_, i) => String(i + 1));
const ordreAB = () => [..."ABCD".slice(0, 2)].flatMap(l => [1, 2, 3, 4, 5].map(i => i + l));
function cycleDe(e){
  const off = new Set(); (e.conges || []).forEach(c => { for (let k = c.du; k <= (c.au || c.du); k = addDays(k, 1)) off.add(k); });
  const o = ordreDe(e), out = {};
  for (let k = e.annee.debut, i = 0; k <= e.annee.fin; k = addDays(k, 1)){
    const w = parse(k).getDay();
    if (w > 0 && w < 6 && !off.has(k)){ out[k] = o[i % o.length]; i++; }
  }
  return out;
}

const ICONES_EVT = { photo: "📸", bulletin: "📄", communication: "✉️", etape: "🏁", entree: "🔔" };
function iconeEvenement(t){ const n = (t || "").toLowerCase();
  if (n.includes("photo")) return ICONES_EVT.photo; if (n.includes("bulletin")) return ICONES_EVT.bulletin;
  if (n.includes("communication")) return ICONES_EVT.communication; if (n.includes("étape") || n.includes("etape")) return ICONES_EVT.etape;
  if (n.includes("entrée") || n.includes("rentrée")) return ICONES_EVT.entree; return "📌"; }

/* ---------- L'assistant ---------- */
export function demarrerAssistant({ lireIA, enregistrer, toast, annuler }){
  const box = document.createElement("section");
  box.className = "assistant"; box.id = "assistant";
  document.body.appendChild(box);
  const e = { prenom: "", classe: "", ecole: "", ville: "", joursCycle: 6, periodes: {}, cycle: {}, annee: { debut: "", fin: "" }, conges: [], evenements: [] };
  let doutes = [], lus = {}, utiliserLus = null, etape = "enfant";

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
    page("Votre enfant", "Étape 1 de 4", `
      <div class="field"><label for="as-prenom">Prénom</label><input type="text" id="as-prenom" maxlength="40" autocomplete="off" value="${esc(e.prenom)}"></div>
      <div class="field"><label for="as-classe">Classe ou groupe</label><input type="text" id="as-classe" maxlength="20" placeholder="Ex. : 124" value="${esc(e.classe)}"></div>
      <div class="field"><label for="as-ecole">École</label><input type="text" id="as-ecole" maxlength="80" value="${esc(e.ecole)}"></div>
      <div class="field"><label for="as-ville">Ville (pour la météo)</label><input type="text" id="as-ville" maxlength="60" placeholder="Ex. : Saint-Jean-sur-Richelieu" value="${esc(e.ville)}"></div>
      <p class="err" id="as-err" hidden></p>`,
      `<button type="button" class="btn primary" id="as-suivant">Continuer</button>`);
    $("as-suivant").onclick = async () => {
      e.prenom = $("as-prenom").value.trim(); e.classe = $("as-classe").value.trim(); e.ecole = $("as-ecole").value.trim(); e.ville = $("as-ville").value.trim();
      const err = $("as-err");
      if (!e.prenom){ err.textContent = "Écrivez le prénom de l'enfant."; err.hidden = false; return; }
      if (!e.ville){ err.textContent = "Écrivez la ville, pour la météo."; err.hidden = false; return; }
      pageHoraire();
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
  async function lirePhoto(input, prompt, quandFini){
    const f = input.files[0]; if (!f) return;
    const etat = $(input.id + "-etat");
    etat.hidden = false; etat.innerHTML = `<span class="as-spin"></span> Lecture de la photo… (environ 20 secondes)`;
    try {
      const img = await photoEnBase64(f);
      etat.innerHTML = `${img.apercu ? `<img src="${img.apercu}" alt="">` : ""}<span><span class="as-spin"></span> L'IA lit le document…</span>`;
      const r = await lireIA(prompt, img);
      quandFini(r);
    } catch (err){
      console.error(err);
      // Le détail aide à trouver la cause (clé, accès à l'IA, modèle) : ce n'est pas toujours la photo.
      const detail = String(err.message || err).replace(/AIzaSy[\w-]+/g, "…").slice(0, 400);
      const reseau = err.code === "fetch-error" || /fetch|403|404|PERMISSION|API key|blocked/i.test(detail);
      etat.innerHTML = `<span class="err">${reseau ? "L'IA n'a pas pu être jointe : ce n'est pas la photo, c'est un réglage à vérifier." : "La lecture n'a pas fonctionné. Réessayez avec une photo plus nette, ou remplissez à la main."}</span>
        <details class="as-detail"><summary>Détail pour le dépannage</summary><code>${esc((err.code ? err.code + " · " : "") + detail)}</code></details>`;
    } finally { input.value = ""; }
  }

  /* 2. L'horaire de la classe */
  function pageHoraire(){
    etape = "horaire";
    page("L'horaire de la classe", "Étape 2 de 4", `
      <p>Prenez en photo la grille des <b>jours du cycle</b> (Jour 1, Jour 2…) avec les spécialistes. L'IA la lira, puis vous pourrez vérifier.</p>
      ${zonePhoto("as-f-horaire", "Photo de l'horaire")}`,
      `<button type="button" class="btn ghost" id="as-retour">Retour</button><button type="button" class="btn ghost outline" id="as-main">Remplir à la main</button>`);
    $("as-retour").onclick = pageEnfant;
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
      if (!e.annee.debut) e.annee = { debut: `${y}-08-28`, fin: `${y + 1}-06-22` }; lus = {}; doutes = []; pageVerifCalendrier(); };
    $("as-f-cal").onchange = ev => lirePhoto(ev.target, promptCalendrier(), r => {
      const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
      e.annee = { debut: ok(r.annee?.debut) ? r.annee.debut : "", fin: ok(r.annee?.fin) ? r.annee.fin : "" };
      if (!e.ecole && r.ecole) e.ecole = r.ecole;
      e.conges = (r.conges || []).filter(c => ok(c.du)).map(c => ({ du: c.du, au: ok(c.au) ? c.au : c.du, type: c.type === "ped" ? "ped" : "conge", label: c.label || (c.type === "ped" ? "Journée pédagogique" : "Congé") }))
        .sort((a, b) => a.du.localeCompare(b.du));
      e.evenements = (r.evenements || []).filter(x => ok(x.date) && x.titre).map(x => ({ date: x.date, titre: x.titre, ic: iconeEvenement(x.titre) }));
      lus = {}; Object.entries(r.joursParDate || {}).forEach(([d, j]) => { if (ok(d) && j != null && j !== "") lus[d] = String(j).replace(/^jour\s*/i, "").trim().toUpperCase(); });
      utiliserLus = null;
      doutes = r.doutes || [];
      pageVerifCalendrier();
    });
  }

  /* 3b. Vérifier le calendrier : dates, congés, et contrôle du cycle */
  function pageVerifCalendrier(){
    etape = "verif-cal";
    const valide = e.annee.debut && e.annee.fin && e.annee.debut < e.annee.fin;
    const cyc = valide ? cycleDe(e) : {};
    const dates = Object.keys(lus).filter(d => cyc[d] !== undefined || d >= e.annee.debut && d <= e.annee.fin).sort();
    const diff = dates.filter(d => cyc[d] !== lus[d]);
    const accord = dates.length ? (dates.length - diff.length) / dates.length : 1;
    // Peu de différences : sans doute des chiffres mal lus, on garde le calcul. Beaucoup : on suit le calendrier.
    if (utiliserLus === null) utiliserLus = dates.length >= 20 && accord < .9;
    const conges = e.conges.map((c, i) => `<li><span><b>${esc(c.label)}</b><small>${c.du === c.au ? esc(longDate(c.du)) : `du ${esc(longDate(c.du))} au ${esc(longDate(c.au))}`} · ${c.type === "ped" ? "pédagogique" : "congé"}</small></span><button type="button" class="as-retirer" data-i="${i}" aria-label="Retirer">${xIcon}</button></li>`).join("");
    page("Vérifiez le calendrier", "Étape 3 de 4", `
      ${doutes.length ? `<div class="as-doute">⚠️ À vérifier : ${doutes.map(esc).join(" · ")}</div>` : ""}
      <div class="heures"><div><label for="as-debut">Premier jour de classe</label><input type="date" id="as-debut" value="${esc(e.annee.debut)}"></div>
        <div><label for="as-fin">Dernier jour</label><input type="date" id="as-fin" value="${esc(e.annee.fin)}"></div></div>
      ${dates.length ? `<div class="as-ctrl ${diff.length ? "ko" : "ok"}"><b>${diff.length ? `⚠️ ${diff.length} jour(s) sur ${dates.length} ne concordent pas` : `✓ Le cycle concorde avec votre calendrier (${dates.length} jours vérifiés)`}</b>
        ${diff.length ? `<ul>${diff.slice(0, 8).map(d => `<li>${esc(longDate(d))} : calendrier <b>${esc(lus[d])}</b>, calcul ${cyc[d] ? `<b>${esc(cyc[d])}</b>` : "<b>pas d'école</b>"}</li>`).join("")}${diff.length > 8 ? `<li>et ${diff.length - 8} autres</li>` : ""}</ul>
        <small>Si c'est le calcul qui se trompe, il manque sans doute un congé (ou il y en a un de trop) dans la liste ci-dessous. Si c'est la lecture, ignorez.</small>
        <label class="opt"><input type="checkbox" id="as-lus" ${utiliserLus ? "checked" : ""}><span>Suivre les numéros lus sur le calendrier<small>Utile si l'école reprend le cycle autrement (fermeture, reprise d'une journée)</small></span></label>` : ""}</div>` : ""}
      <div class="as-titre-liste">Congés et journées pédagogiques (${e.conges.length})</div>
      <ul class="as-conges">${conges || "<li><small>Aucun pour l'instant.</small></li>"}</ul>
      <details class="as-ajout"><summary>+ Ajouter un congé</summary>
        <div class="heures"><div><label for="as-c-du">Du</label><input type="date" id="as-c-du"></div><div><label for="as-c-au">Au</label><input type="date" id="as-c-au"></div></div>
        <div class="as-ligne"><select id="as-c-type"><option value="ped">Journée pédagogique</option><option value="conge">Congé</option></select><input type="text" id="as-c-nom" placeholder="Nom (facultatif)"></div>
        <button type="button" class="btn ghost outline as-petit" id="as-c-ajout">Ajouter</button></details>`,
      `<button type="button" class="btn ghost" id="as-retour">Reprendre la photo</button><button type="button" class="btn primary" id="as-ok">C'est bon</button>`);
    const lireDates = () => { e.annee.debut = $("as-debut").value; e.annee.fin = $("as-fin").value; };
    $("as-debut").onchange = $("as-fin").onchange = () => { lireDates(); pageVerifCalendrier(); };
    if ($("as-lus")) $("as-lus").onchange = () => { utiliserLus = $("as-lus").checked; };
    box.querySelectorAll(".as-retirer").forEach(b => b.onclick = () => { lireDates(); e.conges.splice(+b.dataset.i, 1); pageVerifCalendrier(); });
    $("as-c-ajout").onclick = () => {
      const du = $("as-c-du").value, au = $("as-c-au").value || du, type = $("as-c-type").value;
      if (!du) return; lireDates();
      e.conges.push({ du, au: au < du ? du : au, type, label: $("as-c-nom").value.trim() || (type === "ped" ? "Journée pédagogique" : "Congé") });
      e.conges.sort((a, b) => a.du.localeCompare(b.du)); pageVerifCalendrier();
    };
    $("as-retour").onclick = () => { lireDates(); pageCalendrier(); };
    $("as-ok").onclick = () => { lireDates(); if (!(e.annee.debut && e.annee.fin && e.annee.debut < e.annee.fin)){ toast("Vérifiez les dates de début et de fin."); return; } pageFin(); };
  }

  /* 4. Résumé et enregistrement */
  function pageFin(){
    etape = "fin";
    const cyc = cycleDe(e), jours = Object.keys(cyc).length;
    const nbSp = Object.values(e.cycle).reduce((s, l) => s + Object.keys(l).length, 0);
    page(`Tout est prêt pour ${e.prenom}`, "Étape 4 de 4", `
      <ul class="as-resume">
        <li><b>${esc(e.prenom)}</b>${e.classe ? `, classe ${esc(e.classe)}` : ""}${e.ecole ? ` · ${esc(e.ecole)}` : ""}</li>
        <li>Cycle de <b>${ordreDe(e).length} jours</b> (${esc(ordreDe(e)[0])} à ${esc(ordreDe(e).at(-1))}), ${Object.keys(e.periodes).length} périodes, ${nbSp} cours avec un spécialiste</li>
        <li>Du ${esc(longDate(e.annee.debut))} au ${esc(longDate(e.annee.fin))} : <b>${jours} jours de classe</b></li>
        <li>${e.conges.length} congés et journées pédagogiques${e.evenements.length ? `, ${e.evenements.length} événements de l'école` : ""}</li>
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
        const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e.ville)}&count=1&language=fr&countryCode=CA`).then(r => r.json()).catch(() => ({}));
        const lieu = g.results && g.results[0];
        if (!lieu) throw new Error(`Ville introuvable : « ${e.ville} ». Vérifiez l'orthographe à l'étape 1.`);
        const fin = e.annee.fin, finEte = addDays(fin, 7);
        const periodes = {}; Object.entries(e.periodes).forEach(([p, h]) => { periodes[p] = heureFr(h); });
        const o = ordreDe(e), num = o.every((j, i) => j === String(i + 1));
        const cycle = {}; Object.entries(e.cycle).forEach(([j, l]) => { if (o.includes(j) && Object.keys(l).length){ cycle[j] = {}; Object.entries(l).forEach(([p, m]) => { cycle[j][p] = cleMatiere(m) || m; }); } });
        o.forEach(j => cycle[j] ??= {});
        const evenements = [{ date: e.annee.debut, ic: "🔔", titre: "Entrée des élèves" }, ...e.evenements.filter(x => x.date !== e.annee.debut)];
        await enregistrer({
          prenom: e.prenom, classe: e.classe, ecole: e.ecole, ville: lieu.name || e.ville,
          lat: Math.round(lieu.latitude * 1000) / 1000, lon: Math.round(lieu.longitude * 1000) / 1000,
          annee: { debut: e.annee.debut, fin, finEte }, joursCycle: o.length, ...(num ? {} : { ordreCycle: o }), periodes, cycle, conges: e.conges, evenements,
          ...(utiliserLus && Object.keys(lus).length ? { calendrierCycle: lus } : {}),
        });
        fermer(); toast(`L'horaire de ${e.prenom} est enregistré 🎉`);
      } catch (err){
        b.disabled = false; b.textContent = "Enregistrer";
        const m = $("as-err"); m.textContent = err.message || "L'enregistrement n'a pas fonctionné. Réessayez."; m.hidden = false;
      }
    };
  }

  pageEnfant();
  return { fermer };
}

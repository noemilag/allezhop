/* Allez Hop : mécanique de l'horaire, partagée entre l'app (app.js) et la notification du matin
   (scripts/notifier.js). Aucune donnée personnelle ici : le prénom, la classe, l'école, la ville,
   le calendrier et l'horaire de l'enfant sont dans Firebase (collection « enfants ») et sont
   chargés après la connexion avec chargerEnfant(). */

/* ---------- Matières (catalogue commun) ---------- */
const SUBJ = {
  educ:   {ic:"ball", nom:"Éducation physique", court:"Éduc", em:"👟", apporter:"Vêtements d'éduc et espadrilles"},
  biblio: {ic:"book", nom:"Bibliothèque", court:"Biblio", em:"📚", apporter:"Livre de bibliothèque"},
  angl:   {ic:"chat", nom:"Anglais", court:"Anglais", em:"🗣️"},
  arts:   {ic:"palette", nom:"Arts plastiques", court:"Arts", em:"🎨"},
  ccq:    {ic:"globe", nom:"Culture et citoyenneté", court:"CCQ", em:"🌎"},
  ordi:   {ic:"laptop", nom:"Ordinateurs", court:"Ordis", em:"💻"},
  mus:    {ic:"music", nom:"Musique", court:"Musique", em:"🎵"},
};
// Habillement typique par mois (0 = janvier), pour les jours sans prévision
const SAISON = [
  ["🧤","Habit de neige, bottes, tuque, mitaines et cache-cou"],
  ["🧤","Habit de neige, bottes, tuque, mitaines et cache-cou"],
  ["🥾","Habit de neige ou manteau chaud, bottes pour la slush"],
  ["🌧️","Manteau mi-saison, bottes de pluie, tuque le matin"],
  ["🧥","Veste légère et imperméable"],
  ["🧢","T-shirt, casquette et crème solaire"],
  ["🧢","T-shirt, casquette et crème solaire"],
  ["🧢","T-shirt, casquette et crème solaire"],
  ["👕","T-shirt et petite veste pour le matin"],
  ["🧥","Manteau mi-saison, une couche de plus le matin"],
  ["🧣","Manteau, tuque et mitaines le matin"],
  ["🧤","Habit de neige, bottes, tuque, mitaines et cache-cou"],
];

/* ---------- Enfant chargé depuis Firebase ---------- */
// Ces valeurs sont remplacées par chargerEnfant() ; les modules qui les importent voient la mise à jour.
let ENFANT = {prenom:"", classe:""};
let FIRST = "", LAST = "", END = "";
let PERIODES = {}, CYCLE = {}, EVENTS = {}, OFF = {}, CYCLE_OF = {};
let LAT = 0, LON = 0, METEO_URL = "", WX_URL = "";

/* ---------- Dates ---------- */
function parse(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function key(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(s,n){ const d=parse(s); d.setDate(d.getDate()+n); return key(d); }
const JOURS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function longDate(s){ const d=parse(s); return JOURS[d.getDay()]+" "+(d.getDate()===1?"1er":d.getDate())+" "+MOIS[d.getMonth()]; }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function todayKey(){ return key(new Date()); }
function daysFromToday(k){ return Math.round((parse(k)-parse(todayKey()))/864e5); }

function chargerEnfant(d){
  ENFANT = {prenom:d.prenom||"", classe:d.classe||"", ecole:d.ecole||"", ville:d.ville||""};
  FIRST = d.annee.debut; LAST = d.annee.fin; END = d.annee.finEte || d.annee.fin;
  PERIODES = d.periodes || {};
  CYCLE = d.cycle || {};
  EVENTS = {};
  (d.evenements||[]).forEach(e=>{ (EVENTS[e.date] ??= []).push(e.note ? [e.ic, e.titre, e.note] : [e.ic, e.titre]); });
  OFF = {};
  (d.conges||[]).forEach(c=>{ for(let x=parse(c.du); key(x)<=(c.au||c.du); x.setDate(x.getDate()+1)) OFF[key(x)] = {type:c.type, label:c.label}; });
  // Le cycle avance seulement les jours d'école.
  const n = d.joursCycle || Object.keys(CYCLE).length || 6;
  CYCLE_OF = {};
  for(let x=parse(FIRST), i=0; key(x)<=LAST; x.setDate(x.getDate()+1)){
    const k=key(x), w=x.getDay();
    if(w>0 && w<6 && !OFF[k]){ CYCLE_OF[k]=(i%n)+1; i++; }
  }
  LAT = d.lat; LON = d.lon;
  METEO_URL = d.meteoUrl || `https://meteo.gc.ca/fr/location/index.html?coords=${LAT},${LON}`;
  WX_URL = "https://api.open-meteo.com/v1/forecast?latitude="+LAT+"&longitude="+LON+
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,rain,showers,snowfall,weather_code,wind_gusts_10m"+
    "&timezone=America%2FToronto&forecast_days=8";
}
// Vérifie qu'un objet a la forme attendue avant de l'enregistrer ; renvoie un message d'erreur ou "".
function validerEnfant(d){
  if(!d || typeof d!=="object") return "Ce n'est pas un fichier de données valide.";
  if(!d.prenom) return "Le prénom est manquant.";
  if(!d.annee || !/^\d{4}-\d{2}-\d{2}$/.test(d.annee.debut||"") || !/^\d{4}-\d{2}-\d{2}$/.test(d.annee.fin||"")) return "Les dates de l'année scolaire sont manquantes.";
  if(!d.cycle || !Object.keys(d.cycle).length) return "L'horaire du cycle est manquant.";
  if(typeof d.lat!=="number" || typeof d.lon!=="number") return "La position pour la météo est manquante.";
  return "";
}

function infoFor(k){
  const w=parse(k).getDay(), j=CYCLE_OF[k];
  if(j) return {kind:"ecole", jour:j};
  if(w===0||w===6) return {kind:"weekend", label:"Fin de semaine"};
  if(OFF[k]) return {kind:"off", ...OFF[k]};
  if(k>LAST) return {kind:"off", type:"conge", label:"Vacances d'été"};
  return {kind:"off", type:"conge", label:"Pas d'école"};
}
function specialsOf(j){ return Object.entries(CYCLE[j]||{}).map(([p,s])=>({p:+p, ...SUBJ[s]})).sort((a,b)=>a.p-b.p); }
function nextSchoolDay(k){ for(let x=addDays(k,1), i=0; i<30; x=addDays(x,1), i++) if(CYCLE_OF[x]) return x; return null; }

/* ---------- Météo : prévisions horaires d'Open-Meteo, résumées de 7 h à 18 h ---------- */
const FREEZING = [56,57,66,67];
function codeEmoji(c){ return c===0?"☀️":c<=2?"🌤️":c===3?"☁️":c<=48?"🌫️":c<=57?"🌧️":c<=67?"🌧️":c<=77?"🌨️":c<=82?"🌧️":c<=86?"🌨️":"⛈️"; }
function hr(h){ return h+" h"; }

function summarize(h){
  const days={};
  h.time.forEach((t,i)=>{
    const d=t.slice(0,10), H=+t.slice(11,13);
    if(H<7 || H>18) return;
    (days[d] ??= []).push({
      H, t:h.temperature_2m[i], f:h.apparent_temperature[i],
      p:h.precipitation_probability[i] ?? 0,
      rain:(h.rain[i]||0)+(h.showers[i]||0), snow:h.snowfall[i]||0,
      code:h.weather_code[i] ?? 0, g:h.wind_gusts_10m[i] ?? 0,
    });
  });
  const out={};
  for(const [d,hs] of Object.entries(days)){
    if(hs.length<12 || hs.some(x=>x.t==null)) continue;
    const temps=hs.map(x=>x.t);
    const coldest=hs.reduce((a,b)=>b.f<a.f?b:a);
    // Les précipitations d'une heure H tombent entre H-1 et H : on ignore la valeur de 7 h.
    const pr=hs.filter(x=>x.H>=8);
    const rainMm=pr.reduce((s,x)=>s+x.rain,0), snowCm=pr.reduce((s,x)=>s+x.snow,0);
    const wet=pr.filter(x=>x.p>=40 || x.rain>=0.3 || x.snow>=0.2).map(x=>x.H);
    const freezing=pr.some(x=>FREEZING.includes(x.code));
    let type=null;
    if(wet.length || rainMm>=0.5 || snowCm>=0.3){
      type = freezing ? "verglas" : snowCm>=0.3 && rainMm>=0.5 ? "mixte" : snowCm>=0.3 ? "neige" : "pluie";
    }
    // Code dominant de la journée, pour l'icône quand il ne tombe rien
    const counts={}; hs.forEach(x=>{ const e=codeEmoji(x.code); counts[e]=(counts[e]||0)+1; });
    const sky=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    out[d]={
      tmin:Math.min(...temps), tmax:Math.max(...temps),
      fmin:coldest.f, fminH:coldest.H,
      pmax:Math.max(...pr.map(x=>x.p)), rainMm, snowCm, wet, type,
      gmax:Math.max(...hs.map(x=>x.g)),
      icon: type==="verglas"?"🧊":type==="neige"||type==="mixte"?"🌨️":type==="pluie"?"🌧️":sky,
    };
  }
  return out;
}
function ranges(hours){
  // [9,10,11,15] -> "de 8 h à 11 h et de 14 h à 15 h"
  if(!hours.length) return "";
  if(hours.length>=9) return "toute la journée";
  const groups=[]; let s=hours[0], p=hours[0];
  for(const h of hours.slice(1)){ if(h===p+1){ p=h; continue; } groups.push([s,p]); s=p=h; }
  groups.push([s,p]);
  return groups.map(([a,b])=>`${Math.max(7,a-1)} h–${b} h`).join(", ");
}
function deg(n){ return Math.round(n).toString().replace("-","−")+"°"; }
function habits(w){
  const out=[], lo=w.fmin, hi=w.tmax;
  if(lo<=-12) out.push("Habit de neige, tuque, mitaines et cache-cou");
  else if(hi<=0 || w.type==="neige" || w.type==="mixte") out.push("Habit de neige, bottes, tuque et mitaines");
  else if(lo<=2) out.push(hi>=11 ? "Manteau mi-saison, tuque et mitaines pour le matin" : "Manteau chaud, tuque et mitaines");
  else if(lo<=8) out.push(hi>=16 ? "Manteau mi-saison le matin, une couche de moins l'après-midi" : "Manteau mi-saison");
  else if(hi<=19) out.push("Coton ouaté ou veste légère");
  else out.push(hi>=25 ? "T-shirt, casquette et crème solaire" : "T-shirt et petite veste");
  if(w.type==="pluie" || (w.type==="verglas" && hi>0)) out.push("bottes de pluie et imperméable");
  return out.join(", ");
}
function precipShort(w){
  if(!w.type) return w.pmax>=20 ? "Averse possible" : "Pas de pluie";
  const nom={pluie:"Pluie", neige:"Neige", mixte:"Pluie et neige", verglas:"Verglas"}[w.type];
  return `${nom} ${ranges(w.wet)}`.trim();
}
function wxSub(w){
  const sub=[];
  if(w.fmin<=w.tmin-2) sub.push(`Ressenti ${deg(w.fmin)} à ${hr(w.fminH)}`);
  if(w.type && w.type!=="neige" && w.rainMm>=0.5) sub.push(Math.round(w.rainMm)+" mm");
  if(w.snowCm>=0.3) sub.push((w.snowCm<1?"moins de 1":Math.round(w.snowCm))+" cm de neige");
  if(w.gmax>=50) sub.push(`rafales ${Math.round(w.gmax)} km/h`);
  return cap(sub.join(" · "));
}


export { CYCLE, CYCLE_OF, END, ENFANT, EVENTS, FIRST, FREEZING, JOURS, LAST, LAT, LON, METEO_URL, MOIS, OFF, PERIODES, SAISON, SUBJ, WX_URL, addDays, cap, chargerEnfant, codeEmoji, daysFromToday, deg, habits, hr, infoFor, key, longDate, nextSchoolDay, parse, precipShort, ranges, specialsOf, summarize, todayKey, validerEnfant, wxSub };

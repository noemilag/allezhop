/* Allez Hop : la fiche du jour de l'enfant. Ses données viennent de Firebase après la connexion (voir school.js). */
import { CYCLE, CYCLE_OF, END, ENFANT, EVENTS, FIRST, FREEZING, JOURS, LAST, LAT, LON, METEO_URL, MOIS, OFF, PERIODES, SAISON, SUBJ, WX_URL, addDays, cap, chargerEnfant, codeEmoji, daysFromToday, deg, habits, hr, infoFor, key, longDate, nextSchoolDay, parse, precipShort, ranges, specialsOf, summarize, todayKey, validerEnfant, wxSub } from "./school.js?v=202610272258";


/* ---------- Version : à changer à chaque mise en ligne (voir bump.sh) ---------- */
const VERSION = "202610272258";
// Les téléphones gardent l'app en mémoire : on vérifie s'il existe une version plus récente et on recharge.
// Une fois la page chargée, on retire le ?v=… de l'adresse pour qu'elle reste propre.
if(new URL(location.href).searchParams.has("v")){
  const u=new URL(location.href); u.searchParams.delete("v");
  history.replaceState(null, "", u.pathname+u.search+u.hash);
}
async function checkUpdate(){
  try{
    const r=await fetch("version.json?t="+Date.now(), {cache:"no-store"});
    const {v}=await r.json();
    if(!v || v===VERSION) return;
    try{ if(sessionStorage.getItem("ah.reload")===v) return; sessionStorage.setItem("ah.reload", v); }catch(e){ return; }   // une seule tentative par version
    const u=new URL(location.href);
    u.searchParams.set("v", v);
    location.replace(u.toString());
  }catch(e){ /* hors ligne */ }
}

/* ---------- Météo : prévisions horaires d'Open-Meteo, résumées de 7 h à 18 h ---------- */
let wx = {}, wxTime = 0;
const WX_KEY = "allezhop.meteo.v1";
async function loadWeather(force){
  if(!WX_URL) return;   // position connue seulement après le chargement de l'enfant
  try{
    const c=JSON.parse(localStorage.getItem(WX_KEY)||"null");
    const ici = c && c.url===WX_URL;   // la prévision gardée est-elle pour cette école?
    wx = ici ? c.d : {}; wxTime = ici ? c.t : 0; if(!force) render();
    if(ici && !force && Date.now()-c.t < 30*60e3) return;
  }catch(e){}
  try{
    const r=await fetch(WX_URL);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json();
    wx=summarize(j.hourly); wxTime=Date.now();
    try{ localStorage.setItem(WX_KEY, JSON.stringify({t:wxTime, d:wx, url:WX_URL})); }catch(e){}
    render();
  }catch(e){ /* hors ligne : on garde la dernière prévision ou le conseil de saison */ }
}

/* ---------- Rappels : Firebase si configuré, sinon ce téléphone seulement ---------- */
let reminders=[], store=null, mode="local", userEmail=null;
let kidsAll=[], kidId=null;          // enfants de la famille (triés par date d'ajout) et enfant affiché
const LS_KID="allezhop.enfant";
const LS="allezhop.rappels", LS_ANCIEN="goleo.rappels";   // ancien nom, encore lu pour ne perdre aucun rappel
function lsLoad(){ try{ return JSON.parse(localStorage.getItem(LS)||localStorage.getItem(LS_ANCIEN)||"[]"); }catch(e){ return []; } }
function lsSave(){ try{ localStorage.setItem(LS, JSON.stringify(reminders)); }catch(e){} }

async function initStore(){
  const cfg=window.ALLEZHOP_FIREBASE;
  if(!cfg || !cfg.apiKey){ mode="local"; reminders=lsLoad(); paintAccount(); setAccess("open"); return; }
  mode="loading"; paintAccount(); setAccess("loading");
  try{
    const V="10.12.2", base="https://www.gstatic.com/firebasejs/"+V+"/";
    const [{initializeApp}, A, F] = await Promise.all([import(base+"firebase-app.js"), import(base+"firebase-auth.js"), import(base+"firebase-firestore.js")]);
    const app=initializeApp(cfg), auth=A.getAuth(app);
    let db;
    try{ db=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})}); }
    catch(e){ db=F.getFirestore(app); }
    const coll=F.collection(db,"rappels"), kids=F.collection(db,"enfants");
    let unsub=null, unsubK=null;
    store={
      signIn:(e,p)=>A.signInWithEmailAndPassword(auth,e,p),
      reset:e=>{ auth.languageCode="fr"; return A.sendPasswordResetEmail(auth,e); },
      signOut:()=>A.signOut(auth),
      save:r=>{
        const body={titre:r.titre, date:r.date, notes:r.notes, ic:r.ic, enfant:r.enfant||kidId||null, maj:Date.now(), par:userEmail};
        return r.id ? F.setDoc(F.doc(db,"rappels",r.id), body) : F.addDoc(coll, body);
      },
      del:id=>F.deleteDoc(F.doc(db,"rappels",id)),
      saveKid:d=>F.addDoc(kids, {...d, creeLe:Date.now(), par:userEmail}).then(ref=>{ try{ localStorage.setItem(LS_KID, ref.id); }catch(e){} return ref; }),
    };
    A.onAuthStateChanged(auth, user=>{
      if(unsub){ unsub(); unsub=null; }
      if(unsubK){ unsubK(); unsubK=null; }
      userEmail=user?user.email:null;
      mode=user?"shared":"signedout";
      reminders=[];
      if(user){
        setAccess("loading");
        let haveKid=false, haveRem=false;
        const ready=()=>{
          if(!haveKid || !haveRem) return;
          if(access!=="open"){ setAccess("open"); importLocal(); loadWeather(false); } else render();
        };
        const fail=err=>{
          if(err.code==="permission-denied") setAccess("locked", `Le compte ${userEmail} n'a pas accès à cette famille.`, "Me déconnecter");
          else setAccess("locked", "L'horaire ne se charge pas. Vérifie ta connexion internet.", "Réessayer");
        };
        // Fiche de l'enfant (prénom, classe, calendrier, horaire) : seulement pour les membres de la famille
        unsubK=F.onSnapshot(kids, snap=>{
          kidsAll=snap.docs.map(d=>({id:d.id, ...d.data()})).sort((x,y)=>(x.creeLe||0)-(y.creeLe||0));
          if(!kidsAll.length){ haveKid=false; setAccess("setup"); return; }
          let want=null; try{ want=localStorage.getItem(LS_KID); }catch(e){}
          const k=kidsAll.find(x=>x.id===want) || kidsAll.find(x=>x.id===kidId) || kidsAll[0];
          const changed=k.id!==kidId; kidId=k.id; chargerEnfant(k);
          paintKids();
          if(haveKid && changed && access==="open"){ current=null; loadWeather(false); }
          haveKid=true; ready();
        }, fail);
        unsub=F.onSnapshot(coll, snap=>{
          reminders=snap.docs.map(d=>({id:d.id, ...d.data()}));
          haveRem=true; ready();
        }, fail);
      } else setAccess("locked");
      paintAccount();
    });
  }catch(e){
    setAccess("locked", "L'app ne se charge pas. Vérifie ta connexion internet.", "Réessayer");
  }
}
// Première connexion sur un téléphone : les rappels gardés sur ce téléphone deviennent partagés.
// Ils restent aussi dans la mémoire du téléphone, en copie de sécurité.
const LS_DONE="allezhop.rappels.importes";
async function importLocal(){
  let local=[]; try{ if(localStorage.getItem(LS_DONE)) return; local=lsLoad(); }catch(e){ return; }
  const known=new Set(reminders.map(r=>r.date+"|"+r.titre));
  const todo=local.filter(r=>r && r.titre && r.date && !known.has(r.date+"|"+r.titre));
  try{
    await Promise.all(todo.map(r=>store.save({titre:r.titre, date:r.date, notes:r.notes||"", ic:r.ic||r.em||"pin"})));
    localStorage.setItem(LS_DONE, new Date().toISOString());
    if(todo.length) toast(todo.length+(todo.length>1?" rappels de ce téléphone sont maintenant partagés":" rappel de ce téléphone est maintenant partagé"));
  }catch(e){ /* on réessaiera à la prochaine ouverture */ }
}
async function saveReminder(r){
  if(mode==="shared"){
    // Firestore applique le changement tout de suite sur le téléphone, puis le synchronise.
    store.save(r).catch(()=>toast("Le rappel n'a pas pu être partagé. Réessaie."));
    return;
  }
  if(r.id) reminders=reminders.map(x=>x.id===r.id?r:x); else { r.id="r"+Date.now(); reminders.push(r); }
  lsSave(); render();
}
async function deleteReminder(id){
  if(mode==="shared"){ store.del(id).catch(()=>toast("La suppression n'a pas pu être partagée. Réessaie.")); return; }
  reminders=reminders.filter(x=>x.id!==id); lsSave(); render();
}
// Rappels de l'enfant affiché. Les anciens rappels (sans enfant) appartiennent au premier enfant ajouté.
function mine(){ return reminders.filter(r=> r.enfant ? r.enfant===kidId : (!kidsAll.length || kidId===kidsAll[0].id)); }
function remindersOn(k){ return mine().filter(r=>r.date===k).sort((a,b)=>(a.titre||"").localeCompare(b.titre||"")); }

/* ---------- Compte ---------- */
const $=id=>document.getElementById(id);
// btn : texte du bouton (« Me connecter » ouvre la connexion, « Réessayer » recharge l'app), ou rien
function showBanner(txt, btn){ $("banner-txt").textContent=txt; $("banner-btn").textContent=btn||""; $("banner-btn").hidden=!btn; $("banner-wrap").hidden=false; }
function choisirEnfant(id){
  const k=kidsAll.find(x=>x.id===id); if(!k || id===kidId) return;
  try{ localStorage.setItem(LS_KID, id); }catch(e){}
  kidId=id; chargerEnfant(k); current=null;
  $("kid-name").textContent=ENFANT.prenom; $("kid-class").textContent="Classe "+ENFANT.classe;
  paintKids(); render(); loadWeather(false);
  toast("Horaire de "+ENFANT.prenom);
}
function paintKids(){
  $("kids-count").textContent=pad2(kidsAll.length);
  $("kids-list").innerHTML=kidsAll.map(k=>`<button type="button" class="kid-row${k.id===kidId?" on":""}" data-kid="${esc(k.id)}">
    <span class="av" aria-hidden="true">${esc((k.prenom||"?").charAt(0).toUpperCase())}</span>
    <span class="tx"><b>${esc(k.prenom||"")}</b><span>${esc([k.classe?"Classe "+k.classe:"", k.ecole||""].filter(Boolean).join(" · "))}</span></span>
    ${k.id===kidId?`<span class="chk">Affiché</span>`:""}</button>`).join("");
  document.querySelector(".kid").classList.toggle("multi", kidsAll.length>1);
}
$("kids-list").addEventListener("click", e=>{ const b=e.target.closest("[data-kid]"); if(b){ choisirEnfant(b.dataset.kid); $("compte").hidden=true; } });
$("kid-add").addEventListener("click", ()=>{ $("kid-add-panel").hidden=!$("kid-add-panel").hidden; $("kid-err").hidden=true; });
$("kid-pick").addEventListener("click", ()=>$("kid-file").click());
$("kid-file").addEventListener("change", async e=>{ const f=e.target.files[0]; if(f) enregistrerEnfant(await f.text(), "kid-err"); e.target.value=""; });
$("kid-paste").addEventListener("click", ()=>enregistrerEnfant($("kid-text").value, "kid-err"));
// Toucher le prénom en haut : ouvre le profil pour changer d'enfant
document.querySelector(".kid").addEventListener("click", ()=>{ if(access==="open"){ $("compte").hidden=false; } });
function paintAccount(){
  $("c-off").hidden = mode!=="local";
  $("c-out").hidden = mode!=="signedout";
  $("c-in").hidden = mode!=="shared";
  $("c-email").textContent = userEmail||"";
  $("c-title").textContent = mode==="shared" ? "Profil" : "Connexion";
  $("compte-badge").hidden = mode!=="signedout";
  $("banner-wrap").hidden=true;
}
$("btn-compte").addEventListener("click", ()=>{ $("l-err").hidden=true; $("compte").hidden=false; });
$("banner-btn").addEventListener("click", e=>{
  if(e.currentTarget.textContent==="Réessayer"){ location.reload(); return; }
  $("l-err").hidden=true; $("compte").hidden=false;
});
$("c-close").addEventListener("click", ()=>$("compte").hidden=true);
$("compte").addEventListener("click", e=>{ if(e.target===$("compte")) $("compte").hidden=true; });
$("login").addEventListener("submit", async e=>{
  e.preventDefault();
  if(mode!=="signedout") return;
  const em=$("l-email").value.trim().toLowerCase(), pw=$("l-pass").value;
  if(!em || !pw){ $("l-err").textContent="Entre ton courriel et ton mot de passe."; $("l-err").hidden=false; return; }
  $("l-go").disabled=true;
  try{ await store.signIn(em,pw); $("l-pass").value=""; $("compte").hidden=true; toast("Connecté. Les rappels sont partagés."); }
  catch(err){
    $("l-err").textContent = authMessage(err);
    $("l-err").hidden=false;
  }finally{ $("l-go").disabled=false; }
});
function authMessage(err){
  const c=(err && err.code)||"";
  const m={
    "auth/invalid-credential":"Courriel ou mot de passe incorrect. Vérifie les majuscules, ou touche « Mot de passe oublié? ».",
    "auth/wrong-password":"Mot de passe incorrect. Vérifie les majuscules, ou touche « Mot de passe oublié? ».",
    "auth/user-not-found":"Aucun compte avec ce courriel. Vérifie l'adresse.",
    "auth/invalid-email":"Ce courriel n'est pas valide. Vérifie l'adresse.",
    "auth/missing-password":"Entre ton mot de passe.",
    "auth/too-many-requests":"Trop d'essais. Attends quelques minutes, ou touche « Mot de passe oublié? ».",
    "auth/user-disabled":"Ce compte est désactivé dans Firebase.",
    "auth/operation-not-allowed":"La connexion par courriel n'est pas activée dans Firebase (Authentication → Mode de connexion).",
    "auth/network-request-failed":"Pas de connexion internet. Réessaie dans un instant.",
  }[c];
  return (m || "La connexion n'a pas fonctionné.") + (c ? " (code : "+c.replace("auth/","")+")" : "");
}
$("l-reset").addEventListener("click", async ()=>{
  const em=$("l-email").value.trim(), info=$("l-info");
  $("l-err").hidden=true;
  if(!em){ $("l-err").textContent="Écris d'abord ton courriel, puis touche « Mot de passe oublié? »."; $("l-err").hidden=false; return; }
  if(mode!=="signedout" || !store){ return; }
  try{ await store.reset(em); info.textContent="Courriel envoyé à "+em+". Ouvre le lien pour choisir un nouveau mot de passe (regarde aussi dans les courriels indésirables)."; info.hidden=false; }
  catch(err){ $("l-err").textContent=authMessage(err); $("l-err").hidden=false; }
});
$("c-logout").addEventListener("click", async ()=>{ await store.signOut(); $("compte").hidden=true; });

/* ---------- Icônes (au trait, d'après Lucide, licence ISC) ---------- */
const CLOUD='<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>';
const ICONS={
  pin:'<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  party:'<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  bus:'<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  shirt:'<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  money:'<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  apple:'<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>',
  palette:'<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  ball:'<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93c3.9 3.9 3.9 10.24 0 14.14"/><path d="M19.07 4.93c-3.9 3.9-3.9 10.24 0 14.14"/>',
  pencil:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  cake:'<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>',
  waves:'<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  ticket:'<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  chat:'<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  book:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  laptop:'<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  backpack:'<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  upright:'<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  cloudSun:'<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  fog:CLOUD+'<path d="M16 17H7"/><path d="M17 21H9"/>',
  rain:CLOUD+'<path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  snow:CLOUD+'<path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>',
  hail:CLOUD+'<path d="M16 14v2"/><path d="M8 14v2"/><path d="M16 20h.01"/><path d="M8 20h.01"/><path d="M12 16v2"/><path d="M12 22h.01"/>',
  storm:'<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
};
// Anciennes valeurs (émojis) -> icônes : événements, rappels déjà enregistrés, météo en cache
const EMOJI_IC={"📌":"pin","🎉":"party","🚌":"bus","👕":"shirt","💰":"money","🍎":"apple","🎨":"palette","⚽":"ball","📝":"pencil","🎂":"cake","🏊":"waves","🎭":"ticket",
  "🔔":"bell","📸":"camera","✉️":"mail","🏁":"flag","📄":"file","⚠️":"alert",
  "☀️":"sun","🌤️":"cloudSun","☁️":"cloud","🌫️":"fog","🌧️":"rain","🌨️":"snow","⛈️":"storm","🧊":"hail",
  "🧤":"snow","🥾":"snow","🧥":"cloudSun","🧢":"sun","🧣":"cloud"};
const PICK=["pin","party","bus","shirt","money","apple","palette","ball","pencil","cake","waves","ticket"];
function icOf(x){ return ICONS[x] ? x : (EMOJI_IC[x] || "pin"); }
function icon(n){ return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[icOf(n)]}</svg>`; }

/* ---------- Météo : affichage ---------- */
function weatherHTML(k){
  const w=wx[k];
  if(w){
    const sub=wxSub(w);
    return `<a class="wx" href="${METEO_URL}" target="_blank" rel="noopener" draggable="false" aria-label="Météo de 7 h 30 à 18 h">`+
      `<div class="wx-a">${icon(w.icon)}<span class="wx-t">${deg(w.tmin)}<i>→</i>${deg(w.tmax)}</span><span class="wx-p">${esc(precipShort(w))}</span></div>`+
      (sub?`<div class="wx-sub">${esc(sub)}</div>`:"")+
      `<div class="wx-c">${icon("shirt")}<span>${esc(habits(w))}</span></div></a>`;
  }
  if(infoFor(k).kind!=="ecole" && daysFromToday(k)>1) return "";
  const [e,txt]=SAISON[parse(k).getMonth()];
  return `<a class="wx" href="${METEO_URL}" target="_blank" rel="noopener" draggable="false">`+
    `<div class="wx-a">${icon(e)}<span class="wx-p" style="margin-left:0;text-align:left">Habituellement en ${MOIS[parse(k).getMonth()]}</span></div>`+
    `<div class="wx-c">${icon("shirt")}<span>${esc(txt)}</span></div></a>`;
}

/* ---------- Carte du jour ---------- */
function esc(s){ const d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }
function pad2(n){ return String(n).padStart(2,"0"); }

function buildDays(){
  const t=todayKey(), remDates=new Set(mine().map(r=>r.date));
  let last=END; mine().forEach(r=>{ if(r.date>last) last=r.date; });
  const list=[];
  for(let k=t; k<=last; k=addDays(k,1)){
    const w=parse(k).getDay();
    if((w===0||w===6) && k!==t && !remDates.has(k)) continue;
    list.push(k);
  }
  return list;
}
function eyebrowFor(k){
  const diff=daysFromToday(k);
  if(diff===0) return "Aujourd'hui";
  if(diff===1) return "Demain";
  return diff<7 ? "Dans "+diff+" jours" : "Dans "+Math.round(diff/7)+" sem.";
}
const MOIS_COURT=["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
function cardHTML(k){
  const inf=infoFor(k), school=inf.kind==="ecole", d=parse(k);
  let h=`<div class="row-top"><span class="when">${eyebrowFor(k)}</span></div>`;
  // À gauche : le jour du cycle ; à droite : la date, comme une page de calendrier
  h+= school
    ? `<div class="hero"><div class="cyc" aria-label="Jour ${inf.jour} du cycle"><div class="dname">Jour</div><div class="dnum">${inf.jour}</div></div>`
    : `<div class="hero"><div class="cyc off"><div class="dnum">Congé</div><div class="dmonth">${esc(inf.label)}</div></div>`;
  h+=`<div class="tile" aria-label="${esc(cap(longDate(k)))} ${d.getFullYear()}"><small>${JOURS[d.getDay()]}</small><b>${d.getDate()}</b><span>${MOIS_COURT[d.getMonth()]} ${d.getFullYear()}</span></div>`;
  h+=`</div>`;

  if(school){
    const sp=specialsOf(inf.jour);
    h+=`<div class="sec"><div class="sec-h"><span>À l'école</span><span>${pad2(sp.length)}</span></div>`;
    h+= sp.length
      ? sp.map(s=>`<div class="line"><span class="ic">${icon(s.ic)}</span><div class="tx"><b>${esc(s.nom)}</b>${s.apporter?`<span>${icon("backpack")}${esc(s.apporter)}</span>`:""}</div><time>${PERIODES[s.p]}</time></div>`).join("")
      : `<div class="offtxt">Aucun spécialiste</div>`;
    h+=`</div>`;
  }

  const items=[];
  (EVENTS[k]||[]).forEach(([e,t,n])=>items.push({ic:e, t, n}));
  remindersOn(k).forEach(r=>items.push({ic:r.ic||r.em, t:r.titre, n:r.notes, id:r.id}));
  if(items.length){
    h+=`<div class="sec"><div class="sec-h"><span>À ne pas oublier</span><span>${pad2(items.length)}</span></div>`;
    items.forEach(it=>{
      const inner=`<span class="ic">${icon(it.ic)}</span><div class="tx"><b>${esc(it.t)}</b>${it.n?`<span class="note">${esc(it.n)}</span>`:""}</div>`;
      h+= it.id ? `<button class="line" data-edit="${esc(it.id)}" aria-label="Modifier : ${esc(it.t)}">${inner}</button>` : `<div class="line">${inner}</div>`;
    });
    h+=`</div>`;
  }

  h+=weatherHTML(k);

  const nx=nextSchoolDay(k);
  if(nx && days.includes(nx)){
    const sp=specialsOf(CYCLE_OF[nx]), rem=remindersOn(nx);
    let txt = sp.length===1 ? `${sp[0].court} à ${PERIODES[sp[0].p]}` : sp.length ? sp.map(s=>s.court).join(", ") : "Pas de spécialiste";
    txt = `J${CYCLE_OF[nx]} · ${txt}` + (rem.length ? ` · ${rem[0].titre}` : "");
    const lab = nx===addDays(k,1) ? "Demain" : cap(JOURS[parse(nx).getDay()]);
    h+=`<button class="foot" data-go="${nx}"><small>${lab}</small><span>${esc(txt)}</span>${icon("upright")}</button>`;
  }
  return h;
}

/* ---------- Pile de cartes et navigation ---------- */
const card=$("card"), stack=$("stack"), peek=$("peek");
const BACK="translateY(10px) scale(.95)";
let days=[], idx=0, current=null, busy=false;
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE="cubic-bezier(.2,.8,.2,1)";

// Accès à l'horaire : rien n'est affiché tant que la personne n'est pas connectée et autorisée.
let access="loading";
const GATE_TXT=$("gate-msg").textContent;
const GATE_TITLE=$("gate-title").innerHTML;
function setAccess(state, msg, alt){
  access=state;
  const h=document.documentElement;
  h.classList.remove("st-loading","st-locked","st-open","st-setup"); h.classList.add("st-"+(state==="setup"?"locked":state));
  h.classList.toggle("st-setup", state==="setup");
  $("gate-title").innerHTML = state==="setup" ? "Presque prêt!" : GATE_TITLE;
  $("setup").hidden = state!=="setup";
  if(state==="setup"){ msg = "Il reste à ajouter l'horaire de votre enfant. Choisissez le fichier de données qu'on vous a remis."; alt = "Me déconnecter"; }
  const showKid = state==="open";
  $("kid-name").textContent = showKid ? ENFANT.prenom : "";
  $("kid-class").textContent = showKid ? "Classe "+ENFANT.classe : "";
  $("gate-msg").textContent = msg || GATE_TXT;
  $("gate-login").hidden = !!alt || state==="setup";
  $("gate-alt").hidden = !alt; $("gate-alt").textContent = alt || "";
  if(state!=="open"){ card.innerHTML=""; peek.innerHTML=""; scrim.hidden=true; info.hidden=true; }
  else render();
}
// Première configuration : la fiche de l'enfant (fichier JSON remis à part) est enregistrée dans Firebase.
async function enregistrerEnfant(txt, errId="setup-err"){
  const err=$(errId); err.hidden=true;
  let d; try{ d=JSON.parse(txt); }catch(e){ err.textContent="Ce fichier n'est pas lisible. Vérifie que c'est bien le fichier de données (.json)."; err.hidden=false; return; }
  const pb=validerEnfant(d); if(pb){ err.textContent=pb; err.hidden=false; return; }
  try{ await store.saveKid(d); toast("Horaire de "+d.prenom+" ajouté"); $("kid-add-panel").hidden=true; $("compte").hidden=true; }
  catch(e){ err.textContent = e.code==="permission-denied" ? "Firebase refuse l'enregistrement : vérifie les règles de sécurité (collection enfants)." : "L'enregistrement n'a pas fonctionné. Réessaie."; err.hidden=false; }
}
$("setup-pick").addEventListener("click", ()=>$("setup-file").click());
$("setup-file").addEventListener("change", async e=>{ const f=e.target.files[0]; if(f) enregistrerEnfant(await f.text()); e.target.value=""; });
$("setup-paste").addEventListener("click", ()=>enregistrerEnfant($("setup-text").value));
$("gate-login").addEventListener("click", ()=>{ $("l-err").hidden=true; $("compte").hidden=false; });
$("gate-alt").addEventListener("click", async e=>{
  if(e.currentTarget.textContent==="Me déconnecter" && store){ await store.signOut(); return; }
  location.reload();
});
function render(){
  if(access!=="open") return;
  days=buildDays();
  idx=Math.max(0, current ? days.indexOf(current) : 0);
  current=days[idx];
  paint();
}
function paint(){
  card.className="card"+(infoFor(current).kind==="ecole"?"":" off");
  card.innerHTML=cardHTML(current);
  card.setAttribute("aria-label", cap(longDate(current)));
  fit(card); chrome();
  // La carte suivante, visible derrière pendant qu'on glisse
  const nk=days[idx+1];
  peek.className="card back b1"+(nk && infoFor(nk).kind!=="ecole"?" off":"");
  peek.innerHTML=nk ? cardHTML(nk) : "";
  fit(peek);
}
function fit(el){
  const over=()=>el.scrollHeight>el.clientHeight+1;
  el.classList.remove("tight","tighter","tightest","mini","micro");
  for(const c of ["tight","tighter","tightest","mini","micro"]){ if(!over()) break; el.classList.add(c); }
}
function chrome(){
  $("btn-today").hidden = idx===0;
}
// dir : sens du geste {x,y} (-1, 0 ou 1). Vers la gauche ou le haut = jour suivant.
function go(delta, dir){
  const ni=idx+delta;
  if(busy || !delta || ni<0 || ni>=days.length){ snap(); return; }
  const from=card.style.transform||"none";
  if(reduceMotion){ idx=ni; current=days[ni]; card.style.transform=""; paint(); return; }
  busy=true; setTimeout(()=>busy=false, 450);
  const old=card.cloneNode(true);
  old.removeAttribute("id"); old.removeAttribute("aria-live"); old.classList.add("leaving"); old.setAttribute("aria-hidden","true");
  idx=ni; current=days[ni]; card.style.transform=""; paint();
  const d=dir || (delta>0 ? {x:-1,y:0} : {x:1,y:0});
  if(delta>0){
    // La carte du jour s'envole, la suivante avance depuis la pile.
    stack.appendChild(old);
    old.animate([{transform:from,opacity:1},{transform:`translate(${d.x*120}%,${d.y*120}%) rotate(${d.x*10}deg)`,opacity:0}],{duration:320,easing:EASE}).onfinish=()=>{ old.remove(); busy=false; };
    card.animate([{transform:BACK},{transform:"none"}],{duration:320,easing:EASE});
  } else {
    // La carte retourne dans la pile, la précédente revient du côté du geste.
    stack.insertBefore(old, card);
    old.style.transformOrigin="50% 100%";
    old.animate([{transform:from},{transform:BACK}],{duration:320,easing:EASE}).onfinish=()=>{ old.remove(); busy=false; };
    card.animate([{transform:`translate(${-d.x*110}%,${-d.y*110}%) rotate(${-d.x*8}deg)`},{transform:"none"}],{duration:320,easing:EASE});
  }
}
function goKey(k){ const i=days.indexOf(k); if(i>=0) go(i-idx); }
function snap(){
  const from=card.style.transform; card.style.transform="";
  if(from && from!=="none" && !reduceMotion) card.animate([{transform:from},{transform:"none"}],{duration:260,easing:EASE});
}

let drag=null, dragged=false;
card.addEventListener("pointerdown", e=>{
  if(busy || (e.pointerType==="mouse" && e.button!==0)) return;
  drag={x:e.clientX, y:e.clientY, t:performance.now(), id:e.pointerId, on:false, dx:0, dy:0};
  dragged=false;
});
card.addEventListener("pointermove", e=>{
  if(!drag || e.pointerId!==drag.id) return;
  const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
  if(!drag.on){
    if(Math.hypot(dx,dy)<8) return;
    drag.on=true; dragged=true; card.setPointerCapture(e.pointerId);
  }
  drag.dx=dx; drag.dy=dy;
  const atStart=idx===0 && (dx>0 && Math.abs(dx)>=Math.abs(dy) || dy>0 && Math.abs(dy)>Math.abs(dx));
  const k=atStart ? .35 : 1;   // résistance quand il n'y a pas de jour précédent
  card.style.transform=`translate(${dx*k}px,${dy*k}px) rotate(${dx*k*.04}deg)`;
});
function endDrag(e){
  if(!drag || e.pointerId!==drag.id) return;
  const d=drag; drag=null;
  if(!d.on) return;
  const horiz=Math.abs(d.dx)>=Math.abs(d.dy), dist=horiz?Math.abs(d.dx):Math.abs(d.dy);
  const speed=dist/Math.max(1,performance.now()-d.t);
  if(dist>80 || (speed>.5 && dist>30)){
    const s=Math.sign(horiz?d.dx:d.dy);
    go(s<0 ? 1 : -1, horiz ? {x:s,y:0} : {x:0,y:s});
  } else snap();
}
card.addEventListener("pointerup", endDrag);
card.addEventListener("pointercancel", endDrag);
card.addEventListener("dragstart", e=>e.preventDefault());
card.addEventListener("click", e=>{
  if(dragged){ e.preventDefault(); e.stopPropagation(); dragged=false; }
}, true);
card.addEventListener("click", e=>{
  const ed=e.target.closest("[data-edit]"); if(ed){ const r=reminders.find(x=>x.id===ed.dataset.edit); if(r) openSheet(r); return; }
  const g=e.target.closest("[data-go]"); if(g) goKey(g.dataset.go);
});
$("btn-today").addEventListener("click", ()=>go(-idx));
document.addEventListener("keydown", e=>{
  if(!scrim.hidden || !info.hidden || !$("compte").hidden) return;
  if(e.key==="ArrowRight"||e.key==="ArrowDown"||e.key==="PageDown"){ e.preventDefault(); go(1, e.key==="ArrowRight"?{x:-1,y:0}:{x:0,y:-1}); }
  if(e.key==="ArrowLeft"||e.key==="ArrowUp"||e.key==="PageUp"){ e.preventDefault(); go(-1, e.key==="ArrowLeft"?{x:1,y:0}:{x:0,y:1}); }
});
window.addEventListener("resize", ()=>{ fit(card); fit(peek); });
// Au retour dans l'app (le lendemain matin, par exemple) : nouvelle journée et météo fraîche
let lastDay=todayKey();
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState!=="visible") return;
  if(todayKey()!==lastDay){ lastDay=todayKey(); current=null; render(); }
  loadWeather(false);
  checkUpdate();
});

/* ---------- Ajout d'un rappel ---------- */
const scrim=$("scrim"), form=$("sheet");
const fT=$("f-titre"), fN=$("f-notes"), fH=$("f-hint"), fE=$("f-err"), fDel=$("f-del");
let editing=null, ic="pin", armed=false, selDate=null, calMonth=null;

$("icons").innerHTML=PICK.map(x=>`<button type="button" data-ic="${x}" aria-label="Icône ${x}">${icon(x)}</button>`).join("");
$("icons").addEventListener("click", e=>{ const b=e.target.closest("[data-ic]"); if(b){ ic=b.dataset.ic; paintIc(); } });
function paintIc(){ document.querySelectorAll("#icons button").forEach(b=>b.classList.toggle("on", b.dataset.ic===ic)); }

function quickDates(){
  const t=todayKey(), out=[["Demain", addDays(t,1)]];
  let x=addDays(t,1), n=0;
  while(n<3){ x=nextSchoolDay(x); if(!x) break; out.push([cap(JOURS[parse(x).getDay()].slice(0,3))+" "+parse(x).getDate(), x]); n++; }
  out.push(["Dans 1 sem.", addDays(t,7)]);
  return out;
}
function paintQuick(){ $("quick").innerHTML=quickDates().map(([l,k])=>`<button type="button" data-q="${k}" class="${selDate===k?"on":""}">${l}</button>`).join(""); }
$("quick").addEventListener("click", e=>{ const b=e.target.closest("[data-q]"); if(b) pick(b.dataset.q); });

const minMonth=()=>todayKey().slice(0,7), maxMonth="2027-08";
function shiftMonth(ym,n){ const [y,m]=ym.split("-").map(Number); const d=new Date(y,m-1+n,1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function paintCal(){
  const [y,m]=calMonth.split("-").map(Number);
  $("cal-title").textContent=MOIS[m-1]+" "+y;
  $("cal-prev").disabled = calMonth<=minMonth();
  $("cal-next").disabled = calMonth>=maxMonth;
  const t=todayKey(), remDates=new Set(mine().map(r=>r.date));
  let h=["L","M","M","J","V","S","D"].map(d=>`<span class="wd">${d}</span>`).join("");
  const first=new Date(y,m-1,1), lead=(first.getDay()+6)%7, dim=new Date(y,m,0).getDate();
  for(let i=0;i<lead;i++) h+=`<span></span>`;
  for(let d=1; d<=dim; d++){
    const k=key(new Date(y,m-1,d)), inf=infoFor(k), cls=[];
    if(inf.kind==="weekend") cls.push("we"); if(inf.kind==="off") cls.push("offd");
    if(k<t) cls.push("past"); if(k===t) cls.push("today"); if(k===selDate) cls.push("sel");
    const sub = inf.kind==="ecole" ? "J"+inf.jour : inf.kind==="off" ? "congé" : "";
    h+=`<button type="button" class="${cls.join(" ")}" data-d="${k}" ${k<t?"disabled":""} aria-label="${esc(longDate(k))}${sub?", "+sub:""}">${remDates.has(k)?'<span class="dot"></span>':""}<b>${d}</b><i>${sub||"&nbsp;"}</i></button>`;
  }
  $("cal-grid").innerHTML=h;
}
$("cal-grid").addEventListener("click", e=>{ const b=e.target.closest("[data-d]"); if(b && !b.disabled) pick(b.dataset.d); });
$("cal-prev").addEventListener("click", ()=>{ calMonth=shiftMonth(calMonth,-1); paintCal(); });
$("cal-next").addEventListener("click", ()=>{ calMonth=shiftMonth(calMonth,1); paintCal(); });
function pick(k){
  selDate=k; calMonth=k.slice(0,7); paintCal(); paintQuick();
  const inf=infoFor(k);
  fH.textContent=cap(longDate(k))+" · "+(inf.kind==="ecole"?"Jour "+inf.jour:inf.label);
}

function openSheet(r){
  if(mode==="signedout"){ $("compte").hidden=false; return; }
  editing=r?r.id:null; armed=false;
  $("sheet-title").textContent=r?"Modifier le rappel":"Nouveau rappel";
  fT.value=r?r.titre:""; fN.value=r?(r.notes||""):""; ic=r?icOf(r.ic||r.em):"pin";
  const t=todayKey();
  pick(r ? r.date : (current && current>t ? current : addDays(t,1)));
  fDel.hidden=!r; fDel.classList.remove("armed"); fDel.textContent="Supprimer";
  fE.hidden=true; paintIc();
  scrim.hidden=false;
}
function closeSheet(){ scrim.hidden=true; }
$("fab").addEventListener("click", ()=>{ openSheet(null); if(!scrim.hidden) setTimeout(()=>fT.focus(),50); });
$("f-cancel").addEventListener("click", closeSheet);
scrim.addEventListener("click", e=>{ if(e.target===scrim) closeSheet(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ closeSheet(); info.hidden=true; $("compte").hidden=true; } });

form.addEventListener("submit", async e=>{
  e.preventDefault();
  const titre=fT.value.trim();
  if(!titre){ fE.textContent="Écris le nom de l'activité."; fE.hidden=false; fT.focus(); return; }
  if(!selDate){ fE.textContent="Choisis une date dans le calendrier."; fE.hidden=false; return; }
  await saveReminder({id:editing, titre, date:selDate, notes:fN.value.trim(), ic});
  closeSheet(); current=selDate; render();
  toast("Rappel ajouté pour "+longDate(selDate));
});
fDel.addEventListener("click", async ()=>{
  if(!armed){ armed=true; fDel.classList.add("armed"); fDel.textContent="Confirmer"; return; }
  await deleteReminder(editing); closeSheet(); toast("Rappel supprimé");
});

let tt;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,2600); }

/* ---------- Notification push du matin ---------- */
// Clé publique VAPID ; la clé privée est un secret GitHub (VAPID_PRIVATE_KEY).
const VAPID_PUBLIC="";   // à remplir : clé publique créée avec outils/cles.html
const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const installed = navigator.standalone===true || matchMedia("(display-mode: standalone)").matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
let swReg=null;
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r=>{ swReg=r; }).catch(()=>{});

function b64ToBytes(b64){ const s=atob((b64+"=".repeat((4-b64.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(s,c=>c.charCodeAt(0)); }
async function getReg(){ return swReg || (await navigator.serviceWorker.ready); }
async function paintPush(){
  const st=$("push-state"), act=$("push-actions"), wrap=$("push-code-wrap");
  act.innerHTML=""; wrap.hidden=true;
  if(isIOS && !installed){ st.textContent="Sur iPhone, les notifications marchent seulement depuis l'écran d'accueil : Partager → Sur l'écran d'accueil, puis ouvre Allez Hop avec son icône."; return; }
  if(!pushOK){ st.textContent="Ce navigateur ne reçoit pas les notifications push."; return; }
  if(!VAPID_PUBLIC){ st.textContent="Les notifications du matin sont presque prêtes : il reste à installer les clés (voir le README)."; return; }
  if(Notification.permission==="denied"){ st.textContent="Les notifications sont bloquées. Va dans Réglages → Notifications → Allez Hop pour les autoriser."; return; }
  const sub = await (await getReg()).pushManager.getSubscription();
  if(!sub){
    st.textContent="";
    act.innerHTML=`<button type="button" class="btn primary" id="push-on">Activer les notifications</button>`;
    $("push-on").addEventListener("click", enablePush);
    return;
  }
  st.textContent="Activées sur ce téléphone.";
  act.innerHTML=`<button type="button" class="btn primary" id="push-test">Envoyer un test</button><button type="button" class="btn ghost" id="push-off">Désactiver</button>`;
  $("push-test").addEventListener("click", async ()=>{
    const inf=infoFor(todayKey()), sp=inf.kind==="ecole"?specialsOf(inf.jour):[];
    await (await getReg()).showNotification(inf.kind==="ecole"?`${ENFANT.prenom} · Jour ${inf.jour}`:`${ENFANT.prenom} · Pas d'école`, {
      body: sp.length ? sp.map(s=>`${s.nom} ${PERIODES[s.p]}`).join(" · ") : (inf.label||"Aucun spécialiste aujourd'hui"),
      icon:"icons/icon-192.png", tag:"test" });
  });
  $("push-off").addEventListener("click", async ()=>{ await sub.unsubscribe(); toast("Notifications désactivées"); paintPush(); });
  $("push-code").value=JSON.stringify(sub.toJSON());
  wrap.hidden=false;
}
async function enablePush(){
  const st=$("push-state");
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){ paintPush(); return; }
    const reg=await getReg();
    await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToBytes(VAPID_PUBLIC)});
    toast("Notifications activées");
  }catch(e){ st.textContent="L'activation n'a pas fonctionné. Ferme l'app, rouvre-la et réessaie."; return; }
  paintPush();
}
$("push-copy").addEventListener("click", async ()=>{
  const t=$("push-code");
  try{ await navigator.clipboard.writeText(t.value); toast("Code copié"); }
  catch(e){ t.focus(); t.select(); toast("Sélectionne le code et copie-le"); }
});

/* ---------- Calendrier (.ics) ---------- */
const info=$("info");
$("btn-info").addEventListener("click", ()=>{ $("ics-msg").textContent=""; info.hidden=false; paintPush(); });
$("info-close").addEventListener("click", ()=>info.hidden=true);
info.addEventListener("click", e=>{ if(e.target===info) info.hidden=true; });
function icsEsc(s){ return String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n"); }
function fold(line){ const out=[]; while(line.length>70){ out.push(line.slice(0,70)); line=" "+line.slice(70); } out.push(line); return out.join("\r\n"); }
function buildICS(){
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Allez Hop//FR","CALSCALE:GREGORIAN","X-WR-CALNAME:Allez Hop · "+ENFANT.prenom];
  const start=todayKey()>FIRST?todayKey():FIRST;
  for(let k=start; k<=LAST; k=addDays(k,1)){
    const inf=infoFor(k); if(inf.kind!=="ecole") continue;
    const ymd=k.replace(/-/g,""), sp=specialsOf(inf.jour), rem=remindersOn(k);
    let sum=ENFANT.prenom+" · J"+inf.jour+(sp.length?" · "+sp.map(s=>s.court+" "+s.em).join(", "):"");
    if(rem.length) sum+=" · "+rem.map(r=>r.titre).join(", ");
    const desc=[];
    sp.filter(s=>s.apporter).forEach(s=>desc.push("À apporter : "+s.apporter));
    (EVENTS[k]||[]).forEach(e=>desc.push(e[0]+" "+e[1]));
    rem.forEach(r=>desc.push("📌 "+r.titre+(r.notes?" : "+r.notes:"")));
    L.push("BEGIN:VEVENT","UID:allezhop-"+ymd+"@allezhop","DTSTAMP:"+stamp,"DTSTART:"+ymd+"T070000","DTEND:"+ymd+"T071000",
      fold("SUMMARY:"+icsEsc(sum)),fold("DESCRIPTION:"+icsEsc(desc.join("\n"))),
      "BEGIN:VALARM","ACTION:DISPLAY",fold("DESCRIPTION:"+icsEsc(sum)),"TRIGGER:PT0M","END:VALARM","END:VEVENT");
  }
  mine().filter(r=>r.date>=todayKey()).forEach(r=>{
    const ymd=r.date.replace(/-/g,""), nxt=addDays(r.date,1).replace(/-/g,"");
    L.push("BEGIN:VEVENT","UID:allezhop-rappel-"+r.id+"@allezhop","DTSTAMP:"+stamp,"DTSTART;VALUE=DATE:"+ymd,"DTEND;VALUE=DATE:"+nxt,
      fold("SUMMARY:"+icsEsc("📌 "+ENFANT.prenom+" : "+r.titre)),fold("DESCRIPTION:"+icsEsc(r.notes||"")),
      "BEGIN:VALARM","ACTION:DISPLAY",fold("DESCRIPTION:"+icsEsc("Demain : "+r.titre)),"TRIGGER:-PT5H","END:VALARM","END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.join("\r\n");
}
$("btn-ics").addEventListener("click", async ()=>{
  const file=new File([buildICS()], "allez-hop-2026-2027.ics", {type:"text/calendar"});
  // Sur iPhone, le partage ouvre directement « Ajouter au calendrier ».
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file], title:"Allez Hop"}); $("ics-msg").textContent="Choisis Calendrier pour ajouter les journées."; return; }
    catch(e){ if(e.name==="AbortError") return; }
  }
  const a=document.createElement("a");
  a.href=URL.createObjectURL(file); a.download=file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  $("ics-msg").textContent="Fichier téléchargé. Ouvre-le pour l'ajouter à ton calendrier.";
});

render();
initStore();
loadWeather(false);
checkUpdate();

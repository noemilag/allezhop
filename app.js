/* Allez Hop : la fiche du jour de l'enfant. Ses données viennent de Firebase après la connexion (voir school.js). */
import { CYCLE, CYCLE_OF, END, ENFANT, EVENTS, FIRST, FREEZING, JOURS, LAST, LAT, LON, METEO_URL, MOIS, OFF, PERIODES, SAISON, SUBJ, WX_URL, addDays, cap, chargerEnfant, codeEmoji, daysFromToday, deg, habits, hr, infoFor, key, longDate, nextSchoolDay, parse, precipShort, ranges, specialsOf, summarize, todayKey, validerEnfant, wxSub, CONGES } from "./school.js?v=202610302011";


/* ---------- Version : à changer à chaque mise en ligne (voir bump.sh) ---------- */
const VERSION = "202610302011";
// Les téléphones gardent l'app en mémoire : on vérifie s'il existe une version plus récente et on recharge.
// Une fois la page chargée, on retire le ?v=… de l'adresse pour qu'elle reste propre.
if(new URL(location.href).searchParams.has("v")){
  const u=new URL(location.href); u.searchParams.delete("v");
  history.replaceState(null, "", u.pathname+u.search+u.hash);
}
// Nouvelle version en ligne : une fenêtre propose la mise à jour (plus besoin de réinstaller l'icône).
let nouvelleVersion=null;
const LS_MAJ="allezhop.maj";
async function checkUpdate(){
  try{
    const r=await fetch("version.json?t="+Date.now(), {cache:"no-store"});
    const {v}=await r.json();
    if(!v || v===VERSION){ document.getElementById("maj").hidden=true; return; }
    nouvelleVersion=v;
    // Mise à jour déjà tentée il y a moins de 3 minutes : GitHub sert peut-être encore l'ancienne version.
    let essai=null; try{ essai=JSON.parse(localStorage.getItem(LS_MAJ)||"null"); }catch(e){}
    const recent = essai && essai.v===v && Date.now()-essai.t < 3*60e3;
    document.getElementById("maj-txt").textContent = recent
      ? "La nouvelle version est en route. Si rien ne change, réessayez dans quelques minutes."
      : "Mettez l'app à jour pour profiter des dernières améliorations.";
    document.getElementById("maj").hidden=false;
  }catch(e){ /* hors ligne */ }
}
async function mettreAJour(){
  const v=nouvelleVersion, btn=document.getElementById("maj-go");
  btn.disabled=true; btn.textContent="Mise à jour…";
  // On force le téléphone à retélécharger chaque fichier de l'app (sa mémoire est remplacée).
  const base=new URL("./", location.href).href;
  const fichiers=["", "index.html", "version.json", "manifest.webmanifest", "app.js?v="+v, "school.js?v="+v, "config.js?v="+v];
  await Promise.all(fichiers.map(f=>fetch(base+f, {cache:"reload"}).catch(()=>{})));
  try{ localStorage.setItem(LS_MAJ, JSON.stringify({v, t:Date.now()})); }catch(e){}
  const u=new URL(location.href); u.searchParams.set("v", v);
  location.replace(u.toString());
}
document.getElementById("maj-go").addEventListener("click", mettreAJour);
document.getElementById("maj-plus-tard").addEventListener("click", ()=>{ document.getElementById("maj").hidden=true; });
setInterval(()=>{ if(document.visibilityState==="visible") checkUpdate(); }, 15*60e3);

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
      google:async ()=>{
        const prov=new A.GoogleAuthProvider(); prov.setCustomParameters({prompt:"select_account"});
        try{ return await A.signInWithPopup(auth, prov); }
        catch(e){ if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e.code)) return A.signInWithRedirect(auth, prov); throw e; }
      },
      reset:e=>{ auth.languageCode="fr"; return A.sendPasswordResetEmail(auth,e); },
      signOut:()=>A.signOut(auth),
      save:r=>{
        const body={titre:r.titre, date:r.date, notes:r.notes, ic:r.ic, enfant:r.enfant||kidId||null, maj:Date.now(), par:userEmail};
        return r.id ? F.setDoc(F.doc(db,"rappels",r.id), body) : F.addDoc(coll, body);
      },
      del:id=>F.deleteDoc(F.doc(db,"rappels",id)),
      // Téléphones abonnés aux notifications (un document par téléphone)
      getSub:async id=>{ const s=await F.getDoc(F.doc(db,"abonnements",id)); return s.exists()?s.data():null; },
      saveSub:(id,d)=>F.setDoc(F.doc(db,"abonnements",id), {...d, maj:Date.now(), par:userEmail}, {merge:true}),
      delSub:id=>F.deleteDoc(F.doc(db,"abonnements",id)),
      saveActs:(id,list)=>F.setDoc(F.doc(db,"enfants",id), {activites:list, maj:Date.now()}, {merge:true}),
      saveKid:d=>F.addDoc(kids, {...d, creeLe:Date.now(), par:userEmail}).then(ref=>{ try{ localStorage.setItem(LS_KID, ref.id); }catch(e){} return ref; }),
    };
    A.getRedirectResult(auth).catch(()=>{});
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
// Activités qui reviennent chaque semaine (karaté, soccer…) : gardées dans la fiche de l'enfant
const LS_ACT="allezhop.activites";
function activites(){
  if(mode==="local"){ try{ return JSON.parse(localStorage.getItem(LS_ACT))||[]; }catch{ return []; } }
  const e=kidsAll.find(x=>x.id===kidId); return (e && e.activites) || [];
}
function activitesLe(k){
  const w=parse(k).getDay();
  return activites().filter(a=>(a.jours||[]).includes(w) && (!a.du || k>=a.du) && (!a.au || k<=a.au)).sort((x,y)=>(x.debut||"").localeCompare(y.debut||""));
}
async function enregistrerActivites(list){
  if(mode==="local"){ try{ localStorage.setItem(LS_ACT, JSON.stringify(list)); }catch{} render(); return; }
  const e=kidsAll.find(x=>x.id===kidId); if(e) e.activites=list;   // affichage immédiat
  render();
  await store.saveActs(kidId, list);
}
const heureFr=h=>{ if(!h) return ""; const [a,b]=h.split(":"); return (+a)+" h"+(b && b!=="00" ? " "+b : ""); };
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
$("c-x").addEventListener("click", ()=>$("compte").hidden=true);
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
  star:'<path d="M11.5 2.8a.6.6 0 0 1 1 0l2.6 5.3 5.8.8a.6.6 0 0 1 .3 1l-4.2 4.1 1 5.8a.6.6 0 0 1-.9.6L12 17.7l-5.2 2.7a.6.6 0 0 1-.9-.6l1-5.8-4.2-4.1a.6.6 0 0 1 .3-1l5.8-.8z"/>',
  bike:'<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
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
    list.push(k);   // essai C : tous les jours, fins de semaine comprises
  }
  return list;
}
function eyebrowFor(k){
  const diff=daysFromToday(k);
  if(diff===0) return "Aujourd'hui";
  if(diff===1) return "Demain";
  return diff<7 ? "Dans "+diff+" jours" : "Dans "+Math.round(diff/7)+" sem.";
}
// Mot « Congé » dessiné comme le logo Allez Hop (aussi dans icons/conge.svg)
const CONGE_LOGO=`<svg class="conge-logo" viewBox="0 0 503.23 349.31" fill="currentColor" aria-hidden="true"><path d="M137.15,4.88c9.53,7.93,10.51,20.27,11.81,31.83.14,1.61.39,3.22.53,4.82.45,4.22,1.01,8.54,1.46,12.86.55,4.42,1,8.84,1.54,13.26.69,6.03,1.38,12.15,2.07,18.18.91,8.54,1.92,16.98,3.02,25.52.31,2.71.71,5.43,1.02,8.14.14,1.61.39,3.22.63,4.82,1.41,11.26,2.53,22.5-4.32,32.27-4.87,4.93-9.49,8.28-16.51,8.84-8.61,0-14.66-1.31-21.05-7.53-5-5.78-6.34-13.43-7.08-20.86,0-.27-.07-1-.22-2.21-.22-2.31-.54-4.52-.76-6.83-.14-1.61-.29-3.11-.54-4.72-.37-3.81-.84-7.63-1.21-11.35-.33-.01-1.34.15-3.02.5-3.73.67-7.55,1.24-11.27,1.91-1.61.24-3.22.59-4.83.83-2.32.42-4.73.84-7.04,1.16-.7.08-1.41.25-2.21.32-3.62.58-7.25,1.25-10.87,1.83.15,7.11.82,14.04,1.87,21.18,1.43,10.66,2.6,20.4-3.63,29.79-5.2,5.72-11.12,9.02-18.84,9.66-8.91,0-13.81-2.98-20.31-8.71-4.6-5.96-6.05-13.22-7-20.55-.07-.8-.24-1.71-.31-2.61-.4-2.82-.71-5.63-1.01-8.44l-.8-5.93c-.62-5.22-1.34-10.45-1.96-15.58-.62-5.22-1.34-10.45-1.96-15.68-.79-6.03-1.49-12.06-2.28-18.09-1.36-10.79-2.39-18.83-3.07-24.12-.16-1.11-.32-2.21-.48-3.42-.23-1.91-.57-3.82-.8-5.83-1.28-9.35-1.38-17.96,4.3-25.97,5.31-6.02,10.72-9.14,18.76-10.06,7.91-.23,14.43,2.3,20.35,7.61,4.11,5.65,5.8,11.71,6.66,18.54,0,.27.1,1.04.32,2.31.32,2.41.63,4.82.95,7.24.24,1.61.39,3.22.63,4.92,1,7.84,1.45,12.96,1.37,15.36.5.02.91-.17,1.41-.25,4.93-.83,9.87-1.76,14.8-2.59,1.81-.34,3.63-.68,5.54-1.01,2.62-.51,5.33-.92,7.95-1.43.81-.17,1.61-.24,2.52-.41.81-.17,1.51-.25,2.32-.42.7-.08,1.41-.25,2.01-.33,1.14-.16,2.38-.22,3.71-.17-.17-.91-.24-1.81-.4-2.82-.48-3.42-.86-6.83-1.34-10.35-.15-1.51-.4-2.92-.55-4.42-2.32-17.76-1.2-29.89,3.36-36.41,8.98-10.8,23.34-12.3,34.99-4.9l-.21.29Z"/><path d="M448.33,13.72c3.51,2.62,6.51,5.63,9.6,8.74.19.21.87.9,2.03,2.07,6.09,6.11,11.98,12.52,17.76,18.82,3.86,4.24,7.92,8.28,12.09,12.12,8.34,7.69,12.81,14.42,13.41,20.17.1,5.81-1.15,10.17-4.81,14.74-3.01,3.1-6.11,5.89-9.31,8.78-3.1,2.79-5.9,5.8-8.71,8.8-1.66,1.74-3.42,3.48-5.28,5.12-2.38,2.22-4.66,4.54-6.94,6.86-.62.68-1.14,1.26-1.77,1.94-1.24,1.26-2.39,2.52-3.54,3.88-1.56,1.75-3.22,3.39-4.78,5.04-.52.58-1.04,1.06-1.56,1.65-3.84,3.97-7.41,5.95-12.85,7.06-4.2.06-7.67-1.07-10.77-3.97-3.94-4.74-5.21-8.48-4.8-14.57.41-3.09,1.79-5.34,3.47-7.88.63-.88,1.26-1.86,1.9-2.74,1.79-2.64,3.69-5.38,5.48-8.02-.8.07-1.51.15-2.31.32-7.53.84-15.06,1.48-22.68,2.02-.27,0-1.17.06-2.71.21-5.21.32-10.32.34-15.51.07-.33.89-.56,1.68-.89,2.57-4.63,12.25-13.78,22.34-25.49,28.24-12.19,5.28-25.46,7.03-38.09,2.09-2.76-1.3-5.11-2.58-7.55-4.36-.81,6.18-1.42,12.26-1.74,18.45l-.11,3.3-.23,6.7c-.49,8.49-2.34,15.63-8.85,21.51-.81.37-1.53.85-2.34,1.22-.82.47-1.53.85-2.35,1.32-5.49,2.61-11.6,2.7-17.34.8-5.61-2.8-9.77-6.94-12.27-12.73-2.07-6.58-2.06-12.68-1.83-19.47l.13-3.7.34-9.79.36-10.29.6-17.39.69-19.99c.2-5.8.4-11.49.59-17.19l.36-10.29.33-9.69.18-5.2c.34-9.79,2.13-18.14,9.37-25.09,5.77-4.7,11.01-6.02,18.5-5.47,8.25,1.49,12.49,6.43,17.26,13,.52-.48,1.13-.86,1.65-1.34,9.66-7.47,19.97-10.52,32.14-9.4,12.53,2.23,23.48,9.82,30.93,19.98,3.79,6.07,5.64,10.47,5.55,13.2,1,.03,1.91-.13,2.91-.2,3.61-.18,7.12-.45,10.73-.63,1.51-.15,3.11-.19,4.61-.24,8.32-.51,16.55-1.03,24.93-.44-.38-.61-.76-1.13-1.24-1.74-1.81-2.66-3.62-5.23-5.43-7.89-.67-.92-1.24-1.84-1.91-2.77-.19-.27-.79-1.16-1.81-2.66-.57-.82-1.14-1.64-1.72-2.46-3.14-4.71-2.67-9.5-1.88-15.07,1.09-2.56,2.23-3.83,4.2-5.86.52-.58.94-1.17,1.46-1.65,5.54-4.01,12.13-3.58,17.93-.48l-.1-.1ZM328.07,68.5c-3.89,5.37-5.26,10.22-4.58,16.85,1.17,6.64,4.25,10.35,9.51,14.34,4.23,2.25,9.34,1.92,13.96,1.48,5.07-1.93,8.28-5.22,10.85-9.83,2.62-6.31,3.14-12.6.56-19.09-2.63-4.99-6.03-8.01-11.15-10.39-7.53-2.06-14.13.51-19.14,6.64h0Z"/><path d="M255.18,34.97c13.7,11.88,19.85,27.9,21.43,45.77.61,11.23-2.99,22.81-8.13,32.74-.14.26-.54,1.02-1.18,2.26-7.9,14.24-20.92,23.29-35.9,28.48-13.74,3.73-27.36,1.36-39.95-4.98-14.62-8.41-24.78-21.17-29.63-37.44-1.58-6.36-1.97-12.38-1.65-18.97l.09-2.6c.33-6.59,1.42-12.26,3.94-18.38.33-.79.55-1.58.89-2.47,6.04-15.5,18.84-26.87,33.68-33.56,18.79-8.06,40.62-2.9,56.42,9.15ZM238.82,79.83c-7.5,5.54-14.37,7.71-23.76,7.08-6.86-1.14-11.97-4.02-17.11-8.7-2.82-2.5-4.77-3.97-8.46-4.29-3.41.28-5.74,1.2-8.04,3.83-2.02,3.53-2.13,6.73-1.27,10.66,5.19,9.18,15.34,16.54,25.44,19.49,14.72,2.71,27.48.95,40.08-7.42,4.84-3.84,9.37-7.78,11.78-13.6-.08-3.5-.82-5.13-2.93-7.91-2.34-1.78-4-2.94-6.88-3.64-3.52.58-6.09,2.39-8.96,4.49h.1Z"/><path d="M79.14,221.56c-11.71-7.02-23.98-8.48-37.13-5.96-31.02,5.96-46.99,33.56-40.63,66.68,6.36,33.13,30.89,52.95,62.44,46.9,14.2-2.73,25.91-9.88,33.56-21.16,5.52-8.15,3.81-17.09-4.14-21.56-6.69-3.62-13.85-1.16-18.73,4.69-3.92,5.12-8.78,8.23-15.09,9.44-15.77,3.03-24.41-7.85-27.54-24.15s1.91-29.81,16.63-32.64c6.84-1.31,11.97-.12,18.04,3.08,7.32,4.05,15.11,2.01,19.68-5.41s1.38-15.53-7.09-19.9Z"/><path d="M158.53,204.7c.3.07.61.14.92.22,11.64,2.88,22.77,10.47,29.22,20.97,2.6,4.36,4.85,8.76,6.43,13.62.13.39.27.78.4,1.18,2.18,7.4,2.48,15.65,1.47,23.26-.04.33-.09.66-.13,1.01-1.87,13.05-8.7,25.11-18.53,33.51-.86.64-1.73,1.27-2.61,1.88-.3.21-.6.41-.9.63-11.06,7.54-23.56,10.8-36.78,8.26-7.39-1.58-14.23-4.75-20.27-9.43-.39-.29-.79-.58-1.19-.88-10.37-7.97-17.13-20.97-19.21-34.01-1.9-14.23,1.88-28.56,10.09-40.04,12.21-16.18,31.05-25.07,51.1-20.17ZM114.96,258.72c-.66,2.75-.87,5.09.4,7.68,5.84,8.63,15.21,13.82,25.07,15.79,11.03,1.2,21.28-1.83,30.05-8.74,1.06-.93,2.06-1.9,3.05-2.89.27-.23.53-.46.8-.7,2.58-2.27,5.03-5.34,5.92-8.74.14-2.33.13-4.53-1.2-6.5-1.67-1.91-3.24-3.18-5.77-3.45-2.89.03-4.83.56-6.88,2.72q-.14.15-.84.91c-5.45,5.8-12.45,8.74-20.26,8.94-6.49-.23-12.5-2.68-17.18-7.33-1.84-1.74-3.63-2.41-6.14-2.47-3.13.31-5.38,2.13-7.04,4.79Z"/><path d="M202.65,210.08c-.03-9.64,6.39-15.01,15.49-15.03,8.03-.02,13.4,4.78,15.02,11.2,6.94-7.51,15.5-11.29,27.28-11.32,23.02-.06,36.45,14.89,36.52,39.52l.14,54.08c.02,9.1-5.85,14.47-15.49,14.5-9.64.03-15.54-5.31-15.57-14.42l-.13-48.72c-.03-10.71-4.86-16.05-14.5-16.02-10.71.03-17.65,8.08-17.62,19.86l.12,44.98c.02,9.1-5.85,14.47-15.49,14.5-9.64.03-15.54-5.31-15.57-14.42l-.21-78.71Z"/><path fill-rule="evenodd" d="M399.08,217.99c.43-8.56-5.22-13.66-13.77-14.09-6.95-.35-12.46,2.6-14.89,8.37-6.12-6.2-13.99-9.81-24.15-10.31-26.74-1.33-43.26,18.22-44.69,47.1-1.46,29.41,14.16,49.49,39.29,50.74,9.63.48,17.78-1.8,23.93-6.85l-.35,6.95c-.77,15.51-9.65,21.5-21.95,20.89-8.56-.43-15.91-3.47-22.14-7.53-7.78-5.21-15.4-2.91-19.49,3.86-4.65,7.27-2.35,14.89,4.9,20.08,10.35,7.48,23.56,11.36,36.93,12.02,31.02,1.54,50.61-15.17,52.13-45.66l4.25-85.56ZM351.3,230.09c11.23.56,17.25,8.9,16.58,22.27-.66,13.37-7.51,21.61-18.74,21.05-11.23-.56-17.76-9.46-17.09-22.83.66-13.37,8.02-21.05,19.25-20.49Z"/><path d="M488.98,233.05c1.25,1.62,2.42,3.28,3.57,4.98.31.45.62.89.94,1.35,5.16,8.05,6.04,17.71,4.58,27.2-1.15,4.91-4.08,9.15-7.99,12.08-5.29,3.15-9.97,3.24-15.8,2.4-.68-.09-1.36-.18-2.06-.28-12.43-1.71-24.78-3.94-37.15-6.05.13.84.26,1.69.4,2.53.07.47.15.94.23,1.42.89,3.93,4.18,6.99,7.32,9,5.57,2.7,12.25,3.13,18.13,1.03,1.53-.71,3.03-1.47,4.53-2.25,3.47-1.57,6.73-1.32,10.23-.14,3.85,1.68,6.04,3.99,7.75,8.02,1.47,4.28.91,7.87-.7,12.13-2.32,4.88-6.53,7.63-11.24,9.5-4.9,1.65-9.89,2.4-14.98,2.84-.57.05-1.14.11-1.73.16-13.46.66-27.53-3.82-37.56-13.26-9.37-9.26-14.8-21.54-15.14-35.32-.11-14.27,4.47-28.07,13.93-38.65,2.43-2.33,5.05-4.4,7.72-6.43.46-.35.91-.71,1.38-1.07,19.37-13.94,48.57-8.98,63.63,8.79ZM442.4,247q-1.08,1.15-3.57,5.23c9.7,1.61,19.4,3.23,29.4,4.89-.5-5.06-1.04-7.13-4.64-10.25-6.39-5.24-14.62-4.96-21.19.13Z"/><path d="M434.33,198.77c-1.08-4.48,2.43-8.52,8.01-10.06l23.95-4.74c7.09-1.64,13.51,3.21,14.81,10.71,1.29,7.5-3.67,12.41-11.28,12.19l-25.09-.49c-5.69.03-9.33-3.13-10.41-7.61Z"/></svg>`;
const MOIS_LONG=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const MOIS_COURT=["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
// « Lunch froid, 5 $ » → ["Lunch froid", "5 $"] (la virgule d'un prix comme 5,50 $ n'est pas suivie d'une espace)
// Cases cochées du sac à dos : gardées sur ce téléphone seulement, par jour
const SAC_CLE="allezhop-sac";
function sacLire(){ try{ return JSON.parse(localStorage.getItem(SAC_CLE))||{}; }catch{ return {}; } }
function sacCoche(k,o){ return !!(sacLire()[k]||[]).includes(o); }
function sacBasculer(k,o){
  const t=sacLire(), l=new Set(t[k]||[]);
  l.has(o) ? l.delete(o) : l.add(o);
  if(l.size) t[k]=[...l]; else delete t[k];
  const hier=addDays(todayKey(),-7); for(const d of Object.keys(t)) if(d<hier) delete t[d]; // ménage
  try{ localStorage.setItem(SAC_CLE, JSON.stringify(t)); }catch{}
  return l.has(o);
}
function aApporter(t){ return (t||"").split(/\n|,\s+/).map(x=>x.trim()).filter(Boolean); }
function cardHTML(k){
  const inf=infoFor(k), school=inf.kind==="ecole", d=parse(k);
  // Essai C : titre de la page (la date) et pastille du jour du cycle
  const dateTxt=`${cap(JOURS[d.getDay()])} ${d.getDate()===1?"1er":d.getDate()} ${MOIS_LONG[d.getMonth()]}`;
  let h=`<div class="ptitre"><div><span class="when">${esc(eyebrowFor(k))}</span><h2>${esc(dateTxt)}</h2></div>`;
  h+= school ? `<span class="j" aria-label="Jour ${inf.jour} du cycle"><small>Jour</small><b>${inf.jour}</b></span>` : `<span class="j conge" role="img" aria-label="Congé${inf.kind==="weekend"?"":" : "+esc(inf.label||"")}">${CONGE_LOGO}</span>`;
  h+=`</div>`;

  if(school){
    const sp=specialsOf(inf.jour);
    h+=`<div class="sec"><div class="sec-h"><span>À l'école</span></div>`;
    h+= sp.length
      ? sp.map(s=>`<div class="line cours"><span class="ic">${icon(s.ic)}</span><b class="nom">${esc(s.nom)}</b><span class="per">${s.p}<sup>${s.p==1?"re":"e"}</sup> période</span><time>${PERIODES[s.p]}</time></div>`).join("")
      : `<div class="offtxt">Aucun spécialiste</div>`;
    h+=`</div>`;
  }

  // Activités de la semaine (parascolaire) : « En soirée » les jours d'école, « Activités » sinon
  const acts=activitesLe(k);
  if(acts.length){
    h+=`<div class="sec"><div class="sec-h"><span>${school?"En soirée":"Activités"}</span></div>`;
    h+=acts.map(a=>`<button type="button" class="line cours act" data-act="${esc(a.id)}" aria-label="Modifier : ${esc(a.titre)}"><span class="ic">${icon(a.ic||"star")}</span><b class="nom">${esc(a.titre)}</b><span class="per">${heureFr(a.debut)}</span>${a.fin?`<time>jusqu'à ${heureFr(a.fin)}</time>`:"<time></time>"}</button>`).join("");
    h+=`</div>`;
  }
  if(!school && !acts.length && !remindersOn(k).length && !(EVENTS[k]||[]).length){
    h+=`<div class="rien">${inf.kind==="weekend"?"Rien de prévu cette journée-là.":"Pas d'école."} Touchez <b>+</b> pour ajouter un rappel ou une activité.</div>`;
  }

  const items=[];
  (EVENTS[k]||[]).forEach(([e,t,n])=>items.push({ic:e, t, n}));
  remindersOn(k).forEach(r=>items.push({ic:r.ic||r.em, t:r.titre, id:r.id}));
  if(items.length){
    h+=`<div class="sec"><div class="sec-h"><span>À ne pas oublier</span></div>`;
    items.forEach(it=>{
      const inner=`<span class="ic">${icon(it.ic)}</span><div class="tx"><b>${esc(it.t)}</b>${it.n?`<span class="note">${esc(it.n)}</span>`:""}</div>`;
      h+= it.id ? `<button class="line" data-edit="${esc(it.id)}" aria-label="Modifier : ${esc(it.t)}">${inner}</button>` : `<div class="line">${inner}</div>`;
    });
    h+=`</div>`;
  }

  // Dans le sac à dos : sous les rappels, juste avant la météo
  // ce qu'il faut pour les cours, puis le champ « Dans le sac à dos » des rappels (un objet par virgule ou par ligne)
  const objets=[...(school ? specialsOf(inf.jour).map(s=>s.apporter).filter(Boolean) : []), ...acts.flatMap(a=>aApporter(a.apporter)), ...remindersOn(k).flatMap(r=>aApporter(r.notes))];
  const sac=objets.map(o=>{ const on=sacCoche(k,o); return `<li><button type="button" class="coche${on?" on":""}" data-sac="${esc(o)}" aria-pressed="${on}"><span class="box">${icon("check")}</span><span class="txt">${esc(o)}</span></button></li>`; }).join("");
  if(sac) h+=`<div class="sec sac"><div class="sec-h"><span>Dans le sac à dos</span></div><ul>${sac}</ul></div>`;

  h+=weatherHTML(k);

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
// Même logo que l'en-tête, en grand sur l'écran de connexion
$("gate-logo").innerHTML=document.querySelector("header .logo").outerHTML;
const GATE_TXT=$("gate-msg").textContent;
const GATE_TITLE=$("gate-title").innerHTML;
/* ---------- Petites surprises des fêtes, à l'ouverture de l'app ----------
   Halloween (30 et 31 octobre) : une chauve-souris traverse l'écran.
   Noël (dernier jour d'école de décembre, 24 et 25 décembre) : il neige quelques secondes.
   Pour essayer : ?fete=halloween ou ?fete=noel dans l'adresse. */
let surpriseVue=false;
function feteDuJour(){
  const essai=new URLSearchParams(location.search).get("fete"); if(essai) return essai;
  const t=todayKey(), md=t.slice(5);
  if(md==="10-30" || md==="10-31") return "halloween";
  if(md==="12-24" || md==="12-25") return "noel";
  if(md.startsWith("12-") && infoFor(t).kind==="ecole"){
    // dernier jour d'école avant le congé des Fêtes
    let k=addDays(t,1); while(k.slice(5,7)==="12" && infoFor(k).kind!=="ecole") k=addDays(k,1);
    if(k.slice(5,7)!=="12") return "noel";
  }
  return null;
}
function surprise(){
  if(surpriseVue || reduceMotion) return;
  const f=feteDuJour(); surpriseVue=true;
  if(f==="halloween") chauveSouris();
  if(f==="noel") neige();
}
function chauveSouris(){
  // Trois chauves-souris traversent l'écran ; celle du milieu se cogne au bord et repart de l'autre côté
  [{retard:0, y:.6, monte:.3, taille:1, phase:0},
   {retard:350, y:.42, monte:.12, taille:.75, phase:1.3, cogne:true},
   {retard:800, y:.78, monte:.4, taille:.9, phase:2.4}].forEach(c=>setTimeout(()=>uneChauveSouris(c), c.retard));
}
function uneChauveSouris({y, monte, taille, phase, cogne}){
  const W=innerWidth, H=innerHeight, bw=80*taille;
  const bat=document.createElement("div");
  bat.className="chauve-souris"; bat.setAttribute("aria-hidden","true");
  bat.innerHTML=`<svg viewBox="0 0 120 60"><g class="aile g"><path d="M60 30 C50 14 34 8 6 12 C16 18 18 24 14 30 C24 26 30 30 32 36 C38 30 46 30 50 36 C52 32 56 31 60 30Z"/></g><g class="aile d"><path d="M60 30 C70 14 86 8 114 12 C104 18 102 24 106 30 C96 26 90 30 88 36 C82 30 74 30 70 36 C68 32 64 31 60 30Z"/></g><ellipse cx="60" cy="31" rx="7" ry="10"/><path d="M54 23 L55 15 L58 21 Z M66 23 L65 15 L62 21 Z"/><circle cx="57.5" cy="28" r="1.4" fill="#FFB547"/><circle cx="62.5" cy="28" r="1.4" fill="#FFB547"/></svg>`;
  document.body.appendChild(bat);
  // Vol en vagues avec de petits sursauts (moins lisse), de la gauche vers la droite
  const kf=[], n=16, bord=W-bw-4;
  for(let i=0;i<=n;i++){
    const t=i/n;
    let x, vers=1;
    if(cogne){
      // va jusqu'au bord droit (60 % du temps), se cogne, puis ressort à gauche
      x = t<=.6 ? -90+(t/.6)*(bord+90) : bord-((t-.6)/.4)*(bord+120);
      if(t>.6) vers=-1;
    } else x=-90+t*(W+180);
    const sursaut=(i%3===1 ? (Math.random()-.5)*36 : 0);
    const yy=H*y-t*H*monte+Math.sin(t*Math.PI*3+phase)*30+sursaut;
    kf.push({transform:`translate(${x}px,${yy}px) scale(${vers*taille},${taille}) rotate(${Math.cos(t*Math.PI*3+phase)*12*vers}deg)`});
  }
  if(cogne) kf.splice(Math.round(n*.6)+1, 0, {transform:kf[Math.round(n*.6)].transform.replace(/rotate\([^)]*\)/,"rotate(25deg)")});   // petit choc contre le bord
  bat.animate(kf,{duration:cogne?3200:2800,easing:"linear",fill:"forwards"}).onfinish=()=>bat.remove();
}
function neige(){
  const box=document.createElement("div");
  box.className="neige"; box.setAttribute("aria-hidden","true");
  const W=innerWidth, H=innerHeight;
  for(let i=0;i<34;i++){
    const f=document.createElement("i"), taille=4+Math.random()*7, x=Math.random()*W, derive=(Math.random()-.5)*90;
    f.style.width=f.style.height=taille+"px"; f.style.left=x+"px";
    box.appendChild(f);
    f.animate([{transform:"translate(0,-20px)",opacity:0},{opacity:.95,offset:.1},{opacity:.95,offset:.8},{transform:`translate(${derive}px,${H+20}px)`,opacity:0}],
      {duration:5000+Math.random()*3000, delay:Math.random()*2500, easing:"linear", fill:"both"});
  }
  document.body.appendChild(box);
  setTimeout(()=>box.remove(), 11000);
}
function setAccess(state, msg, alt){
  access=state;
  if(state==="open") setTimeout(surprise, 700);
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
  $("gate-google").hidden = $("gate-login").hidden;
  $("gate-alt").hidden = !alt; $("gate-alt").textContent = alt || "";
  if(state!=="open"){ card.innerHTML=""; peek.innerHTML=""; scrim.hidden=true; info.hidden=true; $("recherche").hidden=true; $("mois").hidden=true; }
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
// Connexion avec Google (le compte Google doit être celui d'un des deux parents)
async function avecGoogle(){
  if(!store || !store.google) return;
  try{ await store.google(); $("compte").hidden=true; }
  catch(e){ if(e.code!=="auth/popup-closed-by-user") toast(authMessage(e)); }
}
$("gate-google").addEventListener("click", avecGoogle);
$("l-google").addEventListener("click", avecGoogle);
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
  card.innerHTML=cardHTML(current); card.scrollTop=0;
  card.setAttribute("aria-label", cap(longDate(current)));
  fit(card); chrome();
  // La carte suivante, visible derrière pendant qu'on glisse
  const nk=days[idx+1];
  peek.className="card back b1"+(nk && infoFor(nk).kind!=="ecole"?" off":"");
  peek.innerHTML=nk ? cardHTML(nk) : "";
  fit(peek);
}
// Essai : rien ne rapetisse ; la fiche défile. Un fondu en bas indique qu'il reste du contenu.
function fit(el){
  const reste=el.scrollHeight-el.clientHeight-el.scrollTop>4;
  el.classList.toggle("deborde", reste);
}
function chrome(){
  paintWeek();
}
// Bande de la semaine : toutes les semaines jusqu'à la fin de l'année, on la fait glisser de côté
let semaines=null, semVue=null, semPour=null;
const lundiDe=k=>addDays(k, -parse(k).getDay());   // essai C : la semaine commence le dimanche
function buildWeeks(){
  semaines=[]; semPour=todayKey()+LAST; const fin=lundiDe(LAST);
  for(let l=lundiDe(todayKey()); l<=fin; l=addDays(l,7)) semaines.push(l);
  $("wk-pages").innerHTML=semaines.map(l=>`<div class="wk" data-lundi="${l}">${[0,1,2,3,4,5,6].map(i=>{
    const k=addDays(l,i), x=parse(k), inf=infoFor(k);
    const sub=inf.kind==="ecole" ? "J"+inf.jour : inf.kind==="off" ? "congé" : "";
    const cls=["wd"]; if(inf.kind==="off") cls.push("off"); if(inf.kind==="weekend") cls.push("we");
    return `<button type="button" class="${cls.join(" ")}" data-semaine="${k}" aria-label="${esc(cap(longDate(k)))}${sub?", "+sub:""}"><small>${JOURS_COURTS[x.getDay()]}</small><b>${x.getDate()}</b><span>${sub}</span><i class="pt"></i></button>`;
  }).join("")}</div>`).join("");
}
function titreSemaine(l){
  const t=lundiDe(todayKey());
  if(l===t) return "Cette semaine";
  if(l===addDays(t,7)) return "Semaine prochaine";
  const x=parse(l); return "Semaine du "+(x.getDate()===1?"1er":x.getDate())+" "+MOIS_COURT[x.getMonth()];
}
function montrerSemaine(l, doux){
  const i=semaines.indexOf(l); if(i<0) return;
  semVue=l; $("wk-titre").textContent=titreSemaine(l);
  $("wk-prev").disabled=i===0; $("wk-next").disabled=i===semaines.length-1;
  if(typeof paintToday==="function") paintToday();
  const box=$("wk-pages"), x=i*box.clientWidth;
  if(Math.abs(box.scrollLeft-x)>2) box.scrollTo({left:x, behavior:doux&&!reduceMotion?"smooth":"auto"});
}
function paintWeek(){
  if(!semaines || semPour!==todayKey()+LAST){ buildWeeks(); semVue=null; }
  const t=todayKey();
  $("wk-pages").querySelectorAll(".wd").forEach(b=>{
    const k=b.dataset.semaine;
    b.classList.toggle("sel", k===current); b.classList.toggle("auj", k===t); b.classList.toggle("passe", k<t);
    b.classList.toggle("prevu", remindersOn(k).length>0);   // point : rappel ce jour-là (pas les activités, qui reviennent chaque semaine)
    if(k===current) b.setAttribute("aria-current","date"); else b.removeAttribute("aria-current");
  });
  montrerSemaine(lundiDe(current), semVue!==null);
}
// dir : sens du geste {x,y} (-1, 0 ou 1). Vers la gauche ou le haut = jour suivant.
function go(delta, dir){
  // Un toucher pendant l'animation précédente la termine tout de suite au lieu d'être ignoré.
  if(busy){
    stack.querySelectorAll(".leaving").forEach(el=>el.remove());
    card.getAnimations().forEach(an=>an.finish());
    busy=false;
  }
  const ni=idx+delta;
  if(!delta || ni<0 || ni>=days.length){ snap(); return; }
  const from=card.style.transform||"none";
  if(reduceMotion){ idx=ni; current=days[ni]; card.style.transform=""; paint(); return; }
  busy=true; setTimeout(()=>busy=false, 450);
  const old=card.cloneNode(true);
  old.removeAttribute("id"); old.removeAttribute("aria-live"); old.classList.add("leaving"); old.setAttribute("aria-hidden","true");
  const hautAvant=card.scrollTop;
  idx=ni; current=days[ni]; card.style.transform=""; paint();
  // Essai C : pas de pile de fiches ; les pages glissent côte à côte.
  const s=delta>0 ? -1 : 1;
  stack.appendChild(old); old.scrollTop=hautAvant;
  old.animate([{transform:from},{transform:`translateX(${s*100}%)`}],{duration:300,easing:EASE}).onfinish=()=>{ old.remove(); busy=false; };
  card.animate([{transform:`translateX(${-s*100}%)`},{transform:"none"}],{duration:300,easing:EASE});
}
// Bouton qui réagit dès que le doigt se lève. Le mode app de l'iPhone (ouverte depuis l'icône)
// avale parfois le premier « click » après un swipe ; le clic reste pour la souris et le clavier.
function tap(el, fn){
  let last=0, start=null;
  el.addEventListener("pointerdown", e=>{ start = e.pointerType==="mouse" ? null : {x:e.clientX, y:e.clientY, id:e.pointerId}; });
  el.addEventListener("pointercancel", ()=>{ start=null; });
  el.addEventListener("pointerup", e=>{
    if(!start || e.pointerId!==start.id) return;
    const bouge=Math.hypot(e.clientX-start.x, e.clientY-start.y)>12; start=null;
    if(bouge) return;
    last=Date.now(); fn(e);
  });
  el.addEventListener("click", e=>{ if(Date.now()-last<800) return; fn(e); });
}
// Les calendriers commencent la semaine le dimanche (comme au Québec)
const JOURS_COURTS=["D","L","M","M","J","V","S"];
function goKey(k){ const i=days.indexOf(k); if(i>=0) go(i-idx); }
// Ouvre la fiche d'une date (depuis la recherche ou la vue du mois)
function allerA(k){
  if(k<todayKey()){ toast("Cette date est passée"); return; }
  const i=days.indexOf(k);
  if(i<0){ toast(infoFor(k).kind==="weekend" ? "Fin de semaine : pas de fiche ce jour-là" : "Pas de fiche ce jour-là"); return; }
  $("recherche").hidden=true; $("mois").hidden=true;
  go(i-idx);
}
function quand(k){
  const n=daysFromToday(k);
  return n===0 ? "aujourd'hui" : n===1 ? "demain" : n===-1 ? "hier" : n>0 ? "dans "+n+" jours" : "il y a "+(-n)+" jours";
}

/* ---------- Recherche : rappels, événements de l'école et congés ---------- */
const norm=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
function chercher(q){
  const n=norm(q).trim(); if(n.length<2) return null;
  const out=[], ok=(...t)=>t.some(x=>norm(x).includes(n));
  mine().forEach(r=>{ if(ok(r.titre,r.notes)) out.push({date:r.date, ic:r.ic||r.em, t:r.titre, n:r.notes, tag:"Rappel"}); });
  Object.entries(EVENTS).forEach(([d,l])=>l.forEach(([ic,t,note])=>{ if(ok(t,note)) out.push({date:d, ic, t, n:note, tag:"École"}); }));
  CONGES.forEach(c=>{ if(ok(c.label,"congé")) out.push({date:c.du, fin:c.au, ic:"home", t:c.label, tag:"Congé"}); });
  return out;
}
function ligneHit(h){
  const passe=(h.fin||h.date)<todayKey();
  const d = h.fin && h.fin!==h.date ? `du ${longDate(h.date)} au ${longDate(h.fin)}` : cap(longDate(h.date))+" · "+quand(h.date);
  const inf=infoFor(h.date), j=inf.kind==="ecole" ? " · J"+inf.jour : "";
  return `<button type="button" class="hit${passe?" passe":""}" data-aller="${h.date}"><span class="ic">${icon(h.ic)}</span><span class="tx"><b>${esc(h.t)}</b><span>${esc(d+j)}${h.n?" · "+esc(h.n):""}</span></span><span class="tag">${h.tag}</span></button>`;
}
function paintRecherche(){
  const res=chercher($("q").value), box=$("q-res");
  if(!res){ box.innerHTML=`<div class="vide">Tapez au moins 2 lettres : le titre d'un rappel, une note, un événement ou un congé.</div>`; return; }
  if(!res.length){ box.innerHTML=`<div class="vide">Aucun résultat pour « ${esc($("q").value.trim())} ».</div>`; return; }
  const t=todayKey();
  const avenir=res.filter(h=>(h.fin||h.date)>=t).sort((x,y)=>x.date.localeCompare(y.date));
  const passes=res.filter(h=>(h.fin||h.date)<t).sort((x,y)=>y.date.localeCompare(x.date));
  box.innerHTML=(avenir.length?`<div class="grp">À venir</div>`+avenir.map(ligneHit).join(""):"")+(passes.length?`<div class="grp">Passés</div>`+passes.slice(0,20).map(ligneHit).join(""):"");
}
tap($("btn-search"), ()=>{ $("recherche").hidden=false; paintRecherche(); setTimeout(()=>$("q").focus(),60); });
$("q").addEventListener("input", paintRecherche);
$("q-close").addEventListener("click", ()=>$("recherche").hidden=true);
$("recherche").addEventListener("click", e=>{
  if(e.target===$("recherche")){ $("recherche").hidden=true; return; }
  const b=e.target.closest("[data-aller]"); if(b && !b.classList.contains("passe")) allerA(b.dataset.aller);
});

/* ---------- Vue du mois ---------- */
let moisVue=null;
function paintMois(){
  const [y,m]=moisVue.split("-").map(Number), t=todayKey();
  $("m-title").textContent=MOIS[m-1]+" "+y;
  $("m-prev").disabled = moisVue<=FIRST.slice(0,7);
  $("m-next").disabled = moisVue>=END.slice(0,7);
  const rem={}; mine().forEach(r=>{ (rem[r.date] ??= []).push(r); });
  let h=JOURS_COURTS.map(d=>`<span class="wd">${d}</span>`).join("");
  const lead=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  for(let i=0;i<lead;i++) h+=`<span></span>`;
  const liste=[];
  for(let d=1; d<=dim; d++){
    const k=key(new Date(y,m-1,d)), inf=infoFor(k), cls=[];
    if(inf.kind==="weekend") cls.push("we"); if(inf.kind==="off") cls.push("offd");
    if(k<t) cls.push("passe"); if(k===t) cls.push("today");
    const sub = inf.kind==="ecole" ? "J"+inf.jour : inf.kind==="off" ? "congé" : "";
    const r=rem[k]||[], ev=EVENTS[k]||[];
    const pts=(r.length?'<i class="pt r"></i>':"")+(ev.length?'<i class="pt e"></i>':"");
    h+=`<button type="button" class="${cls.join(" ")}" data-aller="${k}" aria-label="${esc(longDate(k))}${sub?", "+sub:""}${r.length?", "+r.length+" rappel(s)":""}"><b>${d}</b><i>${sub||"&nbsp;"}</i><span class="pts">${pts}</span></button>`;
    r.forEach(x=>liste.push({date:k, ic:x.ic||x.em, t:x.titre, n:x.notes, tag:"Rappel"}));
    ev.forEach(([ic,tt,n])=>liste.push({date:k, ic, t:tt, n, tag:"École"}));
  }
  CONGES.forEach(c=>{ if(c.du.slice(0,7)===moisVue || c.au.slice(0,7)===moisVue) liste.push({date:c.du, fin:c.au, ic:"home", t:c.label, tag:"Congé"}); });
  $("m-grid").innerHTML=h;
  liste.sort((x,y)=>x.date.localeCompare(y.date));
  $("m-list").innerHTML = liste.length ? `<div class="grp">Ce mois-ci</div>`+liste.map(ligneHit).join("") : `<div class="vide">Aucun rappel ni événement ce mois-ci.</div>`;
}
tap($("btn-month"), ()=>{ moisVue=(current||todayKey()).slice(0,7); paintMois(); $("mois").hidden=false; });
$("m-prev").addEventListener("click", ()=>{ moisVue=shiftMonth(moisVue,-1); paintMois(); });
$("m-next").addEventListener("click", ()=>{ moisVue=shiftMonth(moisVue,1); paintMois(); });
$("m-close").addEventListener("click", ()=>$("mois").hidden=true);
$("mois").addEventListener("click", e=>{
  if(e.target===$("mois")){ $("mois").hidden=true; return; }
  const b=e.target.closest("[data-aller]"); if(b && !b.classList.contains("passe")) allerA(b.dataset.aller);
});
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
    // Geste vertical : on laisse la fiche défiler.
    if(Math.abs(dy)>Math.abs(dx)){ drag=null; return; }
    drag.on=true; dragged=true; card.setPointerCapture(e.pointerId);
  }
  drag.dx=dx;
  const k=idx===0 && dx>0 ? .35 : 1;   // résistance quand il n'y a pas de jour précédent
  card.style.transform=`translateX(${dx*k}px)`;
});
function endDrag(e){
  if(!drag || e.pointerId!==drag.id) return;
  const d=drag; drag=null;
  if(!d.on) return;
  const dist=Math.abs(d.dx), speed=dist/Math.max(1,performance.now()-d.t);
  if(dist>80 || (speed>.5 && dist>30)){ const s=Math.sign(d.dx); go(s<0 ? 1 : -1, {x:s,y:0}); }
  else snap();
}
card.addEventListener("pointerup", endDrag);
card.addEventListener("scroll", ()=>fit(card), {passive:true});
card.addEventListener("pointercancel", endDrag);
card.addEventListener("dragstart", e=>e.preventDefault());
card.addEventListener("click", e=>{
  if(dragged){ e.preventDefault(); e.stopPropagation(); dragged=false; }
}, true);
card.addEventListener("click", e=>{
  const c=e.target.closest("[data-sac]");
  if(c){ const on=sacBasculer(days[idx], c.dataset.sac); c.classList.toggle("on",on); c.setAttribute("aria-pressed",on); return; }
  const ac=e.target.closest("[data-act]"); if(ac){ const a=activites().find(x=>x.id===ac.dataset.act); if(a) openAct(a); return; }
  const ed=e.target.closest("[data-edit]"); if(ed){ const r=reminders.find(x=>x.id===ed.dataset.edit); if(r) openSheet(r); return; }
  const g=e.target.closest("[data-go]"); if(g) goKey(g.dataset.go);
});
// Aujourd'hui : revient au jour même et à sa semaine
tap($("btn-today"), ()=>{ if(idx) go(-idx); else montrerSemaine(semaines[0], true); paintToday(); });
function paintToday(){ $("btn-today").hidden = idx===0 && semVue===semaines?.[0]; }
// Glisser la bande : le titre suit la semaine visible
$("wk-pages").addEventListener("scroll", ()=>{
  const box=$("wk-pages"), i=Math.round(box.scrollLeft/Math.max(1,box.clientWidth)), l=semaines&&semaines[i];
  if(l && l!==semVue){ semVue=l; $("wk-titre").textContent=titreSemaine(l); $("wk-prev").disabled=i===0; $("wk-next").disabled=i===semaines.length-1; paintToday(); }
}, {passive:true});
// Flèche de gauche : retour direct à la semaine d'aujourd'hui (pas une semaine à la fois)
tap($("wk-prev"), ()=>montrerSemaine(semaines[0], true));
tap($("wk-next"), ()=>{ const i=semaines.indexOf(semVue); if(i<semaines.length-1) montrerSemaine(semaines[i+1], true); });
window.addEventListener("resize", ()=>{ if(semVue) montrerSemaine(semVue, false); });
tap($("week"), e=>{
  const b=e.target.closest("[data-semaine]"); if(!b) return;
  const k=b.dataset.semaine; if(k===current) return;
  if(k<todayKey()){ toast("Cette journée est passée"); return; }
  const i=days.indexOf(k); if(i<0){ toast("Pas de fiche ce jour-là"); return; }
  go(i-idx, i>idx ? {x:-1,y:0} : {x:1,y:0});
});
document.addEventListener("keydown", e=>{
  if(!scrim.hidden || !actS.hidden || !$("choix").hidden || !info.hidden || !$("compte").hidden || !$("recherche").hidden || !$("mois").hidden) return;
  if(e.key==="ArrowRight"){ e.preventDefault(); go(1, {x:-1,y:0}); }
  if(e.key==="ArrowLeft"){ e.preventDefault(); go(-1, {x:1,y:0}); }
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
  let h=JOURS_COURTS.map(d=>`<span class="wd">${d}</span>`).join("");
  const first=new Date(y,m-1,1), lead=first.getDay(), dim=new Date(y,m,0).getDate();
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

/* ---------- Activités (chaque semaine) ---------- */
const actS=$("act"), aT=$("a-titre"), aD=$("a-debut"), aF=$("a-fin"), aN=$("a-sac"), aE=$("a-err"), aDel=$("a-del");
const aDu=$("a-du"), aNb=$("a-nb"), aAu=$("a-au");
let actEdit=null, actIc="star", actJours=new Set(), actArmed=false, actDuree="annee";
// Durée : toute l'année scolaire, un nombre de semaines, ou jusqu'à une date
function finActivite(){
  const du=aDu.value||todayKey();
  if(actDuree==="semaines"){ const n=Math.max(1, Math.min(52, parseInt(aNb.value,10)||0)); return n ? addDays(du, n*7-1) : ""; }
  if(actDuree==="date") return aAu.value||"";
  return LAST;
}
function paintDuree(){
  $("a-duree").querySelectorAll("button").forEach(b=>b.classList.toggle("on", b.dataset.duree===actDuree));
  $("a-nb-box").hidden = actDuree!=="semaines"; $("a-au-box").hidden = actDuree!=="date";
  const du=aDu.value||todayKey(), au=finActivite();
  const n=actJours.size ? (()=>{ let c=0; for(let k=du; au && k<=au; k=addDays(k,1)) if(actJours.has(parse(k).getDay())) c++; return c; })() : 0;
  $("a-resume").textContent = au && au>=du ? `Du ${longDate(du)} au ${longDate(au)}${n?` · ${n} fois`:""}` : "";
}
$("a-duree").addEventListener("click", e=>{ const b=e.target.closest("[data-duree]"); if(!b) return; actDuree=b.dataset.duree;
  if(actDuree==="semaines" && !aNb.value) aNb.value=10;
  if(actDuree==="date" && !aAu.value) aAu.value=addDays(aDu.value||todayKey(), 69);
  paintDuree(); });
[aDu,aNb,aAu].forEach(x=>x.addEventListener("input", paintDuree));
const PICK_ACT=["star","ball","music","waves","palette","book","bike","chat","pencil","ticket","pin"];
$("a-icons").innerHTML=PICK_ACT.map(x=>`<button type="button" data-ic="${x}" aria-label="Icône ${x}">${icon(x)}</button>`).join("");
$("a-icons").addEventListener("click", e=>{ const b=e.target.closest("[data-ic]"); if(b){ actIc=b.dataset.ic; paintAct(); } });
$("a-jours").innerHTML=JOURS.map((j,i)=>`<button type="button" data-j="${i}" aria-label="${j}">${JOURS_COURTS[i]}</button>`).join("");
$("a-jours").addEventListener("click", e=>{ const b=e.target.closest("[data-j]"); if(!b) return; const j=+b.dataset.j; actJours.has(j)?actJours.delete(j):actJours.add(j); paintAct(); });
function paintAct(){
  $("a-icons").querySelectorAll("button").forEach(b=>b.classList.toggle("on", b.dataset.ic===actIc));
  $("a-jours").querySelectorAll("button").forEach(b=>b.classList.toggle("on", actJours.has(+b.dataset.j)));
  paintDuree();
}
function openAct(a){
  if(mode==="signedout"){ $("compte").hidden=false; return; }
  actEdit=a?a.id:null; actArmed=false;
  $("act-title").textContent=a?"Modifier l'activité":"Nouvelle activité";
  aT.value=a?a.titre:""; aD.value=a?(a.debut||""):"18:00"; aF.value=a?(a.fin||""):""; aN.value=a?(a.apporter||""):"";
  actIc=a?(a.ic||"star"):"star";
  actJours=new Set(a ? a.jours : [parse(current||todayKey()).getDay()]);
  aDu.value = a ? (a.du||todayKey()) : (current && current>todayKey() ? current : todayKey());
  actDuree = a ? (a.duree || (a.au && a.au!==LAST ? "date" : "annee")) : "annee";
  aNb.value = a && a.semaines ? a.semaines : ""; aAu.value = a && a.au && a.au!==LAST ? a.au : "";
  aDel.hidden=!a; aDel.classList.remove("armed"); aDel.textContent="Supprimer"; aE.hidden=true;
  paintAct(); actS.hidden=false;
}
$("a-cancel").addEventListener("click", ()=>actS.hidden=true);
actS.addEventListener("click", e=>{ if(e.target===actS) actS.hidden=true; });
$("act-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const titre=aT.value.trim();
  if(!titre){ aE.textContent="Écrivez le nom de l'activité."; aE.hidden=false; aT.focus(); return; }
  if(!actJours.size){ aE.textContent="Choisissez au moins une journée."; aE.hidden=false; return; }
  if(!aD.value){ aE.textContent="Indiquez l'heure du début."; aE.hidden=false; return; }
  const du=aDu.value||todayKey(), au=finActivite();
  if(actDuree==="semaines" && !(parseInt(aNb.value,10)>0)){ aE.textContent="Indiquez le nombre de semaines."; aE.hidden=false; return; }
  if(actDuree==="date" && (!au || au<du)){ aE.textContent="La date de fin doit venir après le début."; aE.hidden=false; return; }
  const a={id:actEdit||("a"+Date.now().toString(36)), titre, jours:[...actJours].sort(), debut:aD.value, fin:aF.value||"", apporter:aN.value.trim(), ic:actIc,
           du, au, duree:actDuree, semaines: actDuree==="semaines" ? parseInt(aNb.value,10) : null};
  const list=activites().filter(x=>x.id!==a.id); list.push(a);
  actS.hidden=true;
  try{ await enregistrerActivites(list); toast(actEdit?"Activité modifiée":"Activité ajoutée : "+a.jours.map(j=>JOURS[j]).join(", ")); }
  catch(err){ toast("Pas pu enregistrer : "+(err.code||err.message)); }
});
aDel.addEventListener("click", async ()=>{
  if(!actArmed){ actArmed=true; aDel.classList.add("armed"); aDel.textContent="Confirmer"; return; }
  actS.hidden=true;
  try{ await enregistrerActivites(activites().filter(x=>x.id!==actEdit)); toast("Activité supprimée"); }
  catch(err){ toast("Pas pu supprimer : "+(err.code||err.message)); }
});
tap($("fab"), ()=>{ if(mode==="signedout"){ $("compte").hidden=false; return; } $("choix").hidden=false; });
$("choix").addEventListener("click", e=>{
  const b=e.target.closest("[data-choix]");
  if(e.target===$("choix") || b) $("choix").hidden=true;
  if(!b) return;
  if(b.dataset.choix==="rappel"){ openSheet(null); if(!scrim.hidden) setTimeout(()=>fT.focus(),50); }
  if(b.dataset.choix==="activite") openAct(null);
});
$("f-cancel").addEventListener("click", closeSheet);
scrim.addEventListener("click", e=>{ if(e.target===scrim) closeSheet(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ closeSheet(); actS.hidden=true; $("choix").hidden=true; info.hidden=true; $("compte").hidden=true; $("recherche").hidden=true; $("mois").hidden=true; } });

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
const VAPID_PUBLIC="BPLiguWy_GAbMeOOUjC9ntf_WBSRb2ZOqvyhVmsx0YjaQcQFF5CeNYreHaQhU2vBBEaLouXgbRqnamHY9YVx-eM";   // clé publique (la clé privée est le secret GitHub VAPID_PRIVATE_KEY)
const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const installed = navigator.standalone===true || matchMedia("(display-mode: standalone)").matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
let swReg=null;
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r=>{ swReg=r; }).catch(()=>{});

function b64ToBytes(b64){ const s=atob((b64+"=".repeat((4-b64.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(s,c=>c.charCodeAt(0)); }
async function getReg(){ return swReg || (await navigator.serviceWorker.ready); }
// Identifiant stable du téléphone : empreinte de son adresse d'abonnement
async function subId(sub){
  const h=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
  return Array.from(new Uint8Array(h)).slice(0,20).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function heures(sel){
  let h=""; for(let m=5*60; m<=21*60+45; m+=15){ const v=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); h+=`<option value="${v}"${v===sel?" selected":""}>${hFr(v)}</option>`; }
  return h;
}
function hFr(v){ return v.replace(/^0/,"").replace(":"," h ").replace(" h 00"," h"); }   // "06:45" → "6 h 45"
function pourQuand(hh){ return +hh.slice(0,2)<12 ? "Notification sur la journée même." : "Après midi, la notification parle du lendemain : pratique pour préparer le sac la veille."; }
async function paintPush(){
  const st=$("push-state"), act=$("push-actions"), box=$("push-heure");
  act.innerHTML=""; box.hidden=true; $("push-options").hidden=true;
  if(isIOS && !installed){ st.textContent="Sur iPhone, les notifications marchent seulement depuis l'écran d'accueil : Partager → Sur l'écran d'accueil, puis ouvre Allez Hop avec son icône."; return; }
  if(!pushOK){ st.textContent="Ce navigateur ne reçoit pas les notifications."; return; }
  if(!VAPID_PUBLIC){ st.textContent="Les notifications sont presque prêtes : il reste à installer les clés."; return; }
  if(!store || !store.getSub){ st.textContent="Connecte-toi pour activer les notifications."; return; }
  if(Notification.permission==="denied"){ st.textContent="Les notifications sont bloquées pour Allez Hop. Autorise-les dans les réglages du téléphone (Notifications → Allez Hop ou Chrome)."; return; }
  const sub = await (await getReg()).pushManager.getSubscription();
  let doc=null; if(sub){ try{ doc=await store.getSub(await subId(sub)); }catch(e){} }
  const h = (doc && doc.heure) || "07:00";
  box.hidden=false;
  $("push-h").innerHTML=heures(h);
  $("push-quand").textContent=pourQuand(h);
  if(!sub || !doc){
    st.textContent="Chaque jour d'école : le jour du cycle, les spécialistes, quoi apporter, les rappels et la météo.";
    act.innerHTML=`<button type="button" class="btn primary" id="push-on">Activer les notifications</button>`;
    $("push-on").addEventListener("click", ()=>enablePush($("push-h").value));
    return;
  }
  paintPushOptions(sub, doc);
  if(enPause(doc)){
    st.textContent = doc.actif===false ? "En pause : aucune notification sur ce téléphone." : "En pause aujourd'hui : elles reprennent demain.";
    act.innerHTML=`<button type="button" class="btn primary" id="push-reprendre">Reprendre</button><button type="button" class="btn ghost" id="push-off">Désactiver</button>`;
    $("push-reprendre").addEventListener("click", async ()=>{ await reglerPause(sub, false); paintPush(); });
  } else {
    st.textContent=`Activées sur ce téléphone, vers ${hFr(h)}.`;
    act.innerHTML=`<button type="button" class="btn outline" id="push-test">Envoyer un test</button><button type="button" class="btn ghost" id="push-pause">Pause aujourd'hui</button><button type="button" class="btn ghost" id="push-off">Désactiver</button>`;
    $("push-pause").addEventListener("click", async ()=>{ await reglerPause(sub, "jour"); paintPush(); });
  }
  if($("push-test")) $("push-test").addEventListener("click", async ()=>{
    const inf=infoFor(todayKey()), sp=inf.kind==="ecole"?specialsOf(inf.jour):[];
    await (await getReg()).showNotification(inf.kind==="ecole"?`${ENFANT.prenom} · Jour ${inf.jour}`:`${ENFANT.prenom} · Pas d'école`, {
      body: sp.length ? sp.map(s=>`${s.nom} ${PERIODES[s.p]}`).join(" · ") : (inf.label||"Aucun spécialiste aujourd'hui"),
      icon:"icons/icon-192.png", tag:"test" });
    // L'iPhone n'affiche pas les notifications d'une app ouverte à l'écran : on le dit.
    toast(isIOS ? "Test envoyé. Sur iPhone, il n'apparaît pas quand l'app est ouverte : regardez le centre de notifications." : "Test envoyé");
  });
  $("push-off").addEventListener("click", async ()=>{
    try{ await store.delSub(await subId(sub)); }catch(e){}
    await sub.unsubscribe(); toast("Notifications désactivées"); paintPush(); paintNotifRow();
  });
}
// Changer l'heure : enregistrée tout de suite si le téléphone est déjà abonné
$("push-h").addEventListener("change", async ()=>{
  const h=$("push-h").value; $("push-quand").textContent=pourQuand(h);
  const sub = await (await getReg()).pushManager.getSubscription(); if(!sub) return;
  try{ await store.saveSub(await subId(sub), {heure:h}); toast("Heure enregistrée : "+hFr(h)); paintPush(); }
  catch(e){ toast("L'heure n'a pas pu être enregistrée. Réessaie."); }
});
// Options de ce téléphone : jours sans école, alertes avant les activités choisies
function paintPushOptions(sub, doc){
  const box=$("push-options"), acts=activites(), choisies=new Set(doc.alertes||[]), avance=doc.avance ?? 60;
  let h=`<label class="opt"><input type="checkbox" id="po-conges" ${doc.conges!==false?"checked":""}><span>Aussi les jours sans école<small>Fins de semaine et congés, s'il y a un rappel ou une activité</small></span></label>`;
  if(acts.length){
    h+=`<div class="opt-h">Avant une activité</div>`;
    h+=acts.map(a=>`<label class="opt"><input type="checkbox" data-alerte="${esc(a.id)}" ${choisies.has(a.id)?"checked":""}><span>${esc(a.titre)}<small>${(a.jours||[]).map(j=>JOURS[j]).join(", ")} à ${heureFr(a.debut)}</small></span></label>`).join("");
    h+=`<select id="po-avance" aria-label="Combien de temps avant">${[[30,"30 min avant"],[60,"1 h avant"],[120,"2 h avant"],[180,"3 h avant"]].map(([v,l])=>`<option value="${v}" ${v===avance?"selected":""}>${l}</option>`).join("")}</select>`;
  } else h+=`<p class="note">Ajoutez une activité (karaté, soccer…) avec le bouton + pour recevoir une alerte avant.</p>`;
  box.innerHTML=h; box.hidden=false;
  const sauver=async(champs,msg)=>{ try{ await store.saveSub(await subId(sub), champs); toast(msg); }catch(e){ toast("Pas pu enregistrer. Réessayez."); } };
  $("po-conges").addEventListener("change", e=>sauver({conges:e.target.checked}, e.target.checked?"Notifications aussi les jours sans école":"Plus de notification les jours sans école"));
  box.querySelectorAll("[data-alerte]").forEach(c=>c.addEventListener("change", ()=>{
    const ids=[...box.querySelectorAll("[data-alerte]:checked")].map(x=>x.dataset.alerte);
    sauver({alertes:ids}, c.checked?"Alerte ajoutée":"Alerte retirée");
  }));
  const av=$("po-avance"); if(av) av.addEventListener("change", ()=>sauver({avance:+av.value}, "Alerte "+av.selectedOptions[0].textContent));
}
// Pause : « jour » = aujourd'hui seulement ; true = jusqu'à ce qu'on la retire ; false = reprendre
const enPause = doc => !!doc && (doc.actif===false || doc.pauseLe===todayKey());
async function reglerPause(sub, p){
  const champs = p==="jour" ? {actif:true, pauseLe:todayKey()} : p ? {actif:false, pauseLe:null} : {actif:true, pauseLe:null};
  try{ await store.saveSub(await subId(sub), champs); toast(p==="jour"?"Pause pour aujourd'hui":p?"Notifications en pause":"Notifications reprises"); }
  catch(e){ toast("Pas pu enregistrer. Réessayez."); }
}
// Rangée « Notifications » du menu : état en un coup d'œil + interrupteur
async function etatNotif(){
  if(isIOS && !installed) return {dispo:false, txt:"Ouvrez Allez Hop par son icône pour les activer"};
  if(!pushOK) return {dispo:false, txt:"Pas offertes dans ce navigateur"};
  if(!store || !store.getSub) return {dispo:false, txt:"Connectez-vous pour les activer"};
  if(Notification.permission==="denied") return {dispo:false, txt:"Bloquées dans les réglages du téléphone"};
  const sub=await (await getReg()).pushManager.getSubscription();
  let doc=null; if(sub){ try{ doc=await store.getSub(await subId(sub)); }catch(e){} }
  if(!sub || !doc) return {dispo:true, on:false, sub, txt:"Désactivées"};
  if(enPause(doc)) return {dispo:true, on:false, sub, doc, txt: doc.actif===false ? "En pause" : "En pause aujourd'hui"};
  return {dispo:true, on:true, sub, doc, txt:"Activées · "+hFr(doc.heure||"07:00")};
}
let etatCourant=null;
async function paintNotifRow(){
  const sw=$("c-notif-sw"), t=$("c-notif-etat");
  try{ etatCourant=await etatNotif(); }catch(e){ etatCourant={dispo:false, txt:""}; }
  t.textContent=etatCourant.txt; sw.checked=!!etatCourant.on; sw.disabled=!etatCourant.dispo;
}
$("c-notif-sw").addEventListener("change", async e=>{
  const on=e.target.checked, et=etatCourant||{};
  if(on){
    if(et.doc) await reglerPause(et.sub, false);
    else await enablePush((et.doc && et.doc.heure) || "07:00");
  } else if(et.sub) await reglerPause(et.sub, true);
  paintNotifRow();
});
// Le menu s'ouvre de plusieurs endroits : on met la rangée à jour chaque fois qu'il apparaît
new MutationObserver(()=>{ if(!$("compte").hidden) paintNotifRow(); }).observe($("compte"), {attributes:true, attributeFilter:["hidden"]});
async function enablePush(heure){
  const st=$("push-state");
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){ paintPush(); return; }
    const reg=await getReg();
    const sub=(await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToBytes(VAPID_PUBLIC)});
    await store.saveSub(await subId(sub), {abonnement:sub.toJSON(), heure, actif:true, appareil:isIOS?"iPhone":/Android/.test(navigator.userAgent)?"Android":"Autre"});
    toast("Notifications activées");
  }catch(e){ st.textContent="L'activation n'a pas fonctionné. Ferme l'app, rouvre-la et réessaie."; return; }
  paintPush();
}

/* ---------- Calendrier (.ics) ---------- */
const info=$("info");
$("c-notifs").addEventListener("click", ()=>{ $("compte").hidden=true; $("btn-info").click(); });
$("btn-info").addEventListener("click", ()=>{ info.hidden=false; paintPush(); });
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

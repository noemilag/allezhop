/* Allez Hop : la fiche du jour de l'enfant. Ses données viennent de Firebase après la connexion (voir school.js). */
import { CYCLE, CYCLE_OF, END, ENFANT, EVENTS, FIRST, FREEZING, JOURS, LAST, LAT, LON, METEO_URL, MOIS, OFF, PERIODES, SAISON, SUBJ, WX_URL, addDays, cap, chargerEnfant, codeEmoji, daysFromToday, deg, habits, hr, infoFor, key, longDate, nextSchoolDay, parse, precipShort, ranges, specialsOf, summarize, todayKey, validerEnfant, wxSub, CONGES } from "./school.js?v=202610300939";


/* ---------- Version : à changer à chaque mise en ligne (voir bump.sh) ---------- */
const VERSION = "202610300939";
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
// Le « o » souriant du mot Hop du logo, pour écrire « Congé »
const O_HOP=`<svg class="o-hop" viewBox="256 275 196 201" aria-hidden="true"><path fill="currentColor" d="M381,279c.6.2,1.2.3,1.8.5,22.2,6.6,42.9,22,54.3,42.3,4.6,8.4,8.5,16.9,11,26.2.2.8.4,1.5.6,2.3,3.4,14.1,3.1,29.6.4,43.7-.1.6-.2,1.2-.4,1.9-5,24.3-19.5,46.2-39.4,60.9-1.7,1.1-3.5,2.2-5.2,3.2-.6.4-1.2.7-1.8,1.1-22.2,13-46.7,17.8-72,11.7-14.1-3.7-27-10.4-38.2-19.8-.7-.6-1.5-1.2-2.2-1.8-19.2-16-30.9-41.1-33.5-65.7-2.2-26.9,6.7-53.3,23.8-74,25.3-29.1,62.7-43.8,100.9-32.5ZM291,375.8c-1.6,5.1-2.2,9.4,0,14.4,10.4,16.8,27.9,27.5,46.8,32.2,21.2,3.4,41.3-1.2,59-13.3,2.1-1.6,4.2-3.3,6.2-5.1.5-.4,1.1-.8,1.6-1.2,5.2-4,10.3-9.5,12.4-15.8.5-4.4.7-8.5-1.6-12.3-3-3.8-5.9-6.3-10.8-7.1-5.6-.2-9.4.6-13.6,4.4q-.3.3-1.7,1.6c-11.1,10.3-25,15.1-40.1,14.7-12.5-1.1-23.9-6.3-32.4-15.5-3.4-3.5-6.8-4.9-11.6-5.3-6.1.3-10.6,3.4-14.1,8.2Z"/></svg>`;
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
  h+= school ? `<span class="j" aria-label="Jour ${inf.jour} du cycle"><small>Jour</small><b>${inf.jour}</b></span>` : `<span class="j conge" aria-label="Congé${inf.kind==="weekend"?"":" : "+esc(inf.label||"")}"><i>C</i>${O_HOP}<i>n</i><i>g</i><i>é</i></span>`;
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
  const W=innerWidth, H=innerHeight;
  const bat=document.createElement("div");
  bat.className="chauve-souris"; bat.setAttribute("aria-hidden","true");
  bat.innerHTML=`<svg viewBox="0 0 120 60"><g class="aile g"><path d="M60 30 C50 14 34 8 6 12 C16 18 18 24 14 30 C24 26 30 30 32 36 C38 30 46 30 50 36 C52 32 56 31 60 30Z"/></g><g class="aile d"><path d="M60 30 C70 14 86 8 114 12 C104 18 102 24 106 30 C96 26 90 30 88 36 C82 30 74 30 70 36 C68 32 64 31 60 30Z"/></g><ellipse cx="60" cy="31" rx="7" ry="10"/><path d="M54 23 L55 15 L58 21 Z M66 23 L65 15 L62 21 Z"/><circle cx="57.5" cy="28" r="1.4" fill="#FFB547"/><circle cx="62.5" cy="28" r="1.4" fill="#FFB547"/></svg>`;
  document.body.appendChild(bat);
  // Vol en vagues, de la gauche vers la droite, en remontant un peu
  const pts=[];
  for(let i=0;i<=12;i++){ const t=i/12; pts.push({transform:`translate(${-120+t*(W+240)}px, ${H*.62-t*H*.38+Math.sin(t*Math.PI*3)*40}px) rotate(${Math.cos(t*Math.PI*3)*12}deg) scale(${.8+t*.35})`}); }
  bat.animate(pts,{duration:6500,easing:"ease-in-out",fill:"forwards"}).onfinish=()=>bat.remove();
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

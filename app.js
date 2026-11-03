import * as pdfjsLib from '/pdf.mjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB9Gy4Fb66CMy_hagReGHcKZ6JRJFq9n84',
  authDomain: 'nebula-5ddcc.firebaseapp.com',
  projectId: 'nebula-5ddcc',
  storageBucket: 'nebula-5ddcc.firebasestorage.app',
  messagingSenderId: '548164886149',
  appId: '1:548164886149:web:8101694589444619c613ec'
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const teacherEmails = new Set(['jpege@antonibrusi.cat','mlcastellano@antonibrusi.cat']);
const DEFAULT_MISSIONS = [
 {id:'signal',order:1,active:true,title:'Desxifrar el senyal',icon:'⌁',story:'Una transmissió desconeguda arriba a la nau. Una micro:bit envia el senyal i una altra l’ha de rebre i interpretar.',objective:'Configurar dues micro:bits amb el mateix grup de ràdio, enviar un missatge codificat i desxifrar-lo.',makecodeUrl:'https://makecode.microbit.org/',pdfUrl:'/signal.pdf',pageCount:7,steps:[]},
 {id:'light',order:2,active:true,title:'Seguir la llum',icon:'◉',story:'Els exploradors detecten una font d’energia amagada. Només es pot localitzar observant com canvia la llum.',objective:'Llegir el nivell de llum de la micro:bit i prendre una decisió amb una condició.',makecodeUrl:'https://makecode.microbit.org/',pdfUrl:'/light.pdf',pageCount:7,steps:[]},
 {id:'rocks',order:3,active:true,title:'Travessar el camp de roques',icon:'⬡',story:'El Cutebot ha de creuar una zona plena de roques sense rebre cap impacte.',objective:'Mesurar la distància amb l’ultrasònic i fer que el Cutebot eviti els obstacles.',makecodeUrl:'https://makecode.microbit.org/',pdfUrl:'/rocks.pdf',pageCount:7,steps:[]},
 {id:'base',order:4,active:true,title:'Arribar a la base',icon:'⇥',story:'Una línia lluminosa marca l’únic camí segur fins a la base alienígena.',objective:'Programar els sensors del Cutebot perquè segueixi una línia de manera autònoma.',makecodeUrl:'https://makecode.microbit.org/',pdfUrl:'/base.pdf',pageCount:7,steps:[]}
];
async function teamEmail(name){
  const normalized=String(name||'').trim().toLocaleLowerCase('ca-ES').normalize('NFKC');
  const bytes=new TextEncoder().encode(normalized);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `team-${hex.slice(0,40)}@nebula.local`;
}
async function ensureStudentAuth(name,password,create=false){
  const email=await teamEmail(name);
  await auth.authStateReady();
  if(auth.currentUser) await signOut(auth);
  try {
    return (await (create ? createUserWithEmailAndPassword(auth,email,password) : signInWithEmailAndPassword(auth,email,password))).user;
  } catch(error) {
    if(error?.code==='auth/email-already-in-use') throw new Error('Aquest equip ja existeix. Trieu «Iniciar sessió» per recuperar el progrés.');
    if(error?.code==='auth/weak-password') throw new Error('La contrasenya ha de tenir com a mínim 6 caràcters.');
    if(error?.code==='auth/too-many-requests') throw new Error('Hi ha hagut massa intents. Espereu uns minuts abans de tornar-ho a provar.');
    throw new Error(create ? 'No s’ha pogut crear l’equip. Comproveu la connexió i torneu-ho a provar.' : 'No s’ha pogut entrar. Comproveu el nom i la contrasenya. Si és el primer cop, trieu «Crear un equip».');
  }
}
async function teacherAuth(){ const result=await signInWithPopup(auth,new GoogleAuthProvider()); if(!teacherEmails.has(result.user.email||'')){ await signOut(auth); throw new Error('Aquest compte no està autoritzat com a docent.'); } return result.user; }

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const session = { config: null, team: JSON.parse(sessionStorage.getItem('nebula-team') || 'null'), teacherToken: sessionStorage.getItem('nebula-teacher') || '', mission: null, page: 1, pdf: null, teacherTab: 'missions', editing: null, validationPoll: null, celebrationOpen: false, teacherUnsubscribe: null };
const missionCinematics = {
  signal: '/signal-narrat.mp4',
  light: '/light-narrat.mp4',
  rocks: '/rocks-narrat.mp4',
  base: '/base-rescat-narrat.mp4'
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 2800); }
async function api(url, options = {}) {
  const method=(options.method||'GET').toUpperCase();
  const body=options.body instanceof FormData ? options.body : (options.body ? JSON.parse(options.body) : {});
  if(url==='/api/state') return {title:'Expedició Nèbula',missions:DEFAULT_MISSIONS};
  if((url==='/api/team/login' || url==='/api/team/register') && method==='POST'){
    const name=String(body.name||'').trim(); const password=String(body.password||'');
    if(name.length<2 || password.length<6) throw new Error('Escriviu un nom d’equip i una contrasenya de 6 caràcters com a mínim.');
    const creating=url==='/api/team/register';
    const user=await ensureStudentAuth(name,password,creating);
    const ref=doc(db,'teams',user.uid); const snap=await getDoc(ref);
    if(!snap.exists() && !creating) throw new Error('No s’ha trobat el grup. Demaneu ajuda al docent.');
    if(!snap.exists()) await setDoc(ref,{ownerUid:user.uid,name,completed:[],currentMission:null,currentPage:1,updatedAt:new Date().toISOString()});
    else await updateDoc(ref,{name,updatedAt:new Date().toISOString()});
    return {team:{id:user.uid,...(await getDoc(ref)).data()}};
  }
  if(url.startsWith('/api/team/') && method==='GET'){
    const id=decodeURIComponent(url.split('/').pop()); const snap=await getDoc(doc(db,'teams',id)); if(!snap.exists()) throw new Error('Equip no trobat.'); return {team:{id:snap.id,...snap.data()}};
  }
  if(url==='/api/team/progress' && method==='POST'){
    await updateDoc(doc(db,'teams',body.teamId),{currentMission:body.missionId,currentPage:Math.max(1,Number(body.page||1)),updatedAt:new Date().toISOString()}); return {ok:true};
  }
  if(url==='/api/team/request-validation' && method==='POST'){
    if(!auth.currentUser || auth.currentUser.uid!==body.teamId) throw new Error('Cal iniciar sessió amb aquest equip.');
    const mission=DEFAULT_MISSIONS.find(m=>m.id===body.missionId && m.active);
    if(!mission) throw new Error('Missió no disponible.');
    const ref=doc(db,'teams',body.teamId), snap=await getDoc(ref);
    if(!snap.exists()) throw new Error('Equip no trobat.');
    const team=snap.data(), index=DEFAULT_MISSIONS.findIndex(m=>m.id===mission.id);
    if((team.completed||[]).includes(mission.id)) return {ok:true};
    if(DEFAULT_MISSIONS.slice(0,index).some(m=>!(team.completed||[]).includes(m.id))) throw new Error('Aquesta missió encara està bloquejada.');
    if(team.validationRequest?.missionId!==mission.id) await updateDoc(ref,{validationRequest:{missionId:mission.id,requestedAt:new Date().toISOString()},updatedAt:new Date().toISOString()});
    return {ok:true};
  }
  if(url==='/api/teacher/login' && method==='POST'){ const u=await teacherAuth(); session.teacherToken=u.email; return {token:u.email}; }
  const teacher=auth.currentUser; if(!teacher || !teacherEmails.has(teacher.email||'')) throw new Error('Cal iniciar sessió com a docent.');
  if(url==='/api/teacher/dashboard'){
    const snaps=await getDocs(collection(db,'teams')); return {missions:DEFAULT_MISSIONS,teams:snaps.docs.map(d=>({id:d.id,...d.data()}))};
  }
  if(url==='/api/teacher/validate' && method==='POST'){ const ref=doc(db,'teams',body.teamId),snap=await getDoc(ref); if(!snap.exists()) throw new Error('Equip no trobat.'); const completed=snap.data().completed||[]; if(!completed.includes(body.missionId)) completed.push(body.missionId); await updateDoc(ref,{completed,...(snap.data().validationRequest?.missionId===body.missionId ? {validationRequest:null} : {}),updatedAt:new Date().toISOString()}); return {ok:true}; }
  if(url==='/api/teacher/team/reset' && method==='POST'){ await updateDoc(doc(db,'teams',body.teamId),{completed:[],validationRequest:null,currentMission:null,currentPage:1,updatedAt:new Date().toISOString()}); return {ok:true}; }
  if(url.startsWith('/api/teacher/team/') && method==='DELETE'){ await deleteDoc(doc(db,'teams',decodeURIComponent(url.split('/').pop()))); return {ok:true}; }
  if(url.startsWith('/api/teacher/mission')) throw new Error('L’edició de missions online s’activarà en una fase posterior.');
  if(url==='/api/teacher/pin') return {ok:true};
  throw new Error('Acció no disponible.');
}
async function refreshConfig() { session.config = await api('/api/state'); }
function teamProgress() { return session.team?.completed?.length || 0; }
function saveTeamSession() { sessionStorage.setItem('nebula-team', JSON.stringify(session.team)); }

function startTeamPolling() {
  if (session.validationPoll) clearInterval(session.validationPoll);
  if (!session.team || session.teacherToken) return;
  session.validationPoll = setInterval(() => refreshTeam(true), 1500);
}

async function refreshTeam(showCelebration = false) {
  if (!session.team || session.teacherToken) return;
  try {
    const previous = new Set(session.team.completed || []);
    const data = await api(`/api/team/${encodeURIComponent(session.team.id)}`);
    const newlyCompleted = (data.team.completed || []).filter(id => !previous.has(id));
    session.team = data.team; saveTeamSession();
    if (showCelebration && newlyCompleted.length && !session.celebrationOpen) showMissionCelebration(newlyCompleted.at(-1));
  } catch {}
}

function showMissionCelebration(missionId) {
  const completedMission = session.config.missions.find(m => m.id === missionId);
  const completedIndex = session.config.missions.findIndex(m => m.id === missionId);
  const nextMission = session.config.missions[completedIndex + 1];
  const cinematicUrl = missionCinematics[missionId] || (nextMission ? '' : '/final.mp4');
  session.celebrationOpen = true;
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<div class="dialog-body celebration"><div class="celebration-icon">✓</div><div class="eyebrow">Missió validada</div><h2>Bona feina!</h2><p>Heu superat <strong>${esc(completedMission?.title || 'la missió')}</strong>. ${nextMission ? 'La ruta cap a la missió següent ja està preparada.' : 'Heu completat tota l’expedició!'}</p></div><div class="dialog-actions"><button class="btn" id="watchCinematic">${cinematicUrl ? 'Veure la cinemàtica →' : nextMission ? 'Obrir la missió següent →' : 'Veure el progrés final'}</button></div>`;
  document.body.append(dialog); dialog.showModal();
  document.querySelector('#watchCinematic').onclick = async () => {
    if (!cinematicUrl) {
      dialog.close();
      if (nextMission) await openMission(nextMission.id); else missionGrid();
      return;
    }
    dialog.innerHTML = `<div class="cinematic-stage"><video id="missionCinematic" src="${cinematicUrl}" autoplay playsinline controls></video></div><div class="dialog-actions cinematic-actions"><span id="cinematicStatus">Cinemàtica en curs…</span><button class="btn" id="continueMission" disabled>${nextMission ? 'Continuar amb la missió següent →' : 'Veure el progrés final'}</button></div>`;
    const video = dialog.querySelector('#missionCinematic');
    video.volume = 1;
    const continueButton = dialog.querySelector('#continueMission');
    const unlockContinue = () => {
      continueButton.disabled = false;
      dialog.querySelector('#cinematicStatus').textContent = nextMission ? 'Missió següent desbloquejada' : 'Expedició completada';
    };
    video.addEventListener('ended', unlockContinue, { once: true });
    video.addEventListener('error', unlockContinue, { once: true });
    continueButton.onclick = async () => {
      dialog.close();
      if (nextMission) await openMission(nextMission.id); else missionGrid();
    };
  };
  dialog.addEventListener('close', () => { session.celebrationOpen = false; dialog.remove(); });
}

function loginView(create=false) {
  stopTeacherNotifications();
  app.innerHTML = `<main class="screen login"><section class="login-shell"><div class="login-art"><div class="logo"><span class="logo-mark">N</span> AULA MAKER</div><h1>EXPEDICIÓ<br><span>NÈBULA</span></h1><p>Una aventura de programació, robòtica i descobriment. Cada equip avançarà pas a pas fins a arribar a la base.</p></div><form class="login-form" id="teamLogin"><div class="eyebrow">Identificació</div><div class="tabs"><button type="button" class="btn ${create ? 'secondary' : ''}" id="chooseLogin" aria-pressed="${!create}">Iniciar sessió</button><button type="button" class="btn ${create ? '' : 'secondary'}" id="chooseRegister" aria-pressed="${create}">Crear un equip</button></div><h2>${create ? 'Creeu el vostre equip' : 'Torneu a l’expedició'}</h2><p class="muted">${create ? 'Només el primer cop: trieu un nom únic i una contrasenya per al grup. Guardeu-los per tornar a entrar.' : 'Entreu amb el nom i la contrasenya del vostre equip per continuar el progrés.'}</p><input type="hidden" name="mode" value="${create ? 'register' : 'login'}"><label class="field">Nom de l’equip<input name="name" required maxlength="48" autocomplete="username" placeholder="Exemple: Equip Orió"></label><label class="field">Contrasenya de l’equip<input name="password" type="password" minlength="6" maxlength="24" required autocomplete="${create ? 'new-password' : 'current-password'}"></label>${create ? '<label class="field">Repetiu la contrasenya<input name="confirmPassword" type="password" required autocomplete="new-password"></label>' : ''}<p class="error" id="loginError"></p><button class="btn" type="submit">${create ? 'Crear equip i començar' : 'Iniciar sessió'}</button><button class="btn secondary" type="button" id="teacherAccess">Accés docent</button></form></section></main>`;
  document.querySelector('#teamLogin').onsubmit = loginTeam;
  document.querySelector('#chooseLogin').onclick=()=>loginView(false);
  document.querySelector('#chooseRegister').onclick=()=>loginView(true);
  document.querySelector('#teacherAccess').onclick = teacherLoginDialog;
}

async function loginTeam(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const submit=event.currentTarget.querySelector('[type="submit"]'); submit.disabled=true;
  try {
    const creating=form.get('mode')==='register';
    if(creating && form.get('password')!==form.get('confirmPassword')) throw new Error('Les contrasenyes no coincideixen.');
    const data = await api(creating ? '/api/team/register' : '/api/team/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    session.team = data.team; saveTeamSession(); startTeamPolling(); introView();
  } catch (error) { document.querySelector('#loginError').textContent = error.message; submit.disabled=false; }
}

function header() {
  return `<header class="app-header"><div class="brand"><span class="logo-mark">N</span><span>EXPEDICIÓ NÈBULA</span></div><div class="team-box"><span class="team-name">${esc(session.team.name)}</span><button class="btn secondary" id="progressBtn">Progrés</button><button class="btn secondary" id="logoutTeam">Tancar sessió</button></div></header>`;
}

function introView() {
  app.innerHTML = `<section class="film"><video id="introVideo" src="/expedicio-nebula-intro.mp4" autoplay playsinline controls></video><div class="film-controls"><button class="btn secondary" id="skipFilm">Ometre</button><button class="btn" id="startMissions">Començar la missió →</button></div></section>`;
  document.querySelector('#introVideo').addEventListener('ended', missionGrid, { once: true });
  document.querySelector('#skipFilm').onclick = missionGrid;
  document.querySelector('#startMissions').onclick = missionGrid;
}

function missionGrid() {
  session.mission = null; session.pdf = null;
  const missions = session.config.missions;
  app.innerHTML = `<section class="screen">${header()}<main class="main"><div class="topline"><div><div class="eyebrow">Mapa de l’expedició</div><h1>Progrés de l’equip</h1></div><div class="progress-pill">${teamProgress()} / ${missions.length} missions</div></div><section class="mission-grid">${missions.map((m, index) => {
    const done = session.team.completed.includes(m.id); const locked = index > teamProgress();
    return `<article class="mission-card ${done ? 'done' : ''} ${locked ? 'locked' : ''}"><div class="status">${done ? 'Superada' : locked ? 'Bloquejada' : 'Disponible'}</div><div class="mission-icon">${esc(m.icon)}</div><h3>${esc(m.title)}</h3><p>${esc(m.story)}</p><button class="btn ${done ? 'secondary' : ''}" data-mission="${esc(m.id)}" ${locked ? 'disabled' : ''}>${done ? 'Revisar' : 'Començar'} →</button></article>`;
  }).join('')}</section></main></section>`;
  bindHeader(); document.querySelectorAll('[data-mission]').forEach(button => button.onclick = () => openMission(button.dataset.mission));
}

async function logoutTeam() {
  if (session.validationPoll) { clearInterval(session.validationPoll); session.validationPoll = null; }
  session.team = null;
  session.teacherToken = '';
  session.mission = null;
  session.pdf = null;
  session.celebrationOpen = false;
  sessionStorage.removeItem('nebula-team');
  sessionStorage.removeItem('nebula-teacher');
  try { await signOut(auth); } catch (error) { console.error('Error en tancar sessió', error); }
  loginView();
}
function bindHeader() {
  document.querySelector('#progressBtn')?.addEventListener('click', missionGrid);
  document.querySelector('#logoutTeam')?.addEventListener('click', logoutTeam);
}
async function openMission(id) {
  session.mission = session.config.missions.find(m => m.id === id); session.page = Math.max(1, session.team.currentMission === id ? Number(session.team.currentPage || 1) : 1); session.pdf = null;
  await renderMission();
}

async function renderMission() {
  const m = session.mission; const total = m.pdfUrl ? Math.max(1, m.pageCount || 1) : Math.max(1, m.steps?.length || 1); session.page = Math.min(session.page, total);
  app.innerHTML = `<section class="screen">${header()}<main class="main"><div class="mission-head"><div><div class="eyebrow">Missió ${String(m.order).padStart(2, '0')}</div><h1>${esc(m.title)}</h1><p class="brief">${esc(m.story)}</p></div><div class="progress-pill">Pas ${session.page} de ${total}</div></div><div class="objective"><strong>Objectiu</strong>${esc(m.objective)}</div><section class="pdf-stage"><div class="viewer"><div class="viewer-toolbar"><strong>Guia de la missió</strong><div class="page-nav"><button class="btn secondary" id="prevPage" ${session.page <= 1 ? 'disabled' : ''}>←</button><span>${session.page} / ${total}</span><button class="btn secondary" id="nextPage" ${session.page >= total ? 'disabled' : ''}>→</button></div></div><div class="pdf-canvas-wrap" id="pageContent">${m.pdfUrl ? '<div class="loader"></div>' : `<article class="text-step"><div class="step-no">PAS ${session.page}</div><p>${esc(m.steps?.[session.page - 1] || 'Seguiu les indicacions del mestre.')}</p></article>`}</div></div><aside class="side-stack"><div class="panel"><h3>Progrés</h3><div class="progress-track"><span style="width:${session.page / total * 100}%"></span></div><p class="small">Completeu un pas abans d’avançar al següent.</p></div><div class="panel"><h3>Programa</h3><p class="small">Obriu MakeCode en una pestanya nova.</p><a class="btn" href="${esc(m.makecodeUrl || 'https://makecode.microbit.org/')}" target="_blank" rel="noopener">Obrir MakeCode ↗</a></div><div class="panel"><h3>Final de la missió</h3><p class="small">Quan tot funcioni, demaneu al mestre que validi el resultat des del seu panell.</p>${session.team.completed.includes(m.id) ? '<div class="complete-banner">Missió validada ✓</div>' : `<button class="btn secondary" id="requestValidation" ${session.team.validationRequest?.missionId===m.id ? 'disabled' : ''}>${session.team.validationRequest?.missionId===m.id ? 'Petició enviada · Esperant el mestre' : 'Avisar el mestre'}</button>`}</div></aside></section></main></section>`;
  bindHeader(); document.querySelector('#prevPage').onclick = () => changePage(-1); document.querySelector('#nextPage').onclick = () => changePage(1);
  document.querySelector('#requestValidation')?.addEventListener('click', async (event) => { const button=event.currentTarget; button.disabled=true; try { await api('/api/team/request-validation',{method:'POST',body:JSON.stringify({teamId:session.team.id,missionId:m.id})}); session.team.validationRequest={missionId:m.id}; saveTeamSession(); button.textContent='Petició enviada · Esperant el mestre'; toast('Hem avisat el mestre.'); } catch(error) { button.disabled=false; toast(error.message); } });
  if (m.pdfUrl) await drawPdfPage();
}

async function drawPdfPage() {
  const wrap = document.querySelector('#pageContent');
  try {
    if (!session.pdf) session.pdf = await pdfjsLib.getDocument(session.mission.pdfUrl).promise;
    if (session.mission.pageCount !== session.pdf.numPages) session.mission.pageCount = session.pdf.numPages;
    session.page = Math.min(session.page, session.pdf.numPages);
    const page = await session.pdf.getPage(session.page); const base = page.getViewport({ scale: 1 }); const max = Math.min(1250, wrap.clientWidth - 36); const scale = Math.max(.45, max / base.width); const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height; canvas.setAttribute('aria-label', `Pàgina ${session.page} de la missió`); wrap.replaceChildren(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (error) { wrap.innerHTML = `<div class="empty">No s’ha pogut mostrar el PDF.<br>${esc(error.message)}</div>`; }
}

async function changePage(delta) {
  const total = session.mission.pdfUrl ? session.pdf?.numPages || session.mission.pageCount : session.mission.steps.length;
  session.page = Math.max(1, Math.min(total, session.page + delta));
  await api('/api/team/progress', { method: 'POST', body: JSON.stringify({ teamId: session.team.id, missionId: session.mission.id, page: session.page }) });
  session.team.currentMission = session.mission.id; session.team.currentPage = session.page; sessionStorage.setItem('nebula-team', JSON.stringify(session.team)); await renderMission();
}

function teacherLoginDialog() {
  const dialog=document.createElement('dialog');
  dialog.innerHTML=`<div class="dialog-body"><div class="eyebrow">Accés docent</div><h2>Panell del mestre</h2><p class="muted">Inicieu sessió amb un dels comptes @antonibrusi.cat autoritzats.</p><p class="error" id="pinError"></p></div><div class="dialog-actions"><button class="btn secondary" id="cancelTeacher">Cancel·lar</button><button class="btn" id="teacherLoginBtn">Entrar amb Google</button></div>`;
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('#cancelTeacher').onclick=()=>dialog.close(); dialog.addEventListener('close',()=>dialog.remove());
  dialog.querySelector('#teacherLoginBtn').onclick=async()=>{ try{ const data=await api('/api/teacher/login',{method:'POST',body:'{}'}); session.teacherToken=data.token; sessionStorage.setItem('nebula-teacher',data.token); dialog.close(); teacherView(); }catch(error){ dialog.querySelector('#pinError').textContent=error.message; } };
}

async function teacherView() {
  stopTeacherNotifications();
  if (session.validationPoll) { clearInterval(session.validationPoll); session.validationPoll = null; }
  let dashboard;
  try { dashboard = await api('/api/teacher/dashboard'); } catch { session.teacherToken = ''; sessionStorage.removeItem('nebula-teacher'); return loginView(); }
  app.innerHTML = `<section class="teacher"><header class="teacher-header"><div class="brand"><span class="logo-mark">N</span><span>PANELL DOCENT</span></div><button class="btn secondary" id="validationBell" type="button">🔔 Validacions · 0</button><button class="btn secondary" id="exitTeacher">Sortir</button></header><main class="teacher-main"><div class="topline"><div><div class="eyebrow">Control de l’expedició</div><h1>${session.teacherTab === 'missions' ? 'Missions' : session.teacherTab === 'teams' ? 'Equips' : 'Configuració'}</h1></div>${session.teacherTab === 'missions' ? '<button class="btn" id="newMission">+ Afegir missió</button>' : ''}</div><section id="validationRequests" aria-live="polite" aria-label="Peticions de validació"></section><nav class="tabs"><button class="btn secondary tab ${session.teacherTab === 'missions' ? 'active' : ''}" data-tab="missions">Missions</button><button class="btn secondary tab ${session.teacherTab === 'teams' ? 'active' : ''}" data-tab="teams">Equips</button><button class="btn secondary tab ${session.teacherTab === 'settings' ? 'active' : ''}" data-tab="settings">Configuració</button></nav><div id="teacherContent">${teacherContent(dashboard)}</div></main></section>`;
  document.querySelector('#exitTeacher').onclick = async () => { stopTeacherNotifications(); session.teacherToken = ''; session.team = null; sessionStorage.removeItem('nebula-teacher'); sessionStorage.removeItem('nebula-team'); await signOut(auth); if (session.validationPoll) { clearInterval(session.validationPoll); session.validationPoll = null; } loginView(); };
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { session.teacherTab = b.dataset.tab; teacherView(); });
  document.querySelector('#newMission')?.addEventListener('click', () => missionEditor(null));
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => missionEditor(dashboard.missions.find(m => m.id === b.dataset.edit)));
  document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => { await api('/api/teacher/mission/toggle', { method: 'POST', body: JSON.stringify({ id: b.dataset.toggle, active: b.dataset.active !== 'true' }) }); teacherView(); });
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if (confirm('Voleu eliminar aquesta missió i el seu PDF?')) { await api(`/api/teacher/mission/${b.dataset.delete}`, { method: 'DELETE' }); await refreshConfig(); teacherView(); } });
  document.querySelectorAll('[data-move]').forEach(b => b.onclick = () => reorderMission(dashboard.missions, b.dataset.move, Number(b.dataset.direction)));
  document.querySelectorAll('[data-validate]').forEach(b => b.onclick = async () => { const [teamId, missionId] = b.dataset.validate.split('|'); await api('/api/teacher/validate', { method: 'POST', body: JSON.stringify({ teamId, missionId }) }); toast('Missió validada.'); teacherView(); });
  document.querySelectorAll('[data-reset-team]').forEach(b => b.onclick = async () => { if (confirm('Voleu reiniciar el progrés d’aquest equip?')) { await api('/api/teacher/team/reset', { method: 'POST', body: JSON.stringify({ teamId: b.dataset.resetTeam }) }); teacherView(); } });
  document.querySelectorAll('[data-delete-team]').forEach(b => b.onclick = async () => {
    const teamName = b.dataset.teamName || 'aquest grup';
    if (!confirm(`Voleu eliminar definitivament el grup «${teamName}» i tot el seu progrés? Aquesta acció no es pot desfer.`)) return;
    await api(`/api/teacher/team/${encodeURIComponent(b.dataset.deleteTeam)}`, { method: 'DELETE' });
    toast('Grup eliminat.');
    teacherView();
  });
  document.querySelector('#pinForm')?.addEventListener('submit', changePin);
  startTeacherNotifications(dashboard);
}

function stopTeacherNotifications() {
  session.teacherUnsubscribe?.(); session.teacherUnsubscribe=null;
}
function pendingValidations(teams, missions) {
  return teams.filter(team=>team.validationRequest && missions.some(m=>m.id===team.validationRequest.missionId && m.active) && !(team.completed||[]).includes(team.validationRequest.missionId))
    .sort((a,b)=>String(a.validationRequest.requestedAt||'').localeCompare(String(b.validationRequest.requestedAt||'')));
}
function startTeacherNotifications(dashboard) {
  if (!document.querySelector('#validationPulseStyle')) {
    const style=document.createElement('style'); style.id='validationPulseStyle';
    style.textContent=`.teacher-header{position:sticky;top:0;z-index:20;gap:12px;flex-wrap:wrap} #validationRequests{scroll-margin-top:110px} @keyframes validationPulse {0%,100% {box-shadow:0 0 0 2px #ffb454,0 0 8px #ffb45444} 50% {box-shadow:0 0 0 4px #ffd780,0 0 26px #ffb454cc}} .validation-pending {animation:validationPulse 1.6s ease-in-out infinite;border-color:#ffb454!important} .validation-groups {color:#ffd780;font-weight:700;margin-top:8px} @media(prefers-reduced-motion:reduce){.validation-pending{animation:none;outline:3px solid #ffb454}}`;
    document.head.append(style);
  }
  const panel=document.querySelector('#validationRequests');
  const bell=document.querySelector('#validationBell');
  bell.onclick=()=>panel.scrollIntoView({behavior:'smooth',block:'start'});
  let known=new Set(), firstRender=true;
  const render=teams=>{
    if(!panel.isConnected) return;
    const pending=pendingValidations(teams,dashboard.missions);
    const keys=new Set(pending.map(t=>`${t.id}|${t.validationRequest.missionId}|${t.validationRequest.requestedAt||''}`));
    const fresh=pending.filter(t=>!known.has(`${t.id}|${t.validationRequest.missionId}|${t.validationRequest.requestedAt||''}`));
    if(!firstRender && fresh.length) toast(`🔔 Demanen validació: ${fresh.map(t=>t.name).join(', ')}`);
    known=keys;firstRender=false;
    bell.textContent=`🔔 Validacions · ${pending.length}`;
    bell.classList.toggle('validation-pending',pending.length>0);
    document.title=pending.length ? `(${pending.length}) Validacions · Nèbula` : 'Expedició Nèbula';
    panel.innerHTML=pending.length ? `<div class="panel" style="border:2px solid #ffb454;margin:16px 0"><h3>🔔 ${pending.length} ${pending.length===1 ? 'equip demana validació' : 'equips demanen validació'}</h3>${pending.map(team=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0"><div><strong>${esc(team.name)}</strong><div>${esc(dashboard.missions.find(m=>m.id===team.validationRequest.missionId)?.title)}</div></div><button class="btn validation-pending" data-pending-validate="${esc(team.id)}|${esc(team.validationRequest.missionId)}">Validar missió</button></div>`).join('')}</div>` : '<p class="small" style="margin:16px 0">Cap petició de validació pendent.</p>';
    document.querySelectorAll('[data-admin-mission]').forEach(card=>{
      const groups=pending.filter(t=>t.validationRequest.missionId===card.dataset.adminMission);
      card.classList.toggle('validation-pending',groups.length>0);
      const label=card.querySelector('.validation-groups');
      label.textContent=groups.length ? `🔔 Demanen validació: ${groups.map(t=>t.name).join(', ')}` : '';
    });
    const tab=document.querySelector('[data-tab="teams"]'); if(tab) tab.textContent=pending.length ? `Equips · 🔔 ${pending.length}` : 'Equips';
    document.querySelectorAll('[data-validate]').forEach(button=>{
      const [id,missionId]=button.dataset.validate.split('|');
      const waiting=pending.some(t=>t.id===id && t.validationRequest.missionId===missionId);
      button.classList.toggle('validation-pending',waiting);
      const title=dashboard.missions.find(m=>m.id===missionId)?.title||missionId;
      button.textContent=`${waiting ? '🔔 ' : button.disabled ? '✓ ' : ''}${title}${waiting ? ' · Demana validació' : ''}`;
    });
  };
  panel.onclick=async event=>{
    const button=event.target.closest('[data-pending-validate]'); if(!button) return;
    const [teamId,missionId]=button.dataset.pendingValidate.split('|'); button.disabled=true;
    try { await api('/api/teacher/validate',{method:'POST',body:JSON.stringify({teamId,missionId})}); toast('Missió validada.'); await teacherView(); }
    catch(error){button.disabled=false;toast(error.message);}
  };
  render(dashboard.teams);
  let stopped=false, refreshing=false;
  const refresh=async()=>{
    if(stopped || refreshing || !panel.isConnected) return;
    refreshing=true;
    try {
      const snapshot=await getDocs(collection(db,'teams'));
      if(!stopped) render(snapshot.docs.map(d=>({id:d.id,...d.data()})));
    } catch(error) {
      if(!stopped && panel.isConnected) panel.innerHTML='<p class="error">No es poden actualitzar els avisos. Es tornarà a intentar automàticament.</p>';
    } finally {refreshing=false;}
  };
  const unsubscribe=onSnapshot(collection(db,'teams'),snapshot=>{
    if(!stopped) render(snapshot.docs.map(d=>({id:d.id,...d.data()})));
  },()=>{refresh();});
  const interval=setInterval(refresh,4000);
  session.teacherUnsubscribe=()=>{stopped=true;unsubscribe();clearInterval(interval);};
}

function teacherContent(data) {
  if (session.teacherTab === 'missions') return `<section class="teacher-grid">${data.missions.map((m, index) => `<article class="teacher-card mission-admin" data-admin-mission="${esc(m.id)}"><div class="order-buttons"><button data-move="${esc(m.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button data-move="${esc(m.id)}" data-direction="1" ${index === data.missions.length - 1 ? 'disabled' : ''}>↓</button></div><div><div class="status">${m.active ? 'Visible' : 'Oculta'}</div><h3>${esc(m.title)}</h3><div class="validation-groups"></div><div class="small">${m.pdf ? `PDF carregat · ${m.pageCount || '?'} pàgines` : `${m.steps?.length || 0} passos de text`}</div></div><div class="admin-actions"><button class="btn secondary" data-edit="${esc(m.id)}">Editar</button><button class="btn secondary" data-toggle="${esc(m.id)}" data-active="${m.active}">${m.active ? 'Ocultar' : 'Activar'}</button><button class="btn danger" data-delete="${esc(m.id)}">Eliminar</button></div></article>`).join('')}</section>`;
  if (session.teacherTab === 'teams') return data.teams.length ? `<section class="teacher-grid">${data.teams.map(team => `<article class="teacher-card"><div class="status">${team.completed.length} missions</div><h3>${esc(team.name)}</h3><p class="small">Última activitat: ${team.updatedAt ? new Date(team.updatedAt).toLocaleString('ca-ES') : '—'}</p><div class="progress-track"><span style="width:${data.missions.length ? team.completed.length / data.missions.length * 100 : 0}%"></span></div><h4>Validació</h4>${data.missions.filter(m => m.active).map(m => `<button class="btn ${team.completed.includes(m.id) ? 'secondary' : ''}" style="width:100%;margin:4px 0" data-validate="${team.id}|${m.id}" ${team.completed.includes(m.id) ? 'disabled' : ''}>${team.completed.includes(m.id) ? '✓ ' : ''}${esc(m.title)}</button>`).join('')}<button class="btn danger" style="width:100%;margin-top:12px" data-reset-team="${team.id}">Reiniciar equip</button><button class="btn danger" style="width:100%;margin-top:8px" data-delete-team="${esc(team.id)}" data-team-name="${esc(team.name)}">Eliminar grup</button></article>`).join('')}</section>` : '<div class="empty">Encara no hi ha cap equip registrat.</div>';
  return `<section class="teacher-card" style="max-width:600px"><h3>Accés docent protegit</h3><p class="muted">Només els comptes Google autoritzats de l'escola poden administrar l'expedició.</p></section>`;
}

async function reorderMission(missions, id, direction) { const ids = missions.map(m => m.id); const from = ids.indexOf(id); const to = from + direction; if (to < 0 || to >= ids.length) return; [ids[from], ids[to]] = [ids[to], ids[from]]; await api('/api/teacher/mission/order', { method: 'POST', body: JSON.stringify({ ids }) }); await refreshConfig(); teacherView(); }
async function changePin(event) { event.preventDefault(); try { await api('/api/teacher/pin', { method: 'POST', body: JSON.stringify({ pin: new FormData(event.currentTarget).get('pin') }) }); toast('PIN actualitzat.'); event.currentTarget.reset(); } catch (error) { toast(error.message); } }

function missionEditor(mission) {
  session.editing = mission;
  const dialog = document.createElement('dialog'); dialog.innerHTML = `<form id="missionForm"><div class="dialog-body upload-form"><div><div class="eyebrow">${mission ? 'Editar missió' : 'Nova missió'}</div><h2>${mission ? esc(mission.title) : 'Afegiu un PDF de Canva'}</h2></div><label class="field">Títol<input name="title" required maxlength="80" value="${esc(mission?.title || '')}"></label><label class="field">Introducció narrativa<textarea name="story" rows="3" maxlength="600">${esc(mission?.story || '')}</textarea></label><label class="field">Objectiu<textarea name="objective" rows="3" maxlength="600">${esc(mission?.objective || '')}</textarea></label><label class="field">Enllaç de MakeCode<input name="makecodeUrl" type="url" value="${esc(mission?.makecodeUrl || 'https://makecode.microbit.org/')}"></label><label class="field">PDF de la missió<input name="pdf" type="file" accept="application/pdf"></label><p class="small">Cada pàgina del PDF es convertirà automàticament en un pas. Si editeu una missió i no adjunteu cap arxiu, es conservarà el PDF actual.</p><label class="checkline"><input name="active" type="checkbox" ${mission?.active !== false ? 'checked' : ''}> Mostrar la missió a l’alumnat</label><p class="error" id="missionError"></p></div><div class="dialog-actions"><button class="btn secondary" type="button" id="cancelMission">Cancel·lar</button><button class="btn" type="submit">Desar la missió</button></div></form>`; document.body.append(dialog); dialog.showModal();
  document.querySelector('#cancelMission').onclick = () => dialog.close(); dialog.addEventListener('close', () => dialog.remove()); document.querySelector('#missionForm').onsubmit = event => saveMission(event, dialog);
}

async function saveMission(event, dialog) {
  event.preventDefault(); const form = new FormData(event.currentTarget); if (session.editing) form.set('id', session.editing.id); form.set('active', form.has('active') ? 'true' : 'false');
  const pdfFile = form.get('pdf');
  if (pdfFile?.size) {
    try { const buffer = await pdfFile.arrayBuffer(); const pdf = await pdfjsLib.getDocument({ data: buffer }).promise; form.set('pageCount', String(pdf.numPages)); } catch { document.querySelector('#missionError').textContent = 'El PDF no és vàlid o no es pot llegir.'; return; }
  }
  try { await api('/api/teacher/mission', { method: 'POST', body: form }); dialog.close(); await refreshConfig(); toast('Missió desada.'); teacherView(); } catch (error) { document.querySelector('#missionError').textContent = error.message; }
}

async function boot() {
  try { await auth.authStateReady(); await refreshConfig(); if (session.teacherToken) return teacherView(); if (session.team) { await refreshTeam(false); startTeamPolling(); return missionGrid(); } loginView(); } catch { app.innerHTML = '<main class="loading"><h2>No s’ha pogut connectar amb el servidor.</h2><p>Comproveu que la finestra del servidor continuï oberta.</p></main>'; }
}
boot();

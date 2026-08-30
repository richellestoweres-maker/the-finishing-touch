// === The Finishing Touch — Contractor checklist definitions ===
//
// This file is PUBLIC. Your repo is public and GitHub Pages serves every
// file in it, so nothing proprietary can live here.
//
// The checklist CONTENT lives in Firestore at checklists/{type}, where your
// security rules only release it to a contractor who is assigned to a job
// and has checked in. This file holds the loader, the UI labels, and the
// shape those documents follow — none of which is secret.
//
// To add or change a checklist, edit seed-checklists.js (which is NOT
// committed) and run it once from your admin console.
//
// Structure of a checklist:
//   tiers      — service levels that change which items appear
//   start[]    — sections done once, at the beginning of the job
//   perRoom[]  — sections repeated in EVERY room on the job's room list
//   rooms[]    — extra items specific to one kind of room
//   end[]      — sections done once, at the end of the job
//
// Structure of an item:
//   id      stable key. NEVER change one after a job has used it, or
//           historical job records lose track of what was ticked.
//   t       { en, es } the item text
//   byTier  { basic, standard, deep } instead of `t`, when the wording
//           itself changes with the service level
//   tiers   [..] show this item only on these tiers
//   photo   'before' | 'after' | 'evidence' — requires a photo to tick
//
// Spanish note: translated for a Houston-area crew and reviewed for
// meaning, not word-for-word. Organizing trade terms (decant, backstock,
// file fold, drop zone) have no clean single-word Spanish equivalent, so
// they are phrased as short instructions instead. Have Maggie read these
// before they go to her team.

export const CHECKLIST_VERSION = 1;

export const PROPRIETARY_NOTICE = {
  en: "Property of The Finishing Touch Co. Issued only to contractors actively performing authorized work. Not to be copied, shared, or used outside Finishing Touch Co. jobs.",
  es: "Propiedad de The Finishing Touch Co. Se entrega únicamente a contratistas que estén realizando trabajo autorizado. No se puede copiar, compartir ni usar fuera de los trabajos de Finishing Touch Co."
};

export const UI = {
  onMyWay:      { en: "I'm on my way",            es: "Voy en camino" },
  arrived:      { en: "I've arrived",             es: "Ya llegué" },
  finished:     { en: "Finished and leaving",     es: "Terminé y me voy" },
  problem:      { en: "Report a problem",         es: "Reportar un problema" },
  addPhoto:     { en: "Add photo",                es: "Agregar foto" },
  photoNeeded:  { en: "Photo required",           es: "Se requiere foto" },
  next:         { en: "Next",                     es: "Siguiente" },
  back:         { en: "Back",                     es: "Atrás" },
  done:         { en: "Done",                     es: "Listo" },
  ofCount:      { en: "of",                       es: "de" },
  whichRooms:   { en: "Which rooms are on today's list?", es: "¿Qué cuartos entran en el trabajo de hoy?" },
  startRoom:    { en: "Start this room",          es: "Empezar este cuarto" },
  roomDone:     { en: "Room complete",            es: "Cuarto terminado" },
  beforePhoto:  { en: "Before photo",             es: "Foto de antes" },
  afterPhoto:   { en: "After photo",              es: "Foto de después" },
  tierLabel:    { en: "Service level",            es: "Nivel de servicio" },
  offline:      { en: "Saved on this phone. Will sync when you have signal.", es: "Guardado en este teléfono. Se enviará cuando haya señal." }
};

export const PROBLEM_KINDS = [
  { id:'damage',      t:{ en:"Something broke or got damaged", es:"Algo se rompió o se dañó" } },
  { id:'access',      t:{ en:"Can't get in / access problem",  es:"No puedo entrar / problema de acceso" } },
  { id:'safety',      t:{ en:"Safety concern",                 es:"Problema de seguridad" } },
  { id:'scope',       t:{ en:"Job is bigger than quoted",      es:"El trabajo es más grande de lo cotizado" } },
  { id:'client',      t:{ en:"Question from the client",       es:"Pregunta del cliente" } },
  { id:'supplies',    t:{ en:"Missing supplies or equipment",  es:"Faltan materiales o equipo" } },
  { id:'other',       t:{ en:"Something else",                 es:"Otra cosa" } }
];

/* ------------------------------------------------------------------ *
 * loading the protected content
 * ------------------------------------------------------------------ */

// Checklists are fetched once per session and held in memory. The run screen
// first records which job it is working, at
// users/{uid}/contractorSettings/activeRun — a path your existing rules
// already let the owner write. The checklists rule reads that marker to
// confirm the reader is on a real job before releasing the SOP.
const _cache = new Map();

export async function loadChecklist(type, jobId, db, fs) {
  const key = String(type || 'organizing').toLowerCase();
  if (_cache.has(key)) return _cache.get(key);

  const { doc, getDoc, setDoc, serverTimestamp } = fs;

  // Declare which job we're working. Without this the rule denies the read.
  if (jobId) {
    try {
      const uid = (await import('./ft-firebase.js')).auth.currentUser?.uid;
      if (uid) {
        await setDoc(doc(db, 'users', uid, 'contractorSettings', 'activeRun'),
          { jobId, at: serverTimestamp() }, { merge: true });
      }
    } catch (e) { console.warn('activeRun not set:', e); }
  }

  const snap = await getDoc(doc(db, 'checklists', key));
  if (!snap.exists()) return null;
  const data = snap.data();
  _cache.set(key, data);
  return data;
}

export function clearChecklistCache() { _cache.clear(); }

// --- helpers used by ft-job-run.js -------------------------------------

export const lang = () => (localStorage.getItem('ftLang') === 'es' ? 'es' : 'en');
export const setLang = (l) => { try { localStorage.setItem('ftLang', l === 'es' ? 'es' : 'en'); } catch {} };
export const say = (obj, l) => (obj ? (obj[l || lang()] || obj.en || '') : '');

// Items filtered down to the tier actually sold on this job.
export function itemsFor(section, tier) {
  const t = String(tier || 'standard').toLowerCase();
  return (section.items || []).filter(it => !it.tiers || it.tiers.includes(t));
}

// The text for one item, resolving tier-specific wording.
export function itemText(item, tier, l) {
  if (item.byTier) return say(item.byTier[String(tier || 'standard').toLowerCase()] || item.byTier.standard, l);
  return say(item.t, l);
}

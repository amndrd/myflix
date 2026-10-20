/**
 * MyFlix — Demandes de films et de séries
 * Stockage : myflix-requests.json (jamais servi au navigateur)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const REQUESTS_FILE    = path.join(__dirname, 'myflix-requests.json');
const MAX_OPEN_PER_USER = 20; // demandes en attente max par personne

// ─── STOCKAGE ─────────────────────────────────────────────────────────────────
let db = { requests: [] };
try {
  if (fs.existsSync(REQUESTS_FILE)) db = { requests: [], ...JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')) };
} catch(e) { console.error('[Demandes] Erreur lecture:', e.message); process.exit(1); }

const persist = () => {
  const tmp = REQUESTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, REQUESTS_FILE);
};

// « Le Voyage de Chihiro » et « le voyage de chihiro » sont la même demande
const normTitle = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const findById = (id) => db.requests.find(r => r.id === id);

// Une demande vue par quelqu'un : `mine` si la personne l'a faite ou soutenue
const view = (r, userId, nameOf) => ({
  id: r.id, title: r.title, kind: r.kind, year: r.year || null, note: r.note || '',
  status: r.status, reply: r.reply || '', createdAt: r.createdAt, decidedAt: r.decidedAt || null,
  votes: r.userIds.length, mine: r.userIds.includes(userId), unseen: (r.unseenBy || []).includes(userId),
  ...(nameOf ? { requesters: r.userIds.map(nameOf) } : {}),
});

// ─── AMIS ─────────────────────────────────────────────────────────────────────
// Liste de la personne : ses demandes + celles en attente des autres (pour voter)
const listFor = (userId) => db.requests
  .filter(r => r.userIds.includes(userId) || r.status === 'pending')
  .sort((a, b) => b.createdAt - a.createdAt)
  .map(r => view(r, userId));

const create = (userId, { title, kind, year, note }) => {
  title = String(title || '').trim().replace(/\s+/g, ' ');
  if (title.length < 1 || title.length > 120) return { error: 'Titre : 1 à 120 caractères' };
  kind = kind === 'serie' ? 'serie' : 'film';
  year = parseInt(year, 10);
  if (!(year >= 1888 && year <= 2100)) year = null;
  note = String(note || '').trim().slice(0, 300);

  // Même titre déjà demandé et en attente : on ajoute la voix de la personne
  const key = normTitle(title);
  const same = db.requests.find(r => r.status === 'pending' && r.kind === kind && normTitle(r.title) === key);
  if (same) {
    if (same.userIds.includes(userId)) return { error: 'Tu as déjà demandé ce titre' };
    same.userIds.push(userId); persist();
    return { request: same, joined: true };
  }
  if (db.requests.filter(r => r.status === 'pending' && r.userIds[0] === userId).length >= MAX_OPEN_PER_USER)
    return { error: `Tu as déjà ${MAX_OPEN_PER_USER} demandes en attente` };

  const r = { id: crypto.randomUUID(), title, kind, year, note, status: 'pending', userIds: [userId], createdAt: Date.now() };
  db.requests.push(r); persist();
  return { request: r };
};

// Rejoindre une demande existante (« moi aussi »)
const vote = (userId, id) => {
  const r = findById(id);
  if (!r || r.status !== 'pending') return { error: 'Demande introuvable' };
  if (!r.userIds.includes(userId)) { r.userIds.push(userId); persist(); }
  return { ok: true };
};

// Retirer sa demande ou sa voix. La demande disparaît quand plus personne ne la porte.
const withdraw = (userId, id) => {
  const r = findById(id);
  if (!r || !r.userIds.includes(userId)) return { error: 'Demande introuvable' };
  if (r.status !== 'pending') return { error: 'Cette demande a déjà été traitée' };
  r.userIds = r.userIds.filter(x => x !== userId);
  if (!r.userIds.length) db.requests = db.requests.filter(x => x !== r);
  persist();
  return { ok: true };
};

// Les réponses de l'admin ont été vues
const markSeen = (userId) => {
  let changed = false;
  for (const r of db.requests) {
    if (r.unseenBy?.includes(userId)) { r.unseenBy = r.unseenBy.filter(x => x !== userId); changed = true; }
  }
  if (changed) persist();
};

const unseenCount = (userId) => db.requests.filter(r => r.unseenBy?.includes(userId)).length;

// ─── ADMIN ────────────────────────────────────────────────────────────────────
const listAll = (nameOf) => db.requests
  .slice().sort((a, b) => b.createdAt - a.createdAt)
  .map(r => view(r, null, nameOf));

const pendingCount = () => db.requests.filter(r => r.status === 'pending').length;

// action : added | refused | pending | delete
const decide = (id, action, reply) => {
  const r = findById(id);
  if (!r) return { error: 'Demande introuvable' };
  if (action === 'delete') { db.requests = db.requests.filter(x => x !== r); persist(); return { ok: true }; }
  if (!['added', 'refused', 'pending'].includes(action)) return { error: 'Action inconnue' };
  r.status = action;
  r.reply = action === 'pending' ? '' : String(reply || '').trim().slice(0, 300);
  r.decidedAt = action === 'pending' ? null : Date.now();
  r.unseenBy = action === 'pending' ? [] : r.userIds.slice();
  persist();
  return { ok: true };
};

// Compte supprimé : ses demandes et ses voix partent avec lui
const forgetUser = (userId) => {
  let changed = false;
  for (const r of db.requests) {
    if (r.userIds.includes(userId)) { r.userIds = r.userIds.filter(x => x !== userId); changed = true; }
    if (r.unseenBy?.includes(userId)) r.unseenBy = r.unseenBy.filter(x => x !== userId);
  }
  db.requests = db.requests.filter(r => r.userIds.length);
  if (changed) persist();
};

module.exports = {
  listFor, create, vote, withdraw, markSeen, unseenCount,
  listAll, pendingCount, decide, forgetUser,
};

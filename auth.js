/**
 * MyFlix — Comptes, sessions et demandes d'accès
 * Stockage : myflix-users.json (jamais servi au navigateur)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const USERS_FILE     = path.join(__dirname, 'myflix-users.json');
const SESSION_TTL    = 30 * 24 * 3600 * 1000; // 30 jours
const COOKIE_NAME    = 'myflix_sid';
const MAX_PENDING    = 30;                     // anti-spam : demandes en attente max
const USERNAME_RE    = /^[\p{L}\p{N}_.\- ]{3,30}$/u;

// ─── STOCKAGE ─────────────────────────────────────────────────────────────────
let db = { users: [], sessions: {} };
try {
  if (fs.existsSync(USERS_FILE)) db = { users: [], sessions: {}, ...JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) };
} catch(e) { console.error('[Auth] Erreur lecture comptes:', e.message); process.exit(1); }

// Écriture atomique : fichier temporaire puis renommage
const persist = () => {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
};

// Nettoyer les sessions expirées au démarrage
(() => {
  const now = Date.now(); let n = 0;
  for (const [k, s] of Object.entries(db.sessions)) if (s.expiresAt < now) { delete db.sessions[k]; n++; }
  if (n) persist();
})();

// ─── MOTS DE PASSE (scrypt, intégré à Node) ───────────────────────────────────
const hashPassword = (pwd) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
};
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));
const verifyPassword = (pwd, stored) => {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual   = crypto.scryptSync(pwd, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
};

// ─── REQUÊTE : IP, ORIGINE LOCALE, COOKIES ────────────────────────────────────
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Requête faite directement sur ce Mac (pas via un proxy comme Caddy)
const isLocalRequest = (req) =>
  LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];

// IP réelle du visiteur — on ne fait confiance à X-Forwarded-For que s'il vient du proxy local
const clientIP = (req) => {
  const remote = req.socket.remoteAddress;
  const xff = req.headers['x-forwarded-for'];
  if (xff && LOOPBACK.has(remote)) return String(xff).split(',')[0].trim();
  return remote;
};

const isHttps = (req) =>
  LOOPBACK.has(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https';

const readCookie = (req, name) => {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};

const sessionCookie = (req, token, maxAgeSec) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;

// ─── LIMITE DE TENTATIVES (connexion / inscription) ───────────────────────────
const attempts = new Map(); // "bucket:ip" → { count, resetAt }
const rateLimited = (req, bucket, max, windowMs) => {
  const key = `${bucket}:${clientIP(req)}`, now = Date.now();
  let a = attempts.get(key);
  if (!a || a.resetAt < now) { a = { count: 0, resetAt: now + windowMs }; attempts.set(key, a); }
  a.count++;
  return a.count > max;
};

// ─── NOTIFICATIONS (nouvelle demande d'accès) ─────────────────────────────────
const notify = (title, message, cfg = {}) => {
  // Notification macOS (le serveur tourne sur le Mac)
  if (process.platform === 'darwin') {
    const { spawn } = require('child_process');
    spawn('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run', title, message], { stdio: 'ignore' })
      .on('error', () => {});
  }
  // Notification téléphone via ntfy.sh si un sujet est configuré
  if (cfg.ntfyTopic) {
    fetch(`https://ntfy.sh/${encodeURIComponent(cfg.ntfyTopic)}`, {
      method: 'POST',
      headers: { Title: title, Tags: 'clapper', ...(cfg.publicUrl ? { Click: cfg.publicUrl } : {}) },
      body: message,
    }).catch(e => console.error('[Notif] ntfy:', e.message));
  }
};

// ─── UTILISATEURS ─────────────────────────────────────────────────────────────
const findByName = (username) => {
  const key = String(username || '').trim().toLowerCase();
  return db.users.find(u => u.username.toLowerCase() === key);
};
const findById = (id) => db.users.find(u => u.id === id);
const usernameOf = (id) => findById(id)?.username || 'Compte supprimé';

const publicUser = (u) => ({
  id: u.id, username: u.username, role: u.role, status: u.status,
  message: u.message || '', createdAt: u.createdAt, decidedAt: u.decidedAt || null, lastLoginAt: u.lastLoginAt || null,
});

const validateCredentials = (username, password) => {
  username = String(username || '').trim();
  password = String(password || '');
  if (!USERNAME_RE.test(username)) return { error: "Nom d'utilisateur : 3 à 30 caractères (lettres, chiffres, espace, . _ -)" };
  if (password.length < 8)   return { error: 'Mot de passe : 8 caractères minimum' };
  if (password.length > 200) return { error: 'Mot de passe trop long' };
  return { username, password };
};

const needsSetup = () => !db.users.some(u => u.role === 'admin');

// Création du compte administrateur (uniquement si aucun n'existe)
const setupAdmin = (username, password, initial = {}) => {
  if (!needsSetup()) return { error: 'Un administrateur existe déjà' };
  const v = validateCredentials(username, password); if (v.error) return v;
  const u = {
    id: crypto.randomUUID(), username: v.username, passwordHash: hashPassword(v.password),
    role: 'admin', status: 'approved', createdAt: Date.now(), decidedAt: Date.now(),
    progress: initial.progress || {}, subStyle: initial.subStyle || {},
  };
  db.users.push(u); persist();
  return { user: u };
};

// Demande d'accès : le compte est créé « en attente »
const register = (username, password, message) => {
  const v = validateCredentials(username, password); if (v.error) return v;
  if (findByName(v.username)) return { error: "Ce nom d'utilisateur est déjà pris" };
  if (db.users.filter(u => u.status === 'pending').length >= MAX_PENDING)
    return { error: 'Trop de demandes en attente, réessaie plus tard' };
  const u = {
    id: crypto.randomUUID(), username: v.username, passwordHash: hashPassword(v.password),
    role: 'user', status: 'pending', message: String(message || '').trim().slice(0, 300),
    createdAt: Date.now(), progress: {}, subStyle: {},
  };
  db.users.push(u); persist();
  return { user: u };
};

// Vérifie les identifiants. Ne crée une session que pour un compte approuvé.
const login = (username, password) => {
  const u = findByName(username);
  const ok = verifyPassword(String(password || ''), u ? u.passwordHash : DUMMY_HASH);
  if (!u || !ok) return { error: 'Identifiants incorrects' };
  if (u.status !== 'approved') return { status: u.status };
  u.lastLoginAt = Date.now();
  return { token: createSession(u), user: u };
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Les sessions sont stockées hachées : une fuite du fichier ne donne pas de cookie valide
const createSession = (u) => {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha256(token)] = { userId: u.id, expiresAt: Date.now() + SESSION_TTL };
  persist();
  return token;
};

// Utilisateur connecté (approuvé) ou null
const currentUser = (req) => {
  const token = readCookie(req, COOKIE_NAME); if (!token) return null;
  const s = db.sessions[sha256(token)];
  if (!s || s.expiresAt < Date.now()) return null;
  const u = findById(s.userId);
  return u && u.status === 'approved' ? u : null;
};

const logout = (req) => {
  const token = readCookie(req, COOKIE_NAME);
  if (token && db.sessions[sha256(token)]) { delete db.sessions[sha256(token)]; persist(); }
};

const dropSessionsOf = (userId) => {
  for (const [k, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[k];
};

// ─── ADMINISTRATION ───────────────────────────────────────────────────────────
const listUsers = () => db.users.map(publicUser).sort((a, b) => b.createdAt - a.createdAt);
const pendingCount = () => db.users.filter(u => u.status === 'pending').length;

// action : approve | reject | delete
const decide = (userId, action) => {
  const u = findById(userId);
  if (!u) return { error: 'Compte introuvable' };
  if (u.role === 'admin') return { error: "Impossible de modifier le compte administrateur" };
  if (action === 'approve')     { u.status = 'approved'; u.decidedAt = Date.now(); }
  else if (action === 'reject') { u.status = 'rejected'; u.decidedAt = Date.now(); dropSessionsOf(u.id); }
  else if (action === 'delete') { db.users = db.users.filter(x => x.id !== u.id); dropSessionsOf(u.id); }
  else return { error: 'Action inconnue' };
  persist();
  return { ok: true };
};

// Données propres à chaque utilisateur (progression de lecture, style des sous-titres)
const savePersonal = (u, { progress, subStyle }) => {
  if (progress !== undefined) u.progress = progress;
  if (subStyle !== undefined) u.subStyle = subStyle;
  persist();
};

module.exports = {
  COOKIE_NAME, isLocalRequest, sessionCookie, rateLimited, notify,
  needsSetup, setupAdmin, register, login, createSession, currentUser, logout,
  listUsers, pendingCount, decide, savePersonal, publicUser, usernameOf,
};

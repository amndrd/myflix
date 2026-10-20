/**
 * MyFlix — Envoi de vidéos et d'images depuis le site (administrateur)
 * BROUILLON : pas encore branché au serveur ni testé (étape mise en pause le 2026-10-20).
 * Vidéos : envoi par morceaux dans un fichier .part, qui reprend là où il s'est arrêté
 * (coupure réseau, onglet fermé, serveur redémarré).
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_CHUNK  = 16 * 1024 * 1024;
const MAX_IMAGE  = 20 * 1024 * 1024;
const PART_PREFIX = '.myflix-envoi-';

// Nom de fichier sûr : pas de dossier, pas de caractères interdits, pas de point au début
const safeName = (name, exts) => {
  let n = path.basename(String(name || '')).normalize('NFC')
    .replace(/[\u0000-\u001f\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const ext = path.extname(n).toLowerCase();
  if (!exts.has(ext) || n.length <= ext.length) return null;
  if (n.length > 180) n = n.slice(0, 180 - ext.length) + ext;
  return n;
};

// Même fichier (nom + taille) → même envoi, ce qui permet la reprise
const uploadId = (name, size) => crypto.createHash('sha256').update(`${name}|${size}`).digest('hex').slice(0, 24);
const partPath = (mediaPath, id) => path.join(mediaPath, PART_PREFIX + id + '.part');
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };

// ─── VIDÉOS ───────────────────────────────────────────────────────────────────
const uploads = new Map(); // id → { name, size }

const startVideo = (mediaPath, name, size) => {
  name = safeName(name, VIDEO_EXTS);
  size = Number(size);
  if (!name) return { error: 'Format non pris en charge (mp4, mkv, webm, mov, avi, m4v)' };
  if (!(size > 0)) return { error: 'Fichier vide' };
  const final = path.join(mediaPath, name);
  if (fs.existsSync(final)) {
    // Déjà envoyé en entier : on le réutilise
    if (sizeOf(final) === size) return { done: true, rel: name };
    return { error: `Un autre fichier « ${name} » existe déjà sur le disque` };
  }
  const id = uploadId(name, size), part = partPath(mediaPath, id);
  const offset = sizeOf(part);
  try {
    const { bavail, bsize } = fs.statfsSync(mediaPath);
    if (bavail * bsize < size - offset + 512 * 1024 * 1024) return { error: "Pas assez d'espace sur le disque" };
  } catch (e) {}
  uploads.set(id, { name, size });
  return { id, offset };
};

// Ajoute un morceau à la position attendue. Répond avec la nouvelle position.
const writeChunk = (mediaPath, req, id, offset, done) => {
  const up = uploads.get(id);
  if (!up) return done({ error: 'Envoi inconnu, recommence', status: 404 });
  const part = partPath(mediaPath, id), current = sizeOf(part);
  // Morceau déjà reçu ou décalé : le navigateur se recale sur la position du serveur
  if (Number(offset) !== current) { req.resume(); return done({ offset: current }); }
  let received = 0, failed = false;
  const out = fs.createWriteStream(part, { flags: 'a' });
  req.on('data', d => {
    received += d.length;
    if (received > MAX_CHUNK || current + received > up.size) { failed = true; req.destroy(); out.destroy(); }
  });
  req.pipe(out);
  out.on('finish', () => done(failed ? { error: 'Morceau invalide', status: 400 } : { offset: sizeOf(part) }));
  out.on('error', () => done({ error: "Écriture impossible sur le disque", status: 500 }));
  req.on('aborted', () => out.destroy());
  req.on('close', () => { if (failed) done({ error: 'Morceau invalide', status: 400 }); });
};

const finishVideo = (mediaPath, id) => {
  const up = uploads.get(id);
  if (!up) return { error: 'Envoi inconnu' };
  const part = partPath(mediaPath, id);
  if (sizeOf(part) !== up.size) return { error: 'Fichier incomplet', offset: sizeOf(part) };
  const final = path.join(mediaPath, up.name);
  if (fs.existsSync(final)) return { error: `Un autre fichier « ${up.name} » existe déjà sur le disque` };
  fs.renameSync(part, final);
  uploads.delete(id);
  return { rel: up.name };
};

const cancelVideo = (mediaPath, id) => {
  try { fs.unlinkSync(partPath(mediaPath, id)); } catch (e) {}
  uploads.delete(id);
  return { ok: true };
};

// ─── IMAGES ───────────────────────────────────────────────────────────────────
// Enregistre l'image dans images/. Si le nom est pris par une autre image, ajoute -2, -3…
const saveImage = (imagesDir, req, name, done) => {
  name = safeName(name, IMAGE_EXTS);
  if (!name) { req.resume(); return done({ error: 'Format non pris en charge (jpg, png, webp, gif)', status: 400 }); }
  const chunks = []; let size = 0, tooBig = false;
  req.on('data', d => { size += d.length; if (size > MAX_IMAGE) tooBig = true; else chunks.push(d); });
  req.on('end', () => {
    if (tooBig) return done({ error: 'Image trop lourde (20 Mo max)', status: 413 });
    const buf = Buffer.concat(chunks);
    if (!buf.length) return done({ error: 'Image vide', status: 400 });
    const ext = path.extname(name), base = name.slice(0, -ext.length);
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? name : `${base}-${i}${ext}`;
      const full = path.join(imagesDir, candidate);
      if (fs.existsSync(full)) {
        if (fs.readFileSync(full).equals(buf)) return done({ name: candidate }); // même image déjà là
        continue;
      }
      fs.writeFileSync(full, buf);
      return done({ name: candidate });
    }
    done({ error: 'Trop de fichiers portant ce nom', status: 409 });
  });
};

module.exports = { startVideo, writeChunk, finishVideo, cancelVideo, saveImage, PART_PREFIX };

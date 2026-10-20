/**
 * MyFlix — Serveur local
 * Stream vidéo + extraction sous-titres + pistes audio via FFmpeg
 * Accès réservé aux comptes approuvés (voir auth.js)
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execSync, spawn } = require('child_process');
const auth   = require('./auth');
const requests = require('./requests');

const PORT        = parseInt(process.env.PORT, 10) || 8989;
const CONFIG_FILE = path.join(__dirname, 'myflix-config.json');
const CACHE_DIR   = path.join(os.tmpdir(), 'myflix_subs');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} else {
  // Vider les anciens fichiers de cache au démarrage
  try {
    const files = fs.readdirSync(CACHE_DIR);
    files.forEach(f => { try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch(e){} });
    if (files.length) console.log(`[Cache] ${files.length} fichier(s) supprimé(s)`);
  } catch(e) {}
}

const DATA_FILE = path.join(__dirname, 'myflix-data.json');

// ─── DONNÉES PERSISTANTES ─────────────────────────────────────────────────────
const loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { console.error('[Data] Erreur lecture:', e.message); }
  return null;
};

const saveData = (data) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
    _catalogRefs = null;
    return true;
  } catch(e) { console.error('[Data] Erreur écriture:', e.message); return false; }
};
const loadConfig = () => {
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); } catch(e) {}
  return { mediaPath: '' };
};
const saveConfig = cfg => fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg,null,2));

// Clés du catalogue partagé (modifiables par l'admin uniquement).
// La progression et le style des sous-titres sont propres à chaque compte (auth.js).
const SHARED_KEYS = ['myflix_movies','myflix_series','myflix_episodes','myflix_cats','myflix_collections','myflix_directors','myflix_featured'];

// Fichiers vidéo référencés au catalogue — les seuls qu'un ami peut lire
let _catalogRefs = null;
const catalogRefs = () => {
  if (_catalogRefs) return _catalogRefs;
  const d = loadData() || {}, refs = new Set();
  const list = k => { try { return JSON.parse(d[k] || '[]'); } catch(e) { return []; } };
  list('myflix_movies').forEach(m => m.videoRef && refs.add(m.videoRef));
  list('myflix_episodes').forEach(e => e.videoRef && refs.add(e.videoRef));
  return _catalogRefs = refs;
};

// Résout un chemin relatif dans un dossier racine sans jamais pouvoir en sortir
const safeJoin = (root, rel) => {
  const base = path.resolve(root);
  const full = path.join(base, String(rel || ''));
  return full.startsWith(base + path.sep) ? full : null;
};

// ─── FFMPEG ───────────────────────────────────────────────────────────────────
const FFMPEG_PATHS = ['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','ffmpeg'];
const FFPROBE_PATHS = ['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe','ffprobe'];
let FFMPEG = null, FFPROBE = null;
for (const p of FFMPEG_PATHS)  { try { execSync(`${p} -version`,{stdio:'ignore'}); FFMPEG=p; break; } catch(e) {} }
for (const p of FFPROBE_PATHS) { try { execSync(`${p} -version`,{stdio:'ignore'}); FFPROBE=p; break; } catch(e) {} }
console.log(`FFmpeg: ${FFMPEG||'non trouvé'}`);
console.log(`FFprobe: ${FFPROBE||'non trouvé'}`);

// ─── MIME ─────────────────────────────────────────────────────────────────────
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css',
  '.js':'application/javascript', '.json':'application/json',
  '.mp4':'video/mp4', '.webm':'video/webm', '.mkv':'video/x-matroska',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.webp':'image/webp',
  '.gif':'image/gif', '.svg':'image/svg+xml',
  '.vtt':'text/vtt', '.srt':'text/plain',
};
const VIDEO_EXTS = new Set(['.mp4','.webm','.mkv','.avi','.mov','.m4v']);

// ─── RÉPONSES ─────────────────────────────────────────────────────────────────
const jsonRes = (res, data, status=200, headers={}) => {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data));
};

// Lit un corps JSON en limitant sa taille
const readJson = (req, res, maxBytes, cb) => {
  let size = 0; const chunks = [];
  req.on('data', d => {
    size += d.length;
    if (size > maxBytes) { if (!res.headersSent) jsonRes(res,{error:'Requête trop volumineuse'},413); return; }
    chunks.push(d);
  });
  req.on('end', () => {
    if (res.headersSent) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch(e) { return jsonRes(res,{error:'JSON invalide'},400); }
    if (!body || typeof body !== 'object') return jsonRes(res,{error:'JSON invalide'},400);
    cb(body);
  });
};

const sendFile = (res, filePath, mime) => {
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});
  fs.createReadStream(filePath).pipe(res);
};

// ─── SPRITE SHEET THUMBNAILS ─────────────────────────────────────────────────
// 1 frame toutes les THUMB_INTERVAL secondes, THUMB_W×THUMB_H px par frame
// Assemblées en grille THUMB_COLS colonnes → 1 fichier JPEG
const THUMB_INTERVAL = 5;   // secondes entre chaque frame
const THUMB_W        = 160; // largeur d'une frame
const THUMB_H        = 90;  // hauteur (16:9)
const THUMB_COLS     = 10;  // colonnes dans le sprite

const spriteJobs = new Map(); // hash → { status, path, count, interval }

const spriteHash = (filePath) =>
  Buffer.from(filePath + '::sprite').toString('base64').replace(/[/+=]/g,'_').slice(0,48);

const prepareSpriteSheet = (filePath) => {
  const hash    = spriteHash(filePath);
  const outPath = path.join(CACHE_DIR, `${hash}.jpg`);
  const metaPath = path.join(CACHE_DIR, `${hash}.json`);

  if (fs.existsSync(outPath) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    spriteJobs.set(hash, { status:'ready', path:outPath, ...meta });
    return hash;
  }
  if (spriteJobs.has(hash) && spriteJobs.get(hash).status === 'pending') return hash;

  spriteJobs.set(hash, { status:'pending', path:outPath });
  if (!FFMPEG) { spriteJobs.set(hash, { status:'error', error:'FFmpeg absent' }); return hash; }

  console.log(`[Sprite] Génération pour ${path.basename(filePath)}`);

  // Étape 1 : obtenir la durée avec FFprobe
  const getDuration = () => new Promise((resolve) => {
    if (!FFPROBE) { resolve(0); return; }
    const args = ['-v','quiet','-print_format','json','-show_format', filePath];
    const proc = spawn(FFPROBE, args, { stdio:['ignore','pipe','ignore'] });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => {
      try { resolve(parseFloat(JSON.parse(out).format.duration) || 0); }
      catch(e) { resolve(0); }
    });
    proc.on('error', () => resolve(0));
  });

  getDuration().then(duration => {
    const frameCount = Math.max(1, Math.floor(duration / THUMB_INTERVAL));
    const rows       = Math.ceil(frameCount / THUMB_COLS);

    // FFmpeg : extraire 1 frame toutes les THUMB_INTERVAL secondes
    // et les assembler en tile grid
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', filePath,
      '-vf', `fps=1/${THUMB_INTERVAL},scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=decrease,pad=${THUMB_W}:${THUMB_H}:(ow-iw)/2:(oh-ih)/2,tile=${THUMB_COLS}x${rows}`,
      '-frames:v', '1',
      '-q:v', '4',
      '-y', outPath
    ];

    const ff = spawn(FFMPEG, args, { stdio:['ignore','ignore','pipe'] });
    let errBuf = '';
    ff.stderr.on('data', d => { errBuf += d.toString(); });
    ff.on('close', code => {
      if (code === 0 && fs.existsSync(outPath)) {
        const meta = { count: frameCount, cols: THUMB_COLS, interval: THUMB_INTERVAL, w: THUMB_W, h: THUMB_H, duration };
        fs.writeFileSync(metaPath, JSON.stringify(meta));
        spriteJobs.set(hash, { status:'ready', path:outPath, ...meta });
        console.log(`[Sprite] OK : ${frameCount} frames, ${path.basename(outPath)}`);
      } else {
        console.error(`[Sprite] Erreur code ${code}:`, errBuf.slice(-200));
        try { fs.unlinkSync(outPath); } catch(e) {}
        spriteJobs.set(hash, { status:'error', error:`code ${code}` });
      }
    });
    ff.on('error', err => spriteJobs.set(hash, { status:'error', error:err.message }));
  });

  return hash;
};
const streamFile = (req, res, filePath) => {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  let stat;
  try { stat = fs.statSync(filePath); } catch(e) { res.writeHead(404); res.end('Introuvable'); return; }
  const total = stat.size;
  const range = req.headers['range'];
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] !== '' ? parseInt(m[1],10) : NaN;
    let end   = m && m[2] !== '' ? parseInt(m[2],10) : total-1;
    if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - parseInt(m[2],10)); end = total-1; } // bytes=-N
    if (isNaN(start) || start > end || start >= total) { res.writeHead(416,{'Content-Range':`bytes */${total}`}); res.end(); return; }
    end = Math.min(end, total-1);
    res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes','Content-Length':end-start+1,'Content-Type':mime});
    fs.createReadStream(filePath,{start,end}).pipe(res);
  } else {
    res.writeHead(200,{'Content-Length':total,'Content-Type':mime,'Accept-Ranges':'bytes'});
    fs.createReadStream(filePath).pipe(res);
  }
};

// ─── PISTE AUDIO — CACHE + STATUS ────────────────────────────────────────────
const audioJobs = new Map();

const audioHash = (filePath, idx) =>
  Buffer.from(filePath + '::audio::' + idx)
    .toString('base64').replace(/[/+=]/g,'_').slice(0, 48);

// Lance l'encodage en arrière-plan, retourne le hash immédiatement
// audioIndex = index RELATIF dans les pistes audio (0, 1, 2...) — pas l'index de stream
const prepareAudioTrack = (filePath, audioIndex) => {
  const hash    = audioHash(filePath, audioIndex);
  const outPath = path.join(CACHE_DIR, `${hash}.mp4`);

  if (fs.existsSync(outPath)) {
    audioJobs.set(hash, { status:'ready', path:outPath });
    return hash;
  }
  if (audioJobs.has(hash) && audioJobs.get(hash).status === 'pending') return hash;

  audioJobs.set(hash, { status:'pending', path:outPath });

  if (!FFMPEG) { audioJobs.set(hash,{status:'error',error:'FFmpeg absent'}); return hash; }

  console.log(`[Audio] Encodage piste audio:${audioIndex} de ${path.basename(filePath)}`);
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-map', '0:v:0',
    '-map', `0:a:${audioIndex}`,  // index RELATIF parmi les pistes audio
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outPath
  ];
  const ff = spawn(FFMPEG, args, { stdio:['ignore','ignore','pipe'] });
  let errBuf = '';
  ff.stderr.on('data', d => { errBuf += d.toString(); });
  ff.on('close', code => {
    if (code === 0 && fs.existsSync(outPath)) {
      console.log(`[Audio] Prêt : ${path.basename(outPath)}`);
      audioJobs.set(hash, { status:'ready', path:outPath });
    } else {
      console.error(`[Audio] FFmpeg exit ${code}:`, errBuf.trim().slice(-300));
      try { fs.unlinkSync(outPath); } catch(e) {}
      audioJobs.set(hash, { status:'error', error:`FFmpeg exit ${code}: ${errBuf.trim().slice(-100)}` });
    }
  });
  ff.on('error', err => {
    console.error('[Audio] spawn error:', err.message);
    audioJobs.set(hash, { status:'error', error:err.message });
  });
  return hash;
};

// ─── ANALYSER LES PISTES D'UN FICHIER (FFprobe) ───────────────────────────────
const analyzeFile = (filePath) => {
  return new Promise((resolve) => {
    if (!FFPROBE) { resolve({ audio:[], subtitles:[] }); return; }

    const args = ['-v','quiet','-print_format','json','-show_streams', filePath];
    const proc = spawn(FFPROBE, args, { stdio:['ignore','pipe','ignore'] });

    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => {
      try {
        const data = JSON.parse(out);
        const streams = data.streams || [];
        const audio = streams
          .filter(s => s.codec_type === 'audio')
          .map((s, relIdx) => ({
            index      : s.index,       // index absolu de stream (pour sous-titres/FFprobe)
            audioIndex : relIdx,        // index relatif parmi les pistes audio (pour FFmpeg -map 0:a:N)
            lang    : s.tags?.language || s.tags?.LANGUAGE || 'und',
            title   : s.tags?.title    || s.tags?.TITLE    || '',
            codec   : s.codec_name,
            channels: s.channels,
          }));
        const allSubs = streams
          .filter(s => s.codec_type === 'subtitle')
          .map((s, relIdx) => ({
            index    : relIdx,
            lang  : s.tags?.language || s.tags?.LANGUAGE || 'und',
            title : s.tags?.title    || s.tags?.TITLE    || '',
            forced: s.disposition?.forced === 1,
            codec : s.codec_name,
          }));
        // Garder uniquement la première piste par langue (évite les doublons SDH/forcé)
        const seenLangs = new Set();
        const subtitles = allSubs.filter(s => {
          if (seenLangs.has(s.lang)) return false;
          seenLangs.add(s.lang);
          return true;
        });
        resolve({ audio, subtitles });
      } catch(e) {
        console.error('FFprobe parse error:', e.message);
        resolve({ audio:[], subtitles:[] });
      }
    });
    proc.on('error', err => {
      console.error('FFprobe spawn error:', err.message);
      resolve({ audio:[], subtitles:[] });
    });
    // Timeout 10 secondes
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve({ audio:[], subtitles:[] }); }, 10000);
  });
};

// ─── EXTRAIRE UN SOUS-TITRE EN VTT (FFmpeg) ────────────────────────────────────
const extractSubtitle = (filePath, streamIndex) => {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) { reject(new Error('FFmpeg non trouvé')); return; }

    const hash = Buffer.from(filePath + '::sub::' + streamIndex)
      .toString('base64').replace(/[/+=]/g,'_').slice(0, 48);
    const vttPath = path.join(CACHE_DIR, `${hash}.vtt`);

    // Vérifier que le cache est complet (> 1 Ko) — sinon le supprimer
    if (fs.existsSync(vttPath)) {
      const size = fs.statSync(vttPath).size;
      if (size > 1024) {
        console.log(`[Subtitles] Cache hit : piste ${streamIndex} (${size} octets)`);
        resolve(vttPath); return;
      } else {
        console.log(`[Subtitles] Cache incomplet (${size} octets), on réextrait`);
        try { fs.unlinkSync(vttPath); } catch(e) {}
      }
    }

    console.log(`[Subtitles] Extraction piste ${streamIndex} de ${path.basename(filePath)}`);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', filePath,
      '-map', `0:s:${streamIndex}`,   // index RELATIF parmi les sous-titres
      '-c:s', 'webvtt',
      '-y', vttPath
    ];

    let errBuf = '';
    const ff = spawn(FFMPEG, args, { stdio:['ignore','ignore','pipe'] });
    ff.stderr.on('data', d => { errBuf += d.toString(); });

    // Timeout 5 minutes pour les longs films
    const timeout = setTimeout(() => {
      console.error('[Subtitles] Timeout — FFmpeg trop lent');
      try { ff.kill(); } catch(e) {}
      // Servir quand même ce qu'on a si le fichier existe
      if (fs.existsSync(vttPath) && fs.statSync(vttPath).size > 500) resolve(vttPath);
      else reject(new Error('Timeout extraction sous-titres'));
    }, 5 * 60 * 1000);

    ff.on('close', code => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(vttPath)) {
        const size = fs.statSync(vttPath).size;
        console.log(`[Subtitles] OK : ${path.basename(vttPath)} (${size} octets)`);
        resolve(vttPath);
      } else {
        console.error(`[Subtitles] Erreur code ${code}:`, errBuf.trim().slice(-200));
        try { fs.unlinkSync(vttPath); } catch(e) {}
        reject(new Error(`FFmpeg code ${code}`));
      }
    });
    ff.on('error', err => { clearTimeout(timeout); reject(err); });
  });
};

// ─── SCAN ─────────────────────────────────────────────────────────────────────
const scanMedia = (dir, base=dir, depth=0) => {
  if (depth>4) return [];
  let results=[];
  let entries;
  try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch(e) { return []; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full=path.join(dir,e.name), rel=path.relative(base,full), ext=path.extname(e.name).toLowerCase();
    if (e.isDirectory()) results=results.concat(scanMedia(full,base,depth+1));
    else if (VIDEO_EXTS.has(ext)) {
      let size=0; try { size=fs.statSync(full).size; } catch(e) {}
      results.push({ name:e.name, rel, ext, sizeMB:Math.round(size/(1024*1024)), folder:path.dirname(rel)==='.'?'':path.dirname(rel) });
    }
  }
  return results;
};

// ─── VOLUMES ──────────────────────────────────────────────────────────────────
const getVolumes = () => {
  const vols=[];
  try { fs.readdirSync('/Volumes',{withFileTypes:true}).forEach(v=>{ if(v.isDirectory()||v.isSymbolicLink()) vols.push({name:v.name,path:path.join('/Volumes',v.name)}); }); } catch(e) {}
  vols.push({name:'Home',path:os.homedir()});
  vols.push({name:'Bureau',path:path.join(os.homedir(),'Desktop')});
  vols.push({name:'Telechargements',path:path.join(os.homedir(),'Downloads')});
  return vols;
};

// ─── SERVEUR ──────────────────────────────────────────────────────────────────
const LOGIN_PAGE = path.join(__dirname, 'login.html');
const SITE_LOGO  = path.join(__dirname, 'images', 'website-logo.png');
const ADMIN_ROUTES = new Set(['/api/config','/api/scan','/api/volumes','/api/files']);
const DAY = 24 * 3600;

const parseObj = (s, fallback) => {
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }
  catch(e) { return fallback; }
};

const server = http.createServer((req, res) => {
  let parsed, pathname;
  try { parsed = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(parsed.pathname); }
  catch(e) { res.writeHead(400); res.end(); return; }
  const q = parsed.searchParams;

  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');

  // Les envois de données doivent venir du site lui-même
  if (req.method === 'POST' && req.headers.origin) {
    let host = null; try { host = new URL(req.headers.origin).host; } catch(e) {}
    if (host !== req.headers.host) return jsonRes(res,{error:'Origine refusée'},403);
  }

  // ══ ROUTES PUBLIQUES (sans compte) ══════════════════════════════════════════

  if (pathname === '/login') {
    if (auth.currentUser(req)) { res.writeHead(302,{Location:'/'}); res.end(); return; }
    return sendFile(res, LOGIN_PAGE, MIME['.html']);
  }
  if (pathname === '/images/website-logo.png' && fs.existsSync(SITE_LOGO)) return sendFile(res, SITE_LOGO, MIME['.png']);

  // État initial : faut-il créer le compte administrateur ?
  if (pathname === '/api/auth/state') {
    const needsSetup = auth.needsSetup();
    return jsonRes(res,{ needsSetup, setupAllowed: needsSetup && auth.isLocalRequest(req) });
  }

  // Création du compte administrateur — une seule fois, et seulement depuis ce Mac
  if (pathname === '/api/auth/setup' && req.method === 'POST') {
    if (!auth.needsSetup() || !auth.isLocalRequest(req)) return jsonRes(res,{error:'Configuration impossible'},403);
    return readJson(req, res, 10e3, body => {
      const d = loadData() || {};
      const r = auth.setupAdmin(body.username, body.password, {
        progress: parseObj(d.myflix_progress, {}), subStyle: parseObj(d.myflix_sub_style, {}),
      });
      if (r.error) return jsonRes(res,{error:r.error},400);
      // La progression existante devient celle de l'admin
      delete d.myflix_progress; delete d.myflix_sub_style; saveData(d);
      jsonRes(res,{ok:true},200,{'Set-Cookie':auth.sessionCookie(req, auth.createSession(r.user), 30*DAY)});
    });
  }

  // Demande d'accès
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (auth.rateLimited(req,'register',5,60*60*1000)) return jsonRes(res,{error:'Trop de demandes, réessaie plus tard'},429);
    return readJson(req, res, 10e3, body => {
      const r = auth.register(body.username, body.password, body.message);
      if (r.error) return jsonRes(res,{error:r.error},400);
      const u = r.user;
      console.log(`[Auth] Nouvelle demande d'accès : ${u.username}`);
      auth.notify('MyFlix — demande d\'accès', u.message ? `${u.username} : « ${u.message} »` : `${u.username} demande l'accès`, loadConfig());
      jsonRes(res,{ok:true,status:'pending'});
    });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (auth.rateLimited(req,'login',10,15*60*1000)) return jsonRes(res,{error:'Trop de tentatives, réessaie dans 15 minutes'},429);
    return readJson(req, res, 10e3, body => {
      const r = auth.login(body.username, body.password);
      if (r.error)  return jsonRes(res,{error:r.error},401);
      if (r.status) return jsonRes(res,{status:r.status},403);
      jsonRes(res,{ok:true},200,{'Set-Cookie':auth.sessionCookie(req, r.token, 30*DAY)});
    });
  }

  // Mot de passe oublié : l'admin est prévenu. Même réponse que le compte existe ou non.
  if (pathname === '/api/auth/forgot' && req.method === 'POST') {
    if (auth.rateLimited(req,'forgot',3,60*60*1000)) return jsonRes(res,{error:'Trop de demandes, réessaie plus tard'},429);
    return readJson(req, res, 10e3, body => {
      const u = auth.requestReset(body.username);
      if (u) {
        console.log(`[Auth] Mot de passe oublié : ${u.username}`);
        auth.notify('MyFlix — mot de passe oublié', `${u.username} demande un nouveau mot de passe`, loadConfig());
      }
      jsonRes(res,{ok:true});
    });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    auth.logout(req);
    return jsonRes(res,{ok:true},200,{'Set-Cookie':auth.sessionCookie(req, '', 0)});
  }

  // ══ À PARTIR D'ICI : COMPTE APPROUVÉ OBLIGATOIRE ════════════════════════════

  const user = auth.currentUser(req);
  if (!user) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/media/') || pathname.startsWith('/images/'))
      return jsonRes(res,{error:'Non connecté'},401);
    res.writeHead(302,{Location:'/login'}); res.end(); return;
  }
  const isAdmin = user.role === 'admin';
  if (!isAdmin && (ADMIN_ROUTES.has(pathname) || pathname.startsWith('/api/admin/')))
    return jsonRes(res,{error:'Réservé à l\'administrateur'},403);

  // Fichier vidéo du disque. Un ami ne peut lire que ce qui est au catalogue.
  const mediaFile = (rel) => {
    const cfg = loadConfig();
    if (!cfg.mediaPath) return { status:503, error:'Aucun disque configuré' };
    if (!isAdmin && !catalogRefs().has(rel)) return { status:403, error:'Accès refusé' };
    const filePath = safeJoin(cfg.mediaPath, rel);
    if (!filePath) return { status:403, error:'Accès refusé' };
    if (!fs.existsSync(filePath)) return { status:404, error:'Fichier introuvable' };
    return { filePath };
  };

  if (pathname === '/api/auth/me') {
    return jsonRes(res,{ user: auth.publicUser(user), ...(isAdmin
      ? { pendingCount: auth.pendingCount(), requestsCount: requests.pendingCount() }
      : { requestUpdates: requests.unseenCount(user.id) }) });
  }

  // ── Mon compte ──────────────────────────────────────────────────────────────
  if (pathname === '/api/account/password' && req.method === 'POST') {
    if (auth.rateLimited(req,'password:'+user.id,10,15*60*1000)) return jsonRes(res,{error:'Trop de tentatives, réessaie dans 15 minutes'},429);
    return readJson(req, res, 10e3, body => {
      const r = auth.changePassword(req, user, body.current, body.password);
      jsonRes(res, r, r.error ? 400 : 200);
    });
  }

  // ── Admin : comptes et demandes d'accès ─────────────────────────────────────
  if (pathname === '/api/admin/users') return jsonRes(res,{ users: auth.listUsers() });

  if (pathname === '/api/admin/users/decide' && req.method === 'POST') {
    return readJson(req, res, 10e3, body => {
      const r = auth.decide(body.id, body.action);
      if (r.ok && body.action === 'delete') requests.forgetUser(body.id);
      jsonRes(res, r, r.error ? 400 : 200);
    });
  }

  // ── Demandes de films ───────────────────────────────────────────────────────
  if (pathname === '/api/requests') {
    if (req.method !== 'POST') return jsonRes(res,{ requests: requests.listFor(user.id) });
    if (auth.rateLimited(req,'request:'+user.id,15,24*3600*1000)) return jsonRes(res,{error:'Trop de demandes aujourd\'hui, réessaie demain'},429);
    return readJson(req, res, 10e3, body => {
      const r = requests.create(user.id, body);
      if (r.error) return jsonRes(res,{error:r.error},400);
      const t = r.request.title + (r.request.year ? ` (${r.request.year})` : '');
      console.log(`[Demandes] ${user.username} : ${t}${r.joined ? ' (+1)' : ''}`);
      if (!isAdmin) auth.notify('MyFlix — demande de ' + (r.request.kind === 'serie' ? 'série' : 'film'),
        r.joined ? `${user.username} demande aussi « ${t} »` : `${user.username} : « ${t} »${r.request.note ? ' — ' + r.request.note : ''}`, loadConfig());
      jsonRes(res,{ ok:true, joined:!!r.joined });
    });
  }
  if (req.method === 'POST' && ['/api/requests/vote','/api/requests/withdraw','/api/requests/seen'].includes(pathname)) {
    return readJson(req, res, 10e3, body => {
      if (pathname.endsWith('/seen')) { requests.markSeen(user.id); return jsonRes(res,{ok:true}); }
      const r = pathname.endsWith('/vote') ? requests.vote(user.id, body.id) : requests.withdraw(user.id, body.id);
      jsonRes(res, r, r.error ? 400 : 200);
    });
  }
  if (pathname === '/api/admin/users/reset' && req.method === 'POST') {
    return readJson(req, res, 10e3, body => {
      const r = auth.resetPassword(body.id);
      jsonRes(res, r, r.error ? 400 : 200);
    });
  }
  if (pathname === '/api/admin/requests') return jsonRes(res,{ requests: requests.listAll(auth.usernameOf) });
  if (pathname === '/api/admin/requests/decide' && req.method === 'POST') {
    return readJson(req, res, 10e3, body => {
      const r = requests.decide(body.id, body.action, body.reply);
      jsonRes(res, r, r.error ? 400 : 200);
    });
  }

  // ── API : lire les données ──────────────────────────────────────────────────
  if (pathname === '/api/data') {
    const d = loadData() || {};
    const data = {};
    SHARED_KEYS.forEach(k => { if (d[k] != null) data[k] = d[k]; });
    data.myflix_progress  = JSON.stringify(user.progress || {});
    data.myflix_sub_style = JSON.stringify(user.subStyle || {});
    return jsonRes(res, { ok: true, data });
  }

  // ── API : sauvegarder les données ──────────────────────────────────────────
  // Tout le monde enregistre sa progression ; seul l'admin modifie le catalogue.
  if (pathname === '/api/save' && req.method === 'POST') {
    return readJson(req, res, isAdmin ? 50e6 : 2e6, body => {
      const personal = {};
      if (typeof body.myflix_progress  === 'string') { const v = parseObj(body.myflix_progress, null);  if (v) personal.progress = v; }
      if (typeof body.myflix_sub_style === 'string') { const v = parseObj(body.myflix_sub_style, null); if (v) personal.subStyle = v; }
      auth.savePersonal(user, personal);
      if (!isAdmin) return jsonRes(res, { ok: true });
      const data = loadData() || {};
      for (const k of SHARED_KEYS) {
        if (typeof body[k] !== 'string') continue;
        try { JSON.parse(body[k]); data[k] = body[k]; } catch(e) {}
      }
      jsonRes(res, { ok: saveData(data) });
    });
  }

  if (pathname==='/api/status') {
    const cfg=loadConfig();
    const mediaExists=!!(cfg.mediaPath&&fs.existsSync(cfg.mediaPath));
    return jsonRes(res,{ok:true,...(isAdmin?{mediaPath:cfg.mediaPath||null}:{}),mediaExists,ffmpeg:!!FFMPEG,ffprobe:!!FFPROBE});
  }

  // API config
  if (pathname==='/api/config' && req.method==='POST') {
    return readJson(req, res, 10e3, ({mediaPath}) => {
      if (!mediaPath) return jsonRes(res,{error:'mediaPath requis'},400);
      if (!fs.existsSync(mediaPath)) return jsonRes(res,{error:'Chemin introuvable : '+mediaPath},400);
      const cfg=loadConfig(); cfg.mediaPath=mediaPath; saveConfig(cfg);
      return jsonRes(res,{ok:true,mediaPath});
    });
  }

  // API scan
  if (pathname==='/api/scan') {
    const cfg=loadConfig();
    if (!cfg.mediaPath||!fs.existsSync(cfg.mediaPath)) return jsonRes(res,{error:'Aucun disque configuré',files:[]},400);
    const files=scanMedia(cfg.mediaPath);
    return jsonRes(res,{ok:true,files,total:files.length});
  }

  // API volumes
  if (pathname==='/api/volumes') return jsonRes(res,{volumes:getVolumes()});

  // API files — liste flat des vidéos sur le disque (pour le picker inline)
  if (pathname==='/api/files') {
    const cfg=loadConfig();
    if (!cfg.mediaPath||!fs.existsSync(cfg.mediaPath)) return jsonRes(res,{error:'Aucun disque configuré',files:[]},400);
    const files=scanMedia(cfg.mediaPath).map(f=>({ name:f.name, rel:f.rel, sizeMB:f.sizeMB, folder:f.folder }));
    return jsonRes(res,{ok:true,files});
  }

  // ── API : lancer la génération du sprite sheet ────────────────────────────
  if (pathname === '/api/prepare-sprite') {
    const f = mediaFile(q.get('rel') || '');
    if (f.error) return jsonRes(res, { error:f.error }, f.status);
    const hash = prepareSpriteSheet(f.filePath);
    const job  = spriteJobs.get(hash);
    return jsonRes(res, { ok:true, hash, status: job.status, count: job.count, cols: job.cols, interval: job.interval, w: job.w, h: job.h });
  }

  // ── API : statut du sprite ────────────────────────────────────────────────
  if (pathname === '/api/sprite-status') {
    const job = spriteJobs.get(q.get('hash') || '');
    if (!job) return jsonRes(res, { status:'unknown' }, 404);
    return jsonRes(res, { status: job.status, count: job.count, cols: job.cols, interval: job.interval, w: job.w, h: job.h });
  }

  // ── API : servir l'image sprite ───────────────────────────────────────────
  if (pathname === '/api/sprite-img') {
    const job = spriteJobs.get(q.get('hash') || '');
    if (!job || job.status !== 'ready' || !fs.existsSync(job.path)) {
      res.writeHead(404); res.end('Sprite non prêt'); return;
    }
    const data = fs.readFileSync(job.path);
    res.writeHead(200, { 'Content-Type':'image/jpeg', 'Content-Length':data.length, 'Cache-Control':'private,max-age=86400' });
    res.end(data);
    return;
  }

  // ── API : lancer l'encodage d'une piste audio en arrière-plan ────────────────
  // GET /api/prepare-audio?rel=film.mp4&audio=2
  if (pathname === '/api/prepare-audio') {
    const audioIdx = parseInt(q.get('audio'), 10);
    if (!(audioIdx >= 0)) return jsonRes(res,{error:'Piste invalide'},400);
    const f = mediaFile(q.get('rel') || '');
    if (f.error) return jsonRes(res,{error:f.error},f.status);
    const hash = prepareAudioTrack(f.filePath, audioIdx);
    const job  = audioJobs.get(hash);
    return jsonRes(res,{ ok:true, hash, status: job.status });
  }

  // ── API : vérifier si l'encodage est terminé ──────────────────────────────────
  // GET /api/audio-status?hash=XXXX
  if (pathname === '/api/audio-status') {
    const job = audioJobs.get(q.get('hash') || '');
    if (!job) return jsonRes(res,{status:'unknown'},404);
    return jsonRes(res,{ status: job.status, error: job.error||null });
  }

  // ── API : analyser les pistes d'un fichier ────────────────────────────────
  // GET /api/tracks?rel=chemin/relatif/film.mp4
  if (pathname==='/api/tracks') {
    const f = mediaFile(q.get('rel') || '');
    if (f.error) return jsonRes(res,{error:f.error,audio:[],subtitles:[]},f.status);
    analyzeFile(f.filePath).then(tracks => jsonRes(res,{ok:true,...tracks}));
    return;
  }

  // ── API : extraire un sous-titre en VTT ────────────────────────────────────
  // GET /api/subtitle?rel=film.mp4&index=3
  if (pathname==='/api/subtitle') {
    if (!FFMPEG) { res.writeHead(503); res.end('FFmpeg non disponible'); return; }
    const index=parseInt(q.get('index'),10);
    if (!(index >= 0)) { res.writeHead(400); res.end('Piste invalide'); return; }
    const f = mediaFile(q.get('rel') || '');
    if (f.error) { res.writeHead(f.status); res.end(f.error); return; }

    extractSubtitle(f.filePath, index)
      .then(vttPath => {
        res.writeHead(200,{'Content-Type':'text/vtt','Cache-Control':'private, max-age=3600'});
        fs.createReadStream(vttPath).pipe(res);
      })
      .catch(err => {
        console.error('Extraction sous-titre échouée:', err.message);
        res.writeHead(500); res.end('Extraction échouée');
      });
    return;
  }

  // Images statiques
  if (pathname.startsWith('/images/')) {
    const imgPath=safeJoin(path.join(__dirname,'images'), pathname.slice('/images/'.length));
    if (!imgPath) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(imgPath)) { res.writeHead(404); res.end('Image introuvable'); return; }
    return streamFile(req,res,imgPath);
  }

  // Stream vidéo/image depuis le disque
  if (pathname.startsWith('/media/')) {
    const f = mediaFile(pathname.slice('/media/'.length));
    if (f.error) { res.writeHead(f.status); res.end(f.error); return; }

    // Piste audio spécifique demandée (?audio=N) — servir depuis le cache
    const audioParam = q.get('audio');
    if (audioParam !== null) {
      const job = audioJobs.get(audioHash(f.filePath, parseInt(audioParam, 10)));
      if (job && job.status === 'ready' && fs.existsSync(job.path)) {
        return streamFile(req, res, job.path);
      }
      // Pas encore prêt → fallback fichier original
    }

    return streamFile(req, res, f.filePath);
  }

  if (pathname.startsWith('/api/')) return jsonRes(res,{error:'Introuvable'},404);

  // Fichiers de l'appli : uniquement css/ et js/ — tout le reste renvoie l'interface
  let fp=path.join(__dirname,'index.html');
  if (/^\/(css|js)\/[\w.\-]+$/.test(pathname) && fs.existsSync(path.join(__dirname,pathname))) fp=path.join(__dirname,pathname);
  sendFile(res, fp, MIME[path.extname(fp).toLowerCase()]||'text/plain');
});

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
// Trouver l'IP locale pour l'afficher au démarrage
const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'non trouvée';
};

server.listen(PORT, '0.0.0.0', ()=>{
  const localIP = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        MyFlix  —  Serveur démarré           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Mac    : http://localhost:${PORT}              ║`);
  console.log(`║   Réseau : http://${localIP}:${PORT}    ║`);
  console.log(`║   FFmpeg  : ${FFMPEG?'actif ✓':'inactif ✗'}                       ║`);
  console.log(`║   FFprobe : ${FFPROBE?'actif ✓':'inactif ✗'}                       ║`);
  if (auth.needsSetup())
  console.log('║   1er lancement : crée ton compte admin      ║');
  console.log('║   Laisse cette fenêtre ouverte.              ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  const {exec}=require('child_process');
  if (!process.env.NO_OPEN) setTimeout(()=>exec(`open http://localhost:${PORT}`),800);
});

server.on('error',e=>{
  if(e.code==='EADDRINUSE') console.error(`\nPort ${PORT} déjà utilisé.\n`);
  else console.error('Erreur:',e.message);
  process.exit(1);
});

// ─── MYFLIX ────────────────────────────────────────────────────────────────────
const App = (() => {

  // ── STATE ──
  // Données chargées depuis le serveur au démarrage (voir init())
  // localStorage utilisé comme cache local uniquement
  let movies      = [];
  let customCats  = [];
  let collections = [];
  let directorsData = {};

  // ── PERSISTANCE SERVEUR ───────────────────────────────────────────────────────
  // Toutes les données principales sont sauvegardées dans myflix-data.json via le serveur.
  // localStorage reste en fallback si le serveur est inaccessible.

  const _buildSavePayload = () => ({
    myflix_movies   : JSON.stringify(movies),
    myflix_series   : localStorage.getItem('myflix_series')   || '[]',
    myflix_episodes : localStorage.getItem('myflix_episodes') || '[]',
    myflix_cats        : JSON.stringify(customCats),
    myflix_collections : JSON.stringify(collections),
    myflix_directors   : JSON.stringify(directorsData),
    myflix_featured : localStorage.getItem('myflix_featured') || '[]',
    myflix_progress : localStorage.getItem('myflix_progress') || '{}',
    myflix_sub_style: localStorage.getItem('myflix_sub_style')|| '{}',
  });

  // Sauvegarde immédiate sur le serveur (sans debounce)
  const _flushSaveNow = async () => {
    const payload = _buildSavePayload();
    Object.entries(payload).forEach(([k,v]) => { if(v) localStorage.setItem(k, v); });
    try {
      await fetch(`${API}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch(e) {}
  };

  let _saveTimer = null;
  const _flushSave = async () => {
    const payload = _buildSavePayload();
    Object.entries(payload).forEach(([k,v]) => { if(v) localStorage.setItem(k, v); });
    try {
      await fetch(`${API}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch(e) {}
  };

  // Sauvegarde avec debounce 500ms pour les modifications fréquentes (progression)
  const save = () => {
    localStorage.setItem('myflix_movies', JSON.stringify(movies));
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 500);
  };
  // Sauvegarde immédiate pour les ajouts/modifications importants
  const saveNow = () => {
    localStorage.setItem('myflix_movies', JSON.stringify(movies));
    _flushSaveNow();
  };
  const saveCats = () => {
    localStorage.setItem('myflix_cats', JSON.stringify(customCats));
    _flushSaveNow();
  };

  // Charger les données depuis le serveur ou localStorage
  const _loadData = async () => {
    try {
      const res = await fetch(`${API}/api/data`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.ok && json.data) {
        const d = json.data;
        // Hydrater localStorage depuis le serveur
        Object.entries(d).forEach(([k,v]) => { if(v != null) localStorage.setItem(k, v); });
        // Mettre à jour l'état local
        try { movies       = JSON.parse(d.myflix_movies            || '[]'); } catch(e) { movies = []; }
        try { customCats   = JSON.parse(d.myflix_cats             || '[]'); } catch(e) { customCats = []; }
        try { collections  = JSON.parse(d.myflix_collections     || '[]'); } catch(e) { collections = []; }
        try { directorsData= JSON.parse(d.myflix_directors       || '{}'); } catch(e) { directorsData = {}; }
        try { featuredList = JSON.parse(d.myflix_featured || '[]'); } catch(e) { featuredList = []; }
        // Forcer SeriesManager à relire depuis le localStorage maintenant à jour
        SeriesManager.loadFromStorage();
        console.log('[Data] Loaded from server —', movies.length, 'movies,', SeriesManager.getAll().length, 'series,', SeriesManager.episodes.length, 'episodes');
        return true;
      }
    } catch(e) { console.warn('[Data] Server unreachable:', e.message); }
    // Fallback localStorage
    try { movies       = JSON.parse(localStorage.getItem('myflix_movies')       || '[]'); } catch(e) { movies = []; }
    try { customCats   = JSON.parse(localStorage.getItem('myflix_cats')          || '[]'); } catch(e) { customCats = []; }
    try { collections  = JSON.parse(localStorage.getItem('myflix_collections')   || '[]'); } catch(e) { collections = []; }
    try { directorsData= JSON.parse(localStorage.getItem('myflix_directors')     || '{}'); } catch(e) { directorsData = {}; }
    SeriesManager.loadFromStorage();
    console.log('[Data] Loaded from localStorage —', movies.length, 'movies,', SeriesManager.getAll().length, 'series,', SeriesManager.episodes.length, 'episodes');
    return false;
  };

  let page         = 'home'; // home | films | series | anime | animation | search | genre | custom-cat | series-detail
  let pageParam    = null;   // genre name or custom cat id
  let pageSection  = null;   // section context for genre page
  let searchQ      = '';
  let editId       = null;
  let serverOnline = false;

  // Hero
  let heroPool=[], heroIdx=0, heroProgress=null, heroStart=0;
  const HERO_DUR = 9000;

  // Même origine que la page : fonctionne en local comme derrière une adresse publique
  const API = '';

  // Compte connecté (rempli au démarrage par /api/auth/me)
  let currentUser = null;
  const isAdmin = () => currentUser?.role === 'admin';

  const GENRES_ANIMATION = ['Action','Aventure','Comédie','Drame','Fantastique','Famille','Horreur','Musical','Romance','Science-Fiction','Autre'];
  const GENRES_FILMS  = ['Action','Aventure','Biopic','Comédie','Comédie Musicale','Comédie Dramatique','Crime','Documentaire','Drame','Fantastique','Guerre','Historique','Horreur','Musique','Policier','Romance','Science-Fiction','Sport','Thriller','Western','Autre'];
  const GENRES_SERIES = ['Action','Aventure','Biopic','Comédie','Comédie Dramatique','Crime','Documentaire','Drame','Fantastique','Guerre','Historique','Horreur','Policier','Romance','Science-Fiction','Thriller','Autre'];
  const GENRES_ANIME  = ['Action','Aventure','Comédie','Drame','Fantastique','Guerre','Horreur','Isekai','Mecha','Romance','Science-Fiction','Seinen','Shojo','Shonen','Sport','Autre'];

  // Couleurs par genre (pour les cartes)
  const GENRE_COLORS = {
    'Action':             ['#7f0000','#d50000'],
    'Aventure':           ['#1a237e','#283593'],
    'Biopic':             ['#4e342e','#6d4c41'],
    'Comédie':            ['#e65100','#f57c00'],
    'Comédie Musicale':   ['#ad1457','#e91e63'],
    'Comédie Dramatique': ['#6a1b9a','#9c27b0'],
    'Crime':              ['#212121','#424242'],
    'Documentaire':       ['#1b5e20','#2e7d32'],
    'Drame':              ['#4a148c','#6a1b9a'],
    'Fantastique':        ['#006064','#00838f'],
    'Fantasy':            ['#006064','#00838f'],
    'Guerre':             ['#37474f','#546e7a'],
    'Historique':         ['#3e2723','#5d4037'],
    'Histoire':           ['#3e2723','#5d4037'],
    'Horreur':            ['#1a0000','#550000'],
    'Musique':            ['#880e4f','#ad1457'],
    'Policier':           ['#263238','#455a64'],
    'Romance':            ['#880e4f','#c2185b'],
    'Science-Fiction':    ['#0d47a1','#1565c0'],
    'Sport':              ['#33691e','#558b2f'],
    'Thriller':           ['#263238','#37474f'],
    'Western':            ['#bf360c','#e64a19'],
    'Shonen':             ['#e65100','#bf360c'],
    'Seinen':             ['#1a237e','#0d47a1'],
    'Shojo':              ['#880e4f','#ad1457'],
    'Isekai':             ['#4a148c','#7b1fa2'],
    'Mecha':              ['#37474f','#546e7a'],
    'Autre':              ['#212121','#37474f'],
  };

  const $  = id  => document.getElementById(id);
  const formatBytes = b => b < 1e6 ? (b/1e3).toFixed(0)+' KB' : b < 1e9 ? (b/1e6).toFixed(1)+' MB' : (b/1e9).toFixed(2)+' GB';
  const $$ = sel => document.querySelectorAll(sel);
  const esc= s   => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const uid= ()  => Date.now().toString(36)+Math.random().toString(36).slice(2);
  const svg= id  => `<svg><use href="#${id}"/></svg>`;

  // Session expirée ou compte révoqué → retour à la page de connexion
  const _authCheck = r => { if (r.status === 401) location.href = '/login'; return r; };
  const apiGet  = u => fetch(API+u).then(_authCheck).then(r=>r.json()).catch(()=>null);
  const apiPost = (u,b) => fetch(API+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(_authCheck).then(r=>r.json()).catch(()=>null);

  // ── TOAST ──
  const toast = (msg, type='info') => {
    const el=document.createElement('div'); el.className=`toast ${type}`;
    const icon=type==='success'?'#ic-check':type==='error'?'#ic-x':'#ic-warn';
    el.innerHTML=`<span class="ti">${svg(icon.slice(1))}</span><span>${msg}</span>`;
    $('toast-container').appendChild(el);
    setTimeout(()=>{ el.style.cssText='opacity:0;transform:translateX(20px);transition:.3s'; setTimeout(()=>el.remove(),320); },3000);
  };

  // ── SERVER ──
  const checkServer = async () => {
    const d=await apiGet('/api/status'); serverOnline=!!(d&&d.ok);
    if(d?.ffprobe) FFPROBE_AVAILABLE=true;
    const banner=$('disk-banner'); if(!banner) return;
    if (!serverOnline) {
      banner.className='show error';
      banner.innerHTML=`<span class="db-dot"></span><span class="db-text">Serveur non détecté — lance <strong>LANCER_MYFLIX.command</strong></span>`;
    } else if (!d.mediaExists) {
      banner.className='show warning';
      banner.innerHTML=isAdmin()
        ? `<span class="db-dot"></span><span class="db-text">Aucun disque configuré</span><button class="db-btn" onclick="App.openDisk()">Configurer</button>`
        : `<span class="db-dot"></span><span class="db-text">Les vidéos sont momentanément indisponibles</span>`;
    } else { banner.className=''; }
    _refreshPendingBadge();
    $('navbar').classList.toggle('has-banner', banner.classList.contains('show'));
  };

  // ── DISK ──
  const openDisk = async () => {
    openModal('modal-disk');
    const d=await apiGet('/api/volumes'); if(!d) return;
    const list=$('vol-list'); list.innerHTML='';
    d.volumes.forEach(v=>{ const div=document.createElement('div'); div.className='vol-item'; div.innerHTML=`<div><div class="vol-name">${esc(v.name)}</div><div class="vol-path">${esc(v.path)}</div></div><button class="vol-pick" onclick="App.pickVol('${esc(v.path)}')">Choisir</button>`; list.appendChild(div); });
  };
  const closeDisk=()=>closeModal('modal-disk');
  const pickVol=p=>{ $('disk-path-input').value=p; };
  const confirmDisk=async()=>{ const p=$('disk-path-input').value.trim(); if(!p){toast('Saisis un chemin','error');return;} const d=await apiPost('/api/config',{mediaPath:p}); if(!d||d.error){toast(d?.error||'Chemin introuvable','error');return;} toast('Disque configuré !','success'); closeDisk(); checkServer(); };

  // ── SCAN ──
  const scanDisk=async()=>{
    if(!serverOnline){toast('Lance le serveur d\'abord','error');return;}
    $('scan-btn').textContent='Scan…'; $('scan-btn').disabled=true;
    const d=await apiGet('/api/scan');
    $('scan-btn').innerHTML=`${svg('ic-scan')} Scanner`; $('scan-btn').disabled=false;
    if(!d||d.error){toast(d?.error||'Configure le disque d\'abord','error');return;}
    if(!d.files.length){toast('Aucune vidéo trouvée','warning');return;}
    $('scan-count').textContent=`${d.files.length} vidéo${d.files.length>1?'s':''} trouvée${d.files.length>1?'s':''}`;
    const list=$('scan-list'); list.innerHTML='';
    d.files.forEach(f=>{
      const exists=movies.find(m=>m.videoRef===f.rel);
      const div=document.createElement('div'); div.className='scan-item';
      div.innerHTML=`<div style="min-width:0;flex:1"><div class="scan-name">${esc(f.name)}</div><div class="scan-meta">${f.folder?esc(f.folder)+' · ':''}${f.sizeMB} MB</div></div>${exists?`<span class="scan-done">${svg('ic-check')} Ajouté</span>`:`<button class="scan-add" onclick="App.fromScan('${esc(f.rel)}','${esc(f.name)}')">Ajouter</button>`}`;
      list.appendChild(div);
    });
    openModal('modal-scan');
  };

  const fromScan=(rel,filename)=>{
    closeModal('modal-scan');
    openAdd();
    const title=filename.replace(/\.[^.]+$/,'').replace(/[._-]/g,' ').replace(/\(.*?\)|\[.*?\]/g,'').replace(/\s{2,}/g,' ').trim();
    $('f-title').value=title;
    window._vref=rel;
    $('fi-name').textContent=filename;
    $('fi-size').textContent='— disque dur';
    $('video-info').style.display='flex';
    $('disk-notice').style.display='flex';
  };

  // ── FILE PICKER — sélecteur disque + fichiers ─────────────────────────────
  let _filePickerMode = 'film'; // 'film' | 'episode'
  let _fpFiles = []; // cache de la liste courante

  const openFilePicker = async (mode = 'film') => {
    _filePickerMode = mode;
    if (!serverOnline) {
      toast('Le serveur n\'est pas démarré — lance LANCER_MYFLIX.command', 'error');
      return;
    }

    // Afficher la modale avec un état de chargement
    $('fp-list').innerHTML = `<div style="color:var(--text-3);font-size:13px;text-align:center;padding:2rem">Chargement…</div>`;
    $('fp-search').value = '';
    $('fp-disk-bar').style.display = 'none';
    openModal('modal-filepicker');

    // Récupérer le statut du serveur (disque actuel)
    const status = await apiGet('/api/status');
    const volumes = await apiGet('/api/volumes');

    // Afficher la barre de sélection de disque
    const diskBar = $('fp-disk-bar');
    diskBar.style.display = 'flex';
    const diskSelect = $('fp-disk-select');
    diskSelect.innerHTML = '';
    if (volumes?.volumes) {
      volumes.volumes.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.path; opt.textContent = `${v.name}  (${v.path})`;
        if (status?.mediaPath && v.path === status.mediaPath) opt.selected = true;
        diskSelect.appendChild(opt);
      });
    }

    // Charger les fichiers du disque actuellement configuré
    await _loadFpFiles();
  };

  const _loadFpFiles = async () => {
    $('fp-list').innerHTML = `<div style="color:var(--text-3);font-size:13px;text-align:center;padding:2rem">Chargement des fichiers…</div>`;
    const d = await apiGet('/api/files');
    if (!d || d.error) {
      $('fp-list').innerHTML = `<div style="color:var(--accent);font-size:13px;text-align:center;padding:2rem">${d?.error || 'Aucun disque configuré — sélectionne un disque ci-dessus'}</div>`;
      return;
    }
    _fpFiles = d.files;
    renderFilePickerList(_fpFiles, $('fp-search').value || '');
  };

  const fpSwitchDisk = async () => {
    const path = $('fp-disk-select').value;
    if (!path) return;
    $('fp-list').innerHTML = `<div style="color:var(--text-3);font-size:13px;text-align:center;padding:2rem">Changement de disque…</div>`;
    const d = await apiPost('/api/config', { mediaPath: path });
    if (!d || d.error) {
      toast(d?.error || 'Chemin introuvable', 'error');
      return;
    }
    toast(`Disque changé : ${path.split('/').pop()}`, 'success');
    await _loadFpFiles();
  };

  const renderFilePickerList = (files, query) => {
    const list = $('fp-list'); list.innerHTML = '';

    // Construire le Set de tous les fichiers déjà utilisés (films + épisodes)
    const usedRels = new Set();
    movies.forEach(m => { if (m.videoRef) usedRels.add(m.videoRef); });
    SeriesManager.getAll().forEach(s => {
      SeriesManager.getEpisodes(s.id).forEach(ep => { if (ep.videoRef) usedRels.add(ep.videoRef); });
    });

    const filtered = query
      ? files.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
      : files;

    if (!filtered.length) {
      list.innerHTML = `<div style="color:var(--text-3);font-size:13px;text-align:center;padding:2rem">${query ? `Aucun résultat pour "${esc(query)}"` : 'Aucune vidéo trouvée sur ce disque.'}</div>`;
      return;
    }

    // Séparer disponibles et déjà ajoutés
    const available = filtered.filter(f => !usedRels.has(f.rel));
    const used      = filtered.filter(f =>  usedRels.has(f.rel));

    const mkItem = (f, isUsed) => {
      const div = document.createElement('div');
      div.className = 'fp-item' + (isUsed ? ' fp-item--used' : '');
      // Trouver le nom du film/épisode associé
      let usedLabel = '';
      if (isUsed) {
        const film = movies.find(m => m.videoRef === f.rel);
        if (film) {
          usedLabel = film.title;
        } else {
          SeriesManager.getAll().forEach(s => {
            SeriesManager.getEpisodes(s.id).forEach(ep => {
              if (ep.videoRef === f.rel) usedLabel = `${s.title} — S${ep.season}E${ep.episode}`;
            });
          });
        }
      }
      div.innerHTML = `
        <div class="fp-item-icon"><svg width="16" height="16"><use href="#ic-film"/></svg></div>
        <div class="fp-item-info">
          <div class="fp-item-name">${esc(f.name)}</div>
          <div class="fp-item-meta">
            ${f.sizeMB} MB
            ${f.folder ? `· <span style="color:var(--text-3)">${esc(f.folder)}</span>` : ''}
            ${isUsed ? `· <span style="color:#4caf50">✓ ${esc(usedLabel)}</span>` : ''}
          </div>
        </div>
        <button class="fp-item-btn${isUsed ? ' fp-item-btn--used' : ''}" onclick="App.pickFile('${esc(f.rel)}','${esc(f.name)}')">${isUsed ? 'Choisir quand même' : 'Choisir'}</button>`;
      list.appendChild(div);
    };

    // Afficher d'abord les disponibles
    if (available.length) {
      available.forEach(f => mkItem(f, false));
    }

    // Puis les déjà ajoutés sous un séparateur
    if (used.length) {
      const sep = document.createElement('div');
      sep.style.cssText = 'padding:.5rem .8rem;font-size:11px;font-family:var(--font-b);color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border);margin-top:.4rem;';
      sep.textContent = `Déjà ajoutés — ${used.length}`;
      list.appendChild(sep);
      used.forEach(f => mkItem(f, true));
    }
  };

  const pickFile = (rel, filename) => {
    closeModal('modal-filepicker');

    if (_filePickerMode === 'episode') {
      epCurrentFileRef = rel;
      $('ep-file-name').textContent = filename;
      $('ep-file-size').textContent = '— disque dur';
      return;
    }

    if (_filePickerMode === 'episode-edit') {
      if (_epEditId) {
        SeriesManager.updateEpisode(_epEditId, { videoRef: rel });
        toast('Fichier vidéo mis à jour', 'success');
        const editModal = document.getElementById('modal-ep-edit');
        if (editModal) {
          const fileDiv = editModal.querySelector('.fg:last-of-type div');
          if (fileDiv) fileDiv.innerHTML = `<div style="word-break:break-all">${esc(rel.split('/').pop())}</div>`;
        }
      }
      return;
    }

    if (_filePickerMode === 'film-edit') {
      // Changement de fichier depuis le formulaire d'édition
      window._vref = rel;
      $('fi-name').textContent = filename;
      $('fi-size').textContent = '— disque dur';
      $('video-info').style.display = 'flex';
      $('disk-notice').style.display = 'flex';
      $('btn-choose-video').style.display = 'none';
      if($('btn-change-video')) $('btn-change-video').style.display = 'flex';
      toast('Fichier vidéo modifié', 'success');
      return;
    }

    // Mode 'film' depuis le bouton "+ Ajouter" → demander Film ou Série
    const guessedTitle = filename.replace(/\.[^.]+$/,'').replace(/[._-]/g,' ').replace(/\(.*?\)|\[.*?\]/g,'').replace(/\s{2,}/g,' ').trim();
    openTypeChoice(rel, filename, guessedTitle);
  };

  // ── CHOIX TYPE : Film ou Série ────────────────────────────────────────────────
  const openTypeChoice = (rel, filename, guessedTitle) => {
    const overlay = document.createElement('div');
    overlay.className = 'm-overlay open'; overlay.id = 'modal-type-choice';
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="m-box" style="max-width:400px">
        <div class="m-head">
          <h2>TYPE DE CONTENU</h2>
          <div class="m-close" id="tc-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body">
          <p style="color:var(--text-2);font-size:13px;line-height:1.6;margin-bottom:1.2rem">
            <svg width="13" height="13" style="vertical-align:middle;margin-right:4px"><use href="#ic-film"/></svg>
            <strong style="color:#fff">${esc(guessedTitle)}</strong><br>
            <span style="color:var(--text-3)">S'agit-il d'un film ou d'un épisode de série ?</span>
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
            <button class="btn-submit" id="tc-film" style="margin:0;display:flex;align-items:center;justify-content:center;gap:.4rem">
              <svg width="14" height="14"><use href="#ic-film"/></svg> Film
            </button>
            <button class="btn-submit" id="tc-series" style="margin:0;background:rgba(255,255,255,.08);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:.4rem">
              <svg width="14" height="14"><use href="#ic-tag"/></svg> Série / Anime
            </button>
          </div>
          <button id="tc-cancel" style="background:none;border:none;color:var(--text-3);font-family:var(--font-b);font-size:12px;cursor:pointer;padding:8px;margin-top:.4rem;width:100%">Annuler</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => { overlay.remove(); document.body.style.overflow = ''; };

    overlay.querySelector('#tc-close').onclick = close;
    overlay.querySelector('#tc-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#tc-film').onclick = () => {
      close();
      openAdd();
      setTimeout(() => {
        $('f-title').value = guessedTitle;
        window._vref = rel;
        $('fi-name').textContent = filename;
        $('fi-size').textContent = '— disque dur';
        $('video-info').style.display = 'flex';
        $('disk-notice').style.display = 'flex';
      }, 80);
    };

    overlay.querySelector('#tc-series').onclick = () => {
      close();
      openAddEpisodeFlow(rel, filename, guessedTitle);
    };
  };

  // ── FLUX SÉRIE : modale unifiée en 2 étapes ───────────────────────────────────
  // État partagé du flux
  let _epFlowRel = null;
  let _epFlowFilename = null;
  let _epFlowSeriesId = null; // null = nouvelle série

  const openAddEpisodeFlow = (rel, filename, guessedTitle) => {
    _epFlowRel = rel;
    _epFlowFilename = filename;
    _epFlowSeriesId = null;
    epCurrentFileRef = rel;
    openModal('modal-series-flow');
    // Afficher étape 1
    _showFlowStep1(guessedTitle);
  };

  const _showFlowStep1 = (prefillTitle = '') => {
    const allSeries = SeriesManager.getAll();
    const box = $('series-flow-box');
    box.innerHTML = `
      <div class="m-head">
        <h2>ÉTAPE 1 — SÉRIE</h2>
        <div class="m-close" onclick="App.closeSeriesFlow()"><svg><use href="#ic-x"/></svg></div>
      </div>
      <div class="m-body">

        <!-- Tabs : Série existante / Nouvelle série -->
        <div class="sf-tabs" id="sf-tabs">
          <button class="sf-tab active" id="sf-tab-existing" onclick="App._flowTabSwitch('existing')">Série existante</button>
          <button class="sf-tab" id="sf-tab-new" onclick="App._flowTabSwitch('new')">+ Nouvelle série</button>
        </div>

        <!-- Panel : série existante -->
        <div id="sf-panel-existing">
          ${allSeries.length === 0
            ? `<p style="color:var(--text-3);font-size:13px;text-align:center;padding:1.5rem 0">Aucune série encore — crée-en une via l'onglet ci-dessus.</p>`
            : `<div class="sf-series-list" id="sf-series-list">
                ${allSeries.map(s => {
                  const ps = imgUrl(s.poster);
                  return `<div class="sf-series-item${_epFlowSeriesId===s.id?' selected':''}" onclick="App._flowSelectSeries('${s.id}')">
                    <div class="sf-series-thumb">${ps?`<img src="${esc(ps)}" alt="">`:`<svg><use href="#ic-film"/></svg>`}</div>
                    <div class="sf-series-name">${esc(s.title)}</div>
                    <div class="sf-series-meta">${s.section==='anime'?'Anime':'Série'}${s.year?' · '+esc(s.year):''}${' · '+SeriesManager.countEpisodes(s.id)+' ép.'}</div>
                  </div>`;
                }).join('')}
              </div>`
          }
        </div>

        <!-- Panel : nouvelle série (masqué par défaut) -->
        <div id="sf-panel-new" style="display:none">
          <div class="fg">
            <label>Titre de la série *</label>
            <input type="text" id="sf2-title" placeholder="Ex : Breaking Bad" maxlength="200" value="${esc(prefillTitle)}">
          </div>
          <div class="fg-row">
            <div class="fg">
              <label>Année de début</label>
              <input type="number" id="sf2-year" placeholder="2008" min="1888" max="2099">
            </div>
            <div class="fg">
              <label>Section</label>
              <select id="sf2-section" onchange="App._flowRefreshGenres()">
                <option value="series">Séries</option>
                <option value="anime">Anime</option>
              </select>
            </div>
          </div>
          <div class="fg">
            <label>Genres</label>
            <div class="genre-picker" id="sf2-genre-picker"></div>
          </div>
          <div class="fg">
            <label>Note /10</label>
            <input type="number" id="sf2-rating" placeholder="9.5" min="0" max="10" step="0.1">
          </div>
          <div class="fg">
            <label>Synopsis</label>
            <textarea id="sf2-description" placeholder="Description de la série…" rows="3"></textarea>
          </div>
          <!-- Affiche -->
          <div class="fg">
            <label>Affiche <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— nom du fichier dans <code>images/</code></span></label>
            <div class="img-input-wrap">
              <input type="text" id="sf2-poster-name" placeholder="ex: serie-cover.jpg" autocomplete="off">
              <div class="poster-thumb" id="sf2-poster-thumb">
                <img id="sf2-poster-img" src="" alt="" style="display:none;width:100%;height:100%;object-fit:cover">
                <svg><use href="#ic-film"/></svg>
              </div>
            </div>
          </div>
          <!-- Paysage -->
          <div class="fg">
            <label>Image paysage <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— bandeau héro</span></label>
            <input type="text" id="sf2-backdrop-name" placeholder="ex: serie-backdrop.jpg" autocomplete="off">
            <div id="sf2-backdrop-wrap" style="display:none;margin-top:.5rem"><img id="sf2-backdrop-img" src="" alt=""></div>
          </div>
          <!-- Logo -->
          <div class="fg">
            <label>Logo <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— PNG transparent</span></label>
            <input type="text" id="sf2-logo-name" placeholder="ex: serie-logo.png" autocomplete="off">
            <div id="sf2-logo-wrap" style="display:none;margin-top:.5rem;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:var(--r);padding:.8rem;text-align:center">
              <img id="sf2-logo-img" src="" alt="" style="max-height:50px;max-width:100%;object-fit:contain">
            </div>
          </div>
        </div>

        <button class="btn-submit" id="sf-flow-next" onclick="App._flowStep1Next()" style="margin-top:1.2rem">
          Suivant →
        </button>
      </div>`;

    // Init genre picker nouvelle série
    setTimeout(() => {
      _flowSelectedGenres = [];
      _flowRefreshGenres();
      // Watchers images
      _watchFlowImg('sf2-poster-name', 'sf2-poster-img', null, show => {
        const svgEl = $('sf2-poster-thumb')?.querySelector('svg');
        if (svgEl) svgEl.style.display = show ? 'none' : '';
      });
      _watchFlowImg('sf2-backdrop-name', 'sf2-backdrop-img', 'sf2-backdrop-wrap');
      _watchFlowImg('sf2-logo-name', 'sf2-logo-img', 'sf2-logo-wrap');
      // Si aucune série : auto-basculer sur "nouvelle série"
      if (allSeries.length === 0) _flowTabSwitch('new');
    }, 30);
  };

  let _flowSelectedGenres = [];

  const _flowRefreshGenres = () => {
    const section = $('sf2-section')?.value || 'series';
    const genres = section === 'anime' ? GENRES_ANIME : GENRES_SERIES;
    const el = $('sf2-genre-picker'); if (!el) return; el.innerHTML = '';
    genres.forEach(g => {
      const chip = document.createElement('span');
      chip.className = 'gp-chip' + (_flowSelectedGenres.includes(g) ? ' selected' : '');
      chip.textContent = g;
      chip.addEventListener('click', () => {
        if (_flowSelectedGenres.includes(g)) _flowSelectedGenres = _flowSelectedGenres.filter(x=>x!==g);
        else _flowSelectedGenres.push(g);
        chip.classList.toggle('selected', _flowSelectedGenres.includes(g));
      });
      el.appendChild(chip);
    });
  };

  const _watchFlowImg = (inputId, previewId, wrapId, onSet) => {
    const inp = $(inputId); if (!inp) return;
    inp.addEventListener('input', () => {
      const name = inp.value.trim();
      const prev = $(previewId);
      if (prev && name) {
        prev.src = imgUrl(name); prev.style.display = 'block';
        if (wrapId && $(wrapId)) $(wrapId).style.display = 'block';
        if (onSet) onSet(true);
      } else if (prev) {
        prev.style.display = 'none';
        if (onSet) onSet(false);
      }
    });
  };

  const _flowTabSwitch = (tab) => {
    $('sf-tab-existing')?.classList.toggle('active', tab === 'existing');
    $('sf-tab-new')?.classList.toggle('active', tab === 'new');
    const pEx = $('sf-panel-existing');
    const pNew = $('sf-panel-new');
    if (pEx) pEx.style.display = tab === 'existing' ? '' : 'none';
    if (pNew) pNew.style.display = tab === 'new' ? '' : 'none';
  };

  const _flowSelectSeries = (sid) => {
    _epFlowSeriesId = sid;
    // Mettre en évidence la sélection
    $$('.sf-series-item').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.sf-series-item[onclick*="${sid}"]`)?.classList.add('selected');
  };

  const _flowStep1Next = () => {
    const existingPanel = $('sf-panel-existing');
    const newPanel = $('sf-panel-new');
    const isNew = newPanel && newPanel.style.display !== 'none';

    if (isNew) {
      // Créer la nouvelle série
      const title = $('sf2-title')?.value.trim();
      if (!title) { toast('Le titre de la série est requis', 'error'); return; }
      const s = SeriesManager.createSeries({
        title,
        year: $('sf2-year')?.value || '',
        section: $('sf2-section')?.value || 'series',
        genres: _flowSelectedGenres.length ? [..._flowSelectedGenres] : ['Autre'],
        rating: $('sf2-rating')?.value || '',
        description: $('sf2-description')?.value.trim() || '',
        poster: $('sf2-poster-name')?.value.trim() || null,
        backdrop: $('sf2-backdrop-name')?.value.trim() || null,
        logo: $('sf2-logo-name')?.value.trim() || null,
      });
      _epFlowSeriesId = s.id;
      toast(`Série "${title}" créée !`, 'success');
    } else {
      // Série existante sélectionnée ?
      if (!_epFlowSeriesId) { toast('Sélectionne une série dans la liste', 'error'); return; }
    }

    // Passer à l'étape 2
    _showFlowStep2();
  };

  const _showFlowStep2 = () => {
    const s = SeriesManager.getById(_epFlowSeriesId);
    const ps = imgUrl(s?.poster);
    const box = $('series-flow-box');
    box.innerHTML = `
      <div class="m-head">
        <h2>ÉPISODE</h2>
        <div class="m-close" onclick="App.closeSeriesFlow()"><svg><use href="#ic-x"/></svg></div>
      </div>
      <div class="m-body">

        <!-- Série sélectionnée -->
        <div class="sf-selected-series-banner">
          <div class="sf-ssb-thumb">${ps?`<img src="${esc(ps)}" alt="">`:`<svg width="16" height="16"><use href="#ic-film"/></svg>`}</div>
          <div class="sf-ssb-info">
            <div class="sf-ssb-title">${esc(s?.title||'')}</div>
            <div class="sf-ssb-meta">${s?.section==='anime'?'Anime':'Série'}${s?.year?' · '+esc(s.year):''}</div>
          </div>
          <button onclick="App._flowBackToStep1()" style="background:none;border:1px solid var(--border);color:var(--text-3);border-radius:4px;padding:.3rem .65rem;font-family:var(--font-b);font-size:11px;cursor:pointer;white-space:nowrap;flex-shrink:0">← Changer</button>
        </div>

        <!-- Fichier vidéo -->
        <div class="fg">
          <label>Fichier vidéo</label>
          <div style="display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:var(--r);font-size:12px;color:var(--text-2);font-family:var(--font-b)">
            <svg width="13" height="13" style="flex-shrink:0;color:var(--text-3)"><use href="#ic-film"/></svg>
            <span style="flex:1;min-width:0;word-break:break-all;line-height:1.3">${esc(_epFlowFilename)}</span>
            <span style="color:var(--text-3);white-space:nowrap;flex-shrink:0">disque dur</span>
          </div>
        </div>

        <!-- Option sans saison -->
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem">
          <label style="display:flex;align-items:center;gap:.45rem;cursor:pointer;font-family:var(--font-b);font-size:12px;color:var(--text-2);text-transform:none;letter-spacing:0;font-weight:400">
            <input type="checkbox" id="flow-no-season" style="accent-color:var(--accent);width:14px;height:14px;cursor:pointer"
              ${_seriesHasNoSeason(_epFlowSeriesId)?'checked':''}>
            <span>Série sans saison</span>
          </label>
          <span style="font-size:10px;color:var(--text-3);font-family:var(--font-b)">— les épisodes seront listés directement</span>
        </div>

        <!-- Saison / Épisode -->
        <div class="fg-row" id="flow-season-row" style="${_seriesHasNoSeason(_epFlowSeriesId)?'display:none':''}">
          <div class="fg">
            <label>Saison *</label>
            <input type="number" id="flow-ep-season" value="1" min="1" max="99">
          </div>
          <div class="fg">
            <label>Épisode *</label>
            <input type="number" id="flow-ep-number" value="${_nextEpisodeNumber(_epFlowSeriesId)}" min="1" max="999">
          </div>
        </div>
        <div class="fg" id="flow-noseason-ep-row" style="${_seriesHasNoSeason(_epFlowSeriesId)?'':'display:none'}">
          <label>Numéro d'épisode *</label>
          <input type="number" id="flow-ep-number-ns" value="${_nextEpisodeNumber(_epFlowSeriesId)}" min="1" max="9999">
        </div>

        <!-- Titre épisode -->
        <div class="fg">
          <label>Titre <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— optionnel</span></label>
          <input type="text" id="flow-ep-title" placeholder="Ex : Pilote, Le retour…">
        </div>

        <!-- Durée -->
        <div class="fg">
          <label>Durée <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— optionnel</span></label>
          <input type="text" id="flow-ep-duration" placeholder="Ex : 23 min, 1h 12min…">
        </div>

        <!-- Description -->
        <div class="fg">
          <label>Description <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— optionnel</span></label>
          <textarea id="flow-ep-desc" placeholder="Résumé de l'épisode…" rows="2" style="resize:vertical"></textarea>
        </div>

        <!-- Thumbnail -->
        <div class="fg">
          <label>Image de l'épisode <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— nom du fichier dans <code>images/</code></span></label>
          <input type="text" id="flow-ep-thumb" placeholder="ex: pluribus-s01e01.jpg" autocomplete="off">
          <div id="flow-ep-thumb-preview" style="display:none;margin-top:.5rem;border-radius:6px;overflow:hidden;max-height:120px">
            <img id="flow-ep-thumb-img" src="" alt="" style="width:100%;height:120px;object-fit:cover">
          </div>
        </div>

        <!-- Boutons -->
        <div style="display:flex;align-items:center;gap:.6rem;margin-top:1.2rem">
          <button onclick="App._flowBackToStep1()" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.65rem 1rem;font-family:var(--font-b);font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">← Retour</button>
          <button class="btn-submit" id="flow-ep-save" onclick="App._flowSaveEpisode()" style="flex:1;margin:0">Enregistrer l'épisode</button>
        </div>

      </div>`;

    // Watcher thumbnail + toggle sans-saison
    setTimeout(() => {
      const inp = $('flow-ep-thumb');
      if (inp) {
        inp.addEventListener('input', () => {
          const name = inp.value.trim();
          const wrap = $('flow-ep-thumb-preview');
          const img  = $('flow-ep-thumb-img');
          if (name && wrap && img) { img.src = imgUrl(name) || ''; wrap.style.display = 'block'; }
          else if (wrap) { wrap.style.display = 'none'; }
        });
      }
      const noSeasonChk = $('flow-no-season');
      if (noSeasonChk) {
        noSeasonChk.addEventListener('change', () => {
          const noSeason = noSeasonChk.checked;
          const seasonRow = $('flow-season-row');
          const nsRow     = $('flow-noseason-ep-row');
          if (seasonRow) seasonRow.style.display = noSeason ? 'none' : '';
          if (nsRow)     nsRow.style.display     = noSeason ? '' : 'none';
          if (_epFlowSeriesId) SeriesManager.updateSeries(_epFlowSeriesId, { noSeason });
        });
      }
    }, 30);
  };

  const _seriesHasNoSeason = (sid) => {
    if (!sid) return false;
    const s = SeriesManager.getById(sid);
    return !!(s && s.noSeason);
  };

  const _nextEpisodeNumber = (sid) => {
    const eps = SeriesManager.getEpisodes(sid);
    if (!eps.length) return 1;
    return Math.max(...eps.map(e => e.episode)) + 1;
  };

  const _flowBackToStep1 = () => {
    _showFlowStep1();
    if (_epFlowSeriesId) {
      setTimeout(() => {
        _flowTabSwitch('existing');
        _epFlowSeriesId = null; // reset pour forcer une nouvelle sélection
      }, 30);
    }
  };

  const _flowSaveEpisode = () => {
    const noSeason = _seriesHasNoSeason(_epFlowSeriesId);
    const season   = noSeason ? 0 : (parseInt($('flow-ep-season')?.value) || 1);
    const epInput  = noSeason ? $('flow-ep-number-ns') : $('flow-ep-number');
    const episode  = parseInt(epInput?.value) || 1;
    const btn = $('flow-ep-save'); if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    if (SeriesManager.episodeExists(_epFlowSeriesId, season, episode)) {
      const _lbl2 = noSeason ? ('\u00c9p. ' + episode) : ('S' + season + 'E' + String(episode).padStart(2,'0'));
      if (!confirm(_lbl2 + ' existe d\u00e9j\u00e0. Remplacer ?')) {
        if (btn) { btn.disabled = false; btn.textContent = "Enregistrer l'épisode"; }
        return;
      }
      const existing = SeriesManager.getEpisodes(_epFlowSeriesId).find(e=>e.season===season&&e.episode===episode);
      if (existing) SeriesManager.deleteEpisode(existing.id);
    }

    SeriesManager.addEpisode({
      seriesId: _epFlowSeriesId, season, episode,
      title      : $('flow-ep-title')?.value.trim()    || `Épisode ${episode}`,
      duration   : $('flow-ep-duration')?.value.trim() || '',
      description: $('flow-ep-desc')?.value.trim()     || '',
      thumb      : $('flow-ep-thumb')?.value.trim()    || null,
      videoRef   : _epFlowRel
    });

    const s = SeriesManager.getById(_epFlowSeriesId);
    const _lbl = noSeason ? ('\u00c9p. ' + episode) : ('S' + season + 'E' + String(episode).padStart(2,'0'));
    toast(_lbl + ' — "' + (s?.title||'') + '" ajout\u00e9 !', 'success');
    closeSeriesFlow();
    renderPage();
  };

  const closeSeriesFlow = () => {
    closeModal('modal-series-flow');
    _epFlowRel = null; _epFlowFilename = null; _epFlowSeriesId = null;
  };


  // ══════════════════════════════════════════════════════
  // ── COLLECTIONS ──────────────────────────────────────
  // ══════════════════════════════════════════════════════

  const saveCollections = () => {
    localStorage.setItem('myflix_collections', JSON.stringify(collections));
    _flushSaveNow();
  };

  const cropBgStyle = (url, crop) => {
    if (!url) return '';
    if (crop && crop.bgX !== undefined) {
      const dx = 100-crop.bgW, dy = 100-crop.bgH;
      const px = dx>0 ? crop.bgX/dx*100 : 50;
      const py = dy>0 ? crop.bgY/dy*100 : 50;
      return 'background-image:url('+url+');background-size:'+(100/crop.bgW*100)+'%;background-position:'+px+'% '+py+'%';
    }
    return 'background-image:url('+url+');background-size:cover;background-position:center top';
  };

  let _colEditId = null;
  let _colFilmIds = [];
  let _colDragIdx = null;

  const _colRemoveFilm = (idx) => { _colFilmIds.splice(idx,1); _renderColFilmsList(); };

  const _renderColFilmsList = () => {
    const el = $('col-films-list'); if (!el) return;
    el.innerHTML = '';
    if (!_colFilmIds.length) {
      el.innerHTML = '<div style="color:var(--text-3);font-size:12px;text-align:center;padding:.7rem">Aucun film — recherche ci-dessous</div>'; return;
    }
    _colFilmIds.forEach((fid, idx) => {
      const m = movies.find(m=>m.id===fid); if (!m) return;
      const ps = posterSrc(m);
      const row = document.createElement('div');
      row.className = 'col-film-row'; row.draggable = true; row.dataset.idx = idx;
      row.innerHTML = '<div class="col-film-row-handle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg></div>'
        + '<div class="col-film-row-thumb" style="'+(ps?'background-image:url('+ps+')':'')+'">'+(!ps?'<svg><use href="#ic-film"/></svg>':'')+'</div>'
        + '<div class="col-film-row-title">'+esc(m.title)+'</div>'
        + (m.year?'<div class="col-film-row-year">'+esc(m.year)+'</div>':'')
        + '<button class="col-film-row-del" onclick="App._colRemoveFilm('+idx+')" title="Retirer"><svg width="13" height="13"><use href="#ic-x"/></svg></button>';
      row.addEventListener('dragstart', e => { _colDragIdx=idx; e.dataTransfer.effectAllowed='move'; setTimeout(()=>row.classList.add('dragging'),0); });
      row.addEventListener('dragend', ()=>row.classList.remove('dragging'));
      row.addEventListener('dragover', e => { e.preventDefault(); const oi=parseInt(row.dataset.idx); if(_colDragIdx===null||_colDragIdx===oi) return; const item=_colFilmIds.splice(_colDragIdx,1)[0]; _colFilmIds.splice(oi,0,item); _colDragIdx=oi; _renderColFilmsList(); });
      el.appendChild(row);
    });
  };

  const _initColFilmSearch = () => {
    const inp=$('col-film-search'), drop=$('col-film-dropdown'); if (!inp||!drop) return;
    inp.addEventListener('input', () => {
      const q=inp.value.trim().toLowerCase(); drop.innerHTML='';
      if (!q) { drop.style.display='none'; return; }
      const results=movies.filter(m=>!_colFilmIds.includes(m.id)&&m.title.toLowerCase().includes(q)).slice(0,8);
      if (!results.length) { drop.innerHTML='<div style="color:var(--text-3);font-size:12px;padding:.7rem;text-align:center">Aucun film trouvé</div>'; drop.style.display='block'; return; }
      results.forEach(m => {
        const ps=posterSrc(m), item=document.createElement('div'); item.className='col-film-drop-item';
        item.innerHTML='<div class="col-film-drop-thumb" style="'+(ps?'background-image:url('+ps+')':'')+'">'+(!ps?'<svg><use href="#ic-film"/></svg>':'')+'</div>'
          +'<div><div class="col-film-drop-name">'+esc(m.title)+'</div><div class="col-film-drop-meta">'+(m.year||'')+((m.year&&m.genres?.length)?' · ':'')+((m.genres||[]).slice(0,2).join(', '))+'</div></div>';
        item.addEventListener('click', () => { _colFilmIds.push(m.id); _renderColFilmsList(); inp.value=''; drop.style.display='none'; });
        drop.appendChild(item);
      });
      drop.style.display='block';
    });
    inp.addEventListener('blur', ()=>setTimeout(()=>{drop.style.display='none';},150));
  };

  const openNewCollection = () => {
    _colEditId=null; _colFilmIds=[];
    $('modal-collection-title').textContent='NOUVELLE COLLECTION';
    ['col-title','col-description','col-year','col-director'].forEach(id=>{const el=$(id);if(el)el.value='';});
    ['col-logo-name','col-backdrop-name'].forEach(id=>{const el=$(id);if(el)el.value='';});
    ['col-logo-wrap','col-backdrop-wrap'].forEach(id=>{const el=$(id);if(el)el.style.display='none';});
    $('col-submit').textContent='Créer la collection';
    _renderColFilmsList(); openModal('modal-collection');
  };

  const openEditCollection = (id) => {
    const col=collections.find(c=>c.id===id); if(!col) return;
    _colEditId=id; _colFilmIds=[...(col.filmIds||[])];
    $('modal-collection-title').textContent='MODIFIER LA COLLECTION';
    $('col-title').value=col.title||''; $('col-description').value=col.description||'';
    $('col-year').value=col.year||''; $('col-director').value=col.director||'';
    if($('col-logo-name')) $('col-logo-name').value=col.logo||'';
    if($('col-backdrop-name')) $('col-backdrop-name').value=col.backdrop||'';
    const lw=$('col-logo-wrap'); if(lw) lw.style.display=col.logo?'block':'none';
    const bw=$('col-backdrop-wrap'); if(bw) bw.style.display=col.backdrop?'block':'none';
    if(col.logo&&$('col-logo-img')) $('col-logo-img').src=imgUrl(col.logo);
    if(col.backdrop&&$('col-backdrop-img')) { $('col-backdrop-img').src=imgUrl(col.backdrop); }
    $('col-submit').textContent='Enregistrer';
    _renderColFilmsList(); closeCollectionDetail(); openModal('modal-collection');
  };

  const submitCollection = () => {
    const title=($('col-title').value||'').trim(); if(!title){toast('Le titre est requis','error');return;}
    const prev=_colEditId?collections.find(c=>c.id===_colEditId):null;
    const data={
      title, description:($('col-description').value||'').trim(),
      year:$('col-year').value||'', director:($('col-director').value||'').trim(),
      logo:($('col-logo-name')?.value.trim())||prev?.logo||null,
      backdrop:($('col-backdrop-name')?.value.trim())||prev?.backdrop||null,
      filmIds:[..._colFilmIds],
    };
    if(_colEditId){const idx=collections.findIndex(c=>c.id===_colEditId);if(idx!==-1)collections[idx]={...collections[idx],...data,updatedAt:Date.now()};toast('Collection mise à jour !','success');}
    else{collections.unshift({id:uid(),...data,addedAt:Date.now(),updatedAt:Date.now()});toast('Collection créée !','success');}
    saveCollections(); closeModal('modal-collection'); renderPage();
  };

  const deleteCollection = (id) => {
    const col=collections.find(c=>c.id===id); if(!col) return;
    if(!confirm('Supprimer la collection "'+col.title+'" ?')) return;
    collections=collections.filter(c=>c.id!==id);
    saveCollections(); closeCollectionDetail(); toast('Collection supprimée','info'); renderPage();
  };

  const mkCollectionCard = (col) => {
    const card=document.createElement('div'); card.className='collection-card';
    const count=(col.filmIds||[]).length;
    const logoSrc=imgUrl(col.logo);
    const stackFilms=(col.filmIds||[]).slice(0,3).map(id=>movies.find(m=>m.id===id)).filter(Boolean);
    let stackHtml='';
    if(stackFilms.length){
      stackHtml='<div class="col-stack">';
      stackFilms.forEach(m=>{const src=posterSrc(m)||backdropSrc(m); stackHtml+='<div class="col-stack-item" style="'+(src?'background-image:url('+esc(src)+')':'background:rgba(255,255,255,.06)')+'"></div>';});
      stackHtml+='</div>';
    } else {stackHtml='<div class="col-stack-empty"><svg><use href="#ic-collection"/></svg></div>';}
    const hoverHtml=logoSrc
      ?'<div class="col-card-logo-wrap"><img src="'+esc(logoSrc)+'" alt="'+esc(col.title)+'"></div>'
      :'<div class="col-card-title-wrap"><span>'+esc(col.title)+'</span></div>';
    card.innerHTML=stackHtml+'<div class="col-card-overlay"></div><div class="col-card-badge">'+count+' film'+(count>1?'s':'')+'</div>'+hoverHtml;
    card.addEventListener('click',()=>showCollectionDetail(col.id));
    return card;
  };

  const showCollectionDetail = (id) => {
    const col=collections.find(c=>c.id===id); if(!col) return;
    const bs=imgUrl(col.backdrop); const logo=imgUrl(col.logo);
    const films=(col.filmIds||[]).map(fid=>movies.find(m=>m.id===fid)).filter(Boolean);
    const totalMins=films.reduce((acc,m)=>acc+(parseInt(m.duration)||0),0);
    const durationStr=totalMins>0?(totalMins>=60?Math.floor(totalMins/60)+'h'+(totalMins%60>0?String(totalMins%60).padStart(2,'0'):''):totalMins+'min'):'';
    const allGenres=[...new Set(films.flatMap(m=>m.genres||[]))].slice(0,4);
    const metaParts=[]; if(col.year)metaParts.push('<span style="color:var(--text-2);font-family:var(--font-b);font-size:13px">'+esc(col.year)+'</span>');
    if(col.director)metaParts.push('<span style="color:var(--text-3);font-family:var(--font-b);font-size:12px">'+esc(col.director)+'</span>');
    metaParts.push('<span style="color:var(--text-3);font-family:var(--font-b);font-size:12px">'+films.length+' film'+(films.length>1?'s':'')+'</span>');
    const box=$('collection-detail-box');
    box.innerHTML='<div class="cdx-hero">'+(bs?'<img class="cdx-hero-img" src="'+esc(bs)+'" alt="">':'<div class="cdx-hero-empty"></div>')
      +'<div class="cdx-hero-grad"></div>'
      +'<button class="cdx-close" onclick="App.closeCollectionDetail()"><svg width="16" height="16"><use href="#ic-x"/></svg></button>'
      +'<div class="cdx-hero-id">'+(logo?'<img class="cdx-logo" src="'+esc(logo)+'" alt="'+esc(col.title)+'">':'<h1 class="cdx-title-hero">'+esc(col.title)+'</h1>')+'</div>'
      +'<div class="cdx-pills">'+(films.length?'<span class="cdx-pill">'+films.length+' film'+(films.length>1?'s':'')+'</span>':'')+(durationStr?'<span class="cdx-pill">\u23f1 '+durationStr+' au total</span>':'')+(col.year?'<span class="cdx-pill">'+esc(col.year)+'</span>':'')+'</div>'
      +'</div>'
      +'<div class="cdx-body">'+(logo?'<h2 class="cdx-title-body">'+esc(col.title)+'</h2>':'')
      +'<div class="cdx-meta-row">'+(col.director?'<span class="cdx-director"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'+esc(col.director)+'</span>':'')
      +allGenres.map(g=>'<span class="cdx-genre-tag">'+esc(g)+'</span>').join('')+'</div>'
      +(col.description?'<p class="cdx-desc">'+esc(col.description)+'</p>':'')
      +'<div class="cdx-actions"><button class="cdx-btn cdx-btn-edit" onclick="App.openEditCollection(\''+col.id+'\')"><svg width="13" height="13"><use href="#ic-edit"/></svg> Modifier</button>'
      +'<button class="cdx-btn cdx-btn-del" onclick="App.deleteCollection(\''+col.id+'\')"><svg width="13" height="13"><use href="#ic-trash"/></svg> Supprimer</button></div>'
      +'<div class="cdx-separator"><span>FILMS DE LA COLLECTION</span></div>'
      +'<div class="col-films-grid" id="col-detail-films-grid">'+(films.length?'':'<p class="cdx-empty">Aucun film ajout\u00e9.</p>')+'</div></div>';
    const grid=box.querySelector('#col-detail-films-grid');
    films.forEach(m=>{ const card=mkCard(m); const h=card.querySelector('.mc-hover-overlay'); if(h){h.removeAttribute('onclick');h.addEventListener('click',()=>{closeCollectionDetail();setTimeout(()=>showDetail(m.id),180);});} grid.appendChild(card); });
    openModal('modal-collection-detail');
  };

  const closeCollectionDetail = () => closeModal('modal-collection-detail');

  const renderCollectionsSection = (container) => {
    const sec=document.createElement('div'); sec.className='movie-section';
    const count=collections.length;
    if(!count && !isAdmin()) return;
    sec.innerHTML='<div class="section-header collections-section-header"><div class="section-title">Collections <span class="section-count">'+count+'</span></div>'
      +'<button class="col-add-btn" onclick="App.openNewCollection()"><svg width="11" height="11"><use href="#ic-plus"/></svg> Nouvelle collection</button></div>'
      +'<div class="collections-grid" id="collections-grid"></div>';
    container.appendChild(sec);
    const grid=sec.querySelector('#collections-grid');
    if(!count){
      const empty=document.createElement('div');
      empty.style.cssText='grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:.6rem;padding:1.4rem;border:1px dashed var(--border);border-radius:14px;color:var(--text-3);font-family:var(--font-b);font-size:13px;cursor:pointer;transition:border-color .2s,color .2s';
      empty.innerHTML='<svg width="16" height="16" style="flex-shrink:0"><use href="#ic-plus"/></svg> Créer votre première collection';
      empty.addEventListener('click',()=>App.openNewCollection());
      empty.addEventListener('mouseover',()=>{empty.style.borderColor='rgba(255,255,255,.3)';empty.style.color='#fff';});
      empty.addEventListener('mouseout',()=>{empty.style.borderColor='var(--border)';empty.style.color='var(--text-3)';});
      grid.appendChild(empty);
    } else { collections.forEach(col=>grid.appendChild(mkCollectionCard(col))); }
  };


  // ── CUSTOM CATEGORIES ──
  const openNewCat=()=>{ $('newcat-name').value=''; openModal('modal-newcat'); };
  const closeNewCat=()=>closeModal('modal-newcat');
  const confirmNewCat=()=>{
    const name=$('newcat-name').value.trim();
    if(!name){toast('Nomme la catégorie','error');return;}
    if(customCats.find(c=>c.name.toLowerCase()===name.toLowerCase())){toast('Cette catégorie existe déjà','error');return;}
    const cat={ id:uid(), name, section:$('newcat-section').value };
    customCats.push(cat); saveCats();
    toast(`Catégorie "${name}" créée !`,'success');
    closeNewCat();
    renderCustomCatPicker(); // refresh picker in form
  };
  const deleteCustomCat=(id)=>{
    const cat=customCats.find(c=>c.id===id); if(!cat) return;
    if(!confirm(`Supprimer la catégorie "${cat.name}" ?`)) return;
    customCats=customCats.filter(c=>c.id!==id);
    // Remove from all movies
    movies=movies.map(m=>({ ...m, customCats:(m.customCats||[]).filter(cid=>cid!==id) }));
    saveCats(); save(); toast('Catégorie supprimée','info'); renderPage();
  };

  // ── MODALS ──
  const openModal = id => {
    const el = $(id); el.classList.add('open'); document.body.style.overflow='hidden';
    const box = el.querySelector('.m-box'); if (box) box.scrollTop = 0;
  };
  const closeModal=id=>{ $(id).classList.remove('open'); document.body.style.overflow=''; };

  // ── FORM : genre multi-select ──
  let selectedGenres=[];
  let selectedCats=[];

  const renderGenrePicker=(section='films')=>{
    const genres = section==='anime' ? GENRES_ANIME : section==='animation' ? GENRES_ANIMATION : section==='series' ? GENRES_SERIES : GENRES_FILMS;
    const el=$('genre-picker'); el.innerHTML='';
    genres.forEach(g=>{
      const chip=document.createElement('span');
      chip.className='gp-chip'+(selectedGenres.includes(g)?' selected':'');
      chip.textContent=g;
      chip.addEventListener('click',()=>{
        if(selectedGenres.includes(g)) selectedGenres=selectedGenres.filter(x=>x!==g);
        else selectedGenres.push(g);
        chip.classList.toggle('selected', selectedGenres.includes(g));
      });
      el.appendChild(chip);
    });
  };

  const renderCustomCatPicker=()=>{
    const section=$('f-section').value||'films';
    const el=$('custom-cat-picker'); el.innerHTML='';
    const relevant=customCats.filter(c=>c.section===section||c.section==='all');
    if(!relevant.length){ el.innerHTML=`<span style="font-size:12px;color:var(--text-3)">Aucune catégorie — crée-en une ci-dessous</span>`; return; }
    relevant.forEach(c=>{
      const chip=document.createElement('span');
      chip.className='ccp-chip'+(selectedCats.includes(c.id)?' selected':'');
      chip.textContent=c.name;
      chip.addEventListener('click',()=>{
        if(selectedCats.includes(c.id)) selectedCats=selectedCats.filter(x=>x!==c.id);
        else selectedCats.push(c.id);
        chip.classList.toggle('selected',selectedCats.includes(c.id));
      });
      el.appendChild(chip);
    });
  };

  // ── ADD / EDIT ──
  const openAdd=()=>{ editId=null; resetForm(); $('modal-add-title').textContent='AJOUTER'; openModal('modal-add'); };
  const openEdit=id=>{
    const m=movies.find(m=>m.id===id); if(!m) return;
    editId=id; resetForm();
    $('modal-add-title').textContent='MODIFIER';
    $('f-title').value=m.title||''; $('f-year').value=m.year||'';
    $('f-section').value = (m.section==='anime'||m.section==='animation' ? 'films' : m.section)||'films';
    setTimeout(() => { toggleAnimeField(m.isAnime || m.section==='anime'); toggleAnimationField(m.section==='animation'); }, 30);
    $('f-director').value=m.director||''; $('f-duration').value=m.duration||'';
    $('f-rating').value=m.rating||''; $('f-description').value=m.description||'';
    selectedGenres=[...(m.genres||[])];
    selectedCats=[...(m.customCats||[])];
    renderGenrePicker(m.section||'films');
    renderCustomCatPicker();
    if(m.poster){ window._poster=m.poster; if($('f-poster-name')) $('f-poster-name').value=m.poster; loadImgEl($('poster-img'),m.poster); $('poster-img').style.display='block'; $('poster-thumb').querySelector('svg').style.display='none'; }
    if(m.backdrop){ window._backdrop=m.backdrop; if($('f-backdrop-name')) $('f-backdrop-name').value=m.backdrop; loadImgEl($('backdrop-img'),m.backdrop); $('backdrop-preview-wrap').style.display='block'; }
    if(m.logo){ window._logo=m.logo; if($('f-logo-name')) $('f-logo-name').value=m.logo; loadImgEl($('logo-preview'),m.logo); $('logo-preview-wrap').style.display='block'; }
    if(m.logo){ window._logo=m.logo; $('logo-preview').src=m.logo; $('logo-preview-wrap').style.display='block'; }
    if(m.videoRef){
      window._vref=m.videoRef;
      $('fi-name').textContent=m.videoRef.split('/').pop();
      $('fi-size').textContent='— disque dur';
      $('video-info').style.display='flex';
      $('disk-notice').style.display='flex';
      $('btn-choose-video').style.display='none';
      $('btn-change-video').style.display='flex';
    } else {
      $('btn-choose-video').style.display='flex';
      $('btn-change-video').style.display='none';
    }
    openModal('modal-add');
  };
  const closeAdd=()=>{
    closeModal('modal-add'); editId=null; resetForm();
  };

  const resetForm=()=>{
    $('movie-form').reset();
    selectedGenres=[]; selectedCats=[];
    renderGenrePicker('films'); renderCustomCatPicker();
    if($('f-poster-name'))   $('f-poster-name').value='';
    if($('f-backdrop-name')) $('f-backdrop-name').value='';
    if($('f-logo-name'))     $('f-logo-name').value='';
    $('poster-img').style.display='none'; $('poster-thumb').querySelector('svg').style.display='';
    $('backdrop-preview-wrap').style.display='none';
    if($('logo-preview-wrap')) $('logo-preview-wrap').style.display='none';
    $('video-info').style.display='none';
    $('disk-notice').style.display='none';
    $('btn-choose-video').style.display='flex';
    if($('btn-change-video')) $('btn-change-video').style.display='none';
    $('submit-btn').disabled=false; $('submit-btn').textContent='Enregistrer';
    window._poster=null; window._backdrop=null; window._logo=null; window._vref=null;
    setTimeout(() => { toggleAnimeField(false); toggleAnimationField(false); }, 10);
  };

  // Les images sont dans le dossier images/ — on stocke juste le nom du fichier
  const setImgPreview = (inputEl, previewEl, wrapEl, field) => {
    const name = inputEl.value.trim();
    if (!name) return;
    const src = imgUrl(name);
    previewEl.src = src;
    previewEl.style.display = 'block';
    if (wrapEl) wrapEl.style.display = 'block';
    window[field] = name;
  };

  // Pas d'IndexedDB — toutes les vidéos sont streamées depuis le disque dur via le serveur.

  // ── IMAGES : dossier /images/ servi par le serveur ────────────────────────────
  // Une image = juste son nom de fichier ex: "inception-cover.jpg"
  // Le serveur la sert depuis /images/nom.jpg

  const imgUrl = (ref) => {
    if (!ref) return null;
    if (ref.startsWith('data:') || ref.startsWith('http') || ref.startsWith('/')) return ref;
    // Nom de fichier simple → dossier images/
    return `${API}/images/${encodeURIComponent(ref)}`;
  };

  const loadImgEl = (el, ref) => {
    const src = imgUrl(ref);
    if (src && el) el.src = src;
  };

  // Pas de progress bar de stockage — les vidéos sont sur disque, pas dans le navigateur.

  const toggleAnimeField = (forceVal) => {
    const hidden = $('f-is-anime');
    const btn    = $('f-anime-toggle');
    const dot    = $('f-anime-dot');
    if (!hidden) return;
    const current = hidden.value === 'true';
    const val = forceVal !== undefined ? forceVal : !current;
    hidden.value = String(val);
    if (btn) btn.style.background = val ? 'var(--accent)' : 'rgba(255,255,255,.15)';
    if (dot) dot.style.transform  = val ? 'translateX(20px)' : 'translateX(2px)';
  };

  const toggleAnimationField = (forceVal) => {
    const hidden = $('f-is-animation');
    const btn    = $('f-animation-toggle');
    const dot    = $('f-animation-dot');
    if (!hidden) return;
    const current = hidden.value === 'true';
    const val = forceVal !== undefined ? forceVal : !current;
    hidden.value = String(val);
    if (btn) btn.style.background = val ? 'var(--accent)' : 'rgba(255,255,255,.15)';
    if (dot) dot.style.transform = val ? 'translateX(20px)' : 'translateX(2px)';
    // Désactiver Anime si Animation est activé et vice versa
    if (val) toggleAnimeField(false);
  };


  const submitForm = () => {
    const title=$('f-title').value.trim(); if(!title){toast('Le titre est requis','error');return;}
    const btn=$('submit-btn'); btn.disabled=true; btn.textContent='Enregistrement…';
    const prev=editId?movies.find(m=>m.id===editId):null;
    const isAnime      = $('f-is-anime')?.value === 'true';
    const isAnimation  = $('f-is-animation')?.value === 'true';
    const _rawSection  = $('f-section').value || 'films';
    const _finalSection = isAnime ? 'anime' : isAnimation ? 'animation' : _rawSection;

    const m={
      id:editId||uid(), title,
      year:$('f-year').value||'', section: _finalSection,
      isAnime,
      genres:selectedGenres.length?[...selectedGenres]:['Autre'],
      customCats:[...selectedCats],
      director:$('f-director').value.trim()||'', duration:$('f-duration').value||'',
      rating:$('f-rating').value||'', description:$('f-description').value.trim()||'',
      poster  : ($('f-poster-name')?.value.trim())   || prev?.poster   || null,
      backdrop: ($('f-backdrop-name')?.value.trim()) || prev?.backdrop || null,
      logo    : ($('f-logo-name')?.value.trim())     || prev?.logo     || null,
      videoRef: window._vref || prev?.videoRef || null,
      addedAt:prev?.addedAt||Date.now(), updatedAt:Date.now()
    };
    if(editId){ const i=movies.findIndex(x=>x.id===editId); if(i!==-1) movies[i]=m; toast('Film mis à jour !','success'); }
    else { movies.unshift(m); toast('Film ajouté !','success'); }
    save(); closeAdd();
    renderPage();
    btn.disabled=false; btn.textContent='Enregistrer';
  };

  // ── IMAGE SOURCES ──
  const posterSrc  = m => imgUrl(m?.poster);
  const backdropSrc = m => imgUrl(m?.backdrop);
  const logoSrcF    = m => imgUrl(m?.logo);
  const heroImgSrc=m=>backdropSrc(m)||posterSrc(m);

  // ── PLAYER ──
  const fmt=s=>{ if(isNaN(s)||s==null) return '0:00'; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`; };

  const initPlayerControls=()=>{
    const wrap=$('player-wrap'),video=$('player-video'),progress=$('player-progress'),fill=$('player-progress-fill');
    const playBtn=$('player-play-btn'),muteBtn=$('player-mute-btn'),volInput=$('player-vol');
    const timeCur=$('player-time-cur'),timeDur=$('player-time-dur'),fsBtn=$('player-fs-btn');
    const rwBtn=$('player-rewind-btn'),fwBtn=$('player-forward-btn'),centerClick=$('player-center-click');

    let cursorTimer;
    const showCursor=()=>{ wrap.classList.add('show-cursor'); clearTimeout(cursorTimer); cursorTimer=setTimeout(()=>{ if(!video.paused) wrap.classList.remove('show-cursor'); },3000); };
    wrap.addEventListener('mousemove',showCursor); wrap.addEventListener('mouseenter',showCursor);
    video.addEventListener('pause',()=>{ wrap.classList.add('show-cursor'); clearTimeout(cursorTimer); });
    video.addEventListener('play',()=>showCursor());

    const PLAY_SVG=`<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
    const PAUSE_SVG=`<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/></svg>`;
    const VOL_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const MUTE_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
    const FS_IN=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
    const FS_OUT=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;

    const updatePlayBtn=()=>{ playBtn.innerHTML=video.paused?PLAY_SVG:PAUSE_SVG; };
    const togglePlay=()=>{ video.paused?video.play():video.pause(); };
    const updateVolIcon=()=>{ muteBtn.innerHTML=(video.muted||video.volume===0)?MUTE_SVG:VOL_SVG; };

    playBtn.addEventListener('click',togglePlay); centerClick.addEventListener('click',togglePlay);
    video.addEventListener('play',updatePlayBtn); video.addEventListener('pause',updatePlayBtn);
    video.addEventListener('timeupdate',()=>{ if(!video.duration) return; fill.style.width=(video.currentTime/video.duration*100)+'%'; timeCur.textContent=fmt(video.currentTime); timeDur.textContent=fmt(video.duration); });
    video.addEventListener('loadedmetadata',()=>{ timeDur.textContent=fmt(video.duration); });

    const seek=e=>{ const rect=progress.getBoundingClientRect(); video.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*(video.duration||0); };
    progress.addEventListener('click',seek);
    let dragging=false;
    progress.addEventListener('mousedown',e=>{dragging=true;seek(e);});
    document.addEventListener('mousemove',e=>{if(dragging)seek(e);});
    document.addEventListener('mouseup',()=>{dragging=false;});

    // ── Preview au survol de la barre ── Sprite sheet (instantané) + vidéo fallback
    const previewBox = document.createElement('div');
    previewBox.id = 'player-preview-box';
    previewBox.style.cssText = ['position:absolute','left:0','bottom:0','transform:translateX(-50%)','display:none','flex-direction:column','align-items:center','gap:5px','pointer-events:none','z-index:30'].join(';');
    previewBox.innerHTML = `
      <div id="preview-frame" style="width:192px;height:108px;border-radius:6px;overflow:hidden;background:#111;position:relative;box-shadow:0 4px 20px rgba(0,0,0,.8);border:1px solid rgba(255,255,255,.15)">
        <div id="preview-sprite" style="position:absolute;inset:0;background-repeat:no-repeat;background-color:#111;display:none"></div>
        <video id="preview-vid" muted preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"></video>
      </div>
      <div id="preview-time" style="font-family:var(--font-b);font-size:12px;color:#fff;background:rgba(0,0,0,.7);padding:2px 8px;border-radius:4px;letter-spacing:.05em"></div>`;
    wrap.appendChild(previewBox);

    const previewSprite = previewBox.querySelector('#preview-sprite');
    const previewVid    = previewBox.querySelector('#preview-vid');
    const previewTime   = previewBox.querySelector('#preview-time');
    previewVid.playbackRate = 0;
    if (previewVid.textTracks) previewVid.textTracks.onaddtrack = ev => { if(ev.track) ev.track.mode='disabled'; };

    let _spriteHash=null, _spriteMeta=null, _spriteReady=false;
    let _previewSrc=null, _previewSeekTimeout=null;

    const initSprite = async (videoRef) => {
      _spriteReady=false; _spriteHash=null; _spriteMeta=null;
      previewSprite.style.display='none'; previewVid.style.display='block';
      const d = await apiGet(`/api/prepare-sprite?rel=${encodeURIComponent(videoRef)}`);
      if (!d?.ok) return;
      _spriteHash = d.hash;
      if (d.status==='ready') _loadSprite(d);
      else { const poll = async () => { const s=await apiGet(`/api/sprite-status?hash=${_spriteHash}`); if(s?.status==='ready') _loadSprite(s); else if(s?.status!=='error') setTimeout(poll,3000); }; setTimeout(poll,3000); }
    };

    const _loadSprite = (meta) => {
      _spriteMeta = meta;
      const img = new Image();
      img.onload = () => {
        _spriteReady = true;
        previewSprite.style.backgroundImage = `url(${API}/api/sprite-img?hash=${_spriteHash})`;
        previewSprite.style.display = 'block';
        previewVid.style.display = 'none';
      };
      img.src = `${API}/api/sprite-img?hash=${_spriteHash}`;
    };

    const showPreview = (e) => {
      if (!video.duration || !video.src) return;
      const rect = progress.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width));
      const t = pct * video.duration;
      const boxW = 202;
      let left = e.clientX - wrapRect.left;
      left = Math.max(boxW/2, Math.min(wrapRect.width-boxW/2, left));
      previewBox.style.left = left+'px';
      previewBox.style.bottom = (wrapRect.height-(rect.top-wrapRect.top)+12)+'px';
      previewBox.style.display = 'flex';
      previewTime.textContent = fmt(t);

      if (_spriteReady && _spriteMeta) {
        const fi = Math.min(Math.floor(t/_spriteMeta.interval), _spriteMeta.count-1);
        const col=fi%_spriteMeta.cols, row=Math.floor(fi/_spriteMeta.cols);
        const totCols=_spriteMeta.cols, totRows=Math.ceil(_spriteMeta.count/_spriteMeta.cols);
        previewSprite.style.backgroundSize = `${totCols*_spriteMeta.w}px ${totRows*_spriteMeta.h}px`;
        previewSprite.style.backgroundPosition = `${-(col*_spriteMeta.w)}px ${-(row*_spriteMeta.h)}px`;
      } else {
        const src = video.src.split('?')[0];
        if (_previewSrc !== src) {
          _previewSrc=src; previewVid.src=src; previewVid.load(); previewVid.playbackRate=0;
          previewVid.addEventListener('loadedmetadata', () => { for(let i=0;i<previewVid.textTracks.length;i++) previewVid.textTracks[i].mode='disabled'; }, {once:false});
        }
        clearTimeout(_previewSeekTimeout);
        _previewSeekTimeout = setTimeout(() => { if(previewVid.fastSeek) previewVid.fastSeek(t); else previewVid.currentTime=t; }, 25);
      }
    };

    const hidePreview = () => { previewBox.style.display='none'; clearTimeout(_previewSeekTimeout); };

    progress.addEventListener('mouseenter', e => { document.getElementById('sub-overlay')?.style && (document.getElementById('sub-overlay').style.visibility='hidden'); showPreview(e); });
    progress.addEventListener('mousemove', e => { if(!dragging) showPreview(e); });
    progress.addEventListener('mouseleave', () => { const s=document.getElementById('sub-overlay'); if(s) s.style.visibility=''; hidePreview(); });
    progress.addEventListener('mousedown', hidePreview);


    volInput.addEventListener('input',()=>{ video.volume=parseFloat(volInput.value); video.muted=video.volume===0; updateVolIcon(); });
    muteBtn.addEventListener('click',()=>{ video.muted=!video.muted; volInput.value=video.muted?0:video.volume; updateVolIcon(); });
    rwBtn.addEventListener('click',()=>{ video.currentTime=Math.max(0,video.currentTime-10); });
    fwBtn.addEventListener('click',()=>{ video.currentTime=Math.min(video.duration||0,video.currentTime+10); });
    fsBtn.addEventListener('click',()=>{ if(!document.fullscreenElement){wrap.requestFullscreen().catch(()=>{}); fsBtn.innerHTML=FS_OUT;} else {document.exitFullscreen(); fsBtn.innerHTML=FS_IN;} });
    document.addEventListener('fullscreenchange',()=>{ if(!document.fullscreenElement) fsBtn.innerHTML=FS_IN; });

    // ── Boutons Audio & Sous-titres ─────────────────────────────────────────
    // Boutons épisode précédent / suivant
    $('player-prev-ep').addEventListener('click', () => {
      const prev = _getAdjacentEpisode(-1);
      if (prev) playEpisode(prev.id);
    });
    $('player-next-ep').addEventListener('click', () => {
      const next = _getAdjacentEpisode(1);
      if (next) playEpisode(next.id);
    });
    $('player-next-ep-btn').addEventListener('click', () => {
      const next = _getAdjacentEpisode(1);
      if (next) playEpisode(next.id);
    });
    $('player-next-ep-btn').addEventListener('mouseover', () => {
      $('player-next-ep-btn').style.background = 'rgba(255,255,255,.25)';
    });
    $('player-next-ep-btn').addEventListener('mouseout', () => {
      $('player-next-ep-btn').style.background = 'rgba(255,255,255,.15)';
    });
    const setupMenuBtn = (btnId, menuId) => {
      const btnWrap = $(btnId);
      const menu    = $(menuId);
      if (!btnWrap || !menu) return;
      const trigger = btnWrap.querySelector('button');
      if (!trigger) return;
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        // Fermer l'autre menu si ouvert
        const otherId = menuId === 'player-audio-menu' ? 'player-sub-menu' : 'player-audio-menu';
        $(otherId)?.classList.remove('open');
        menu.classList.toggle('open');
      });
    };
    setupMenuBtn('player-audio-btn', 'player-audio-menu');
    setupMenuBtn('player-sub-btn',   'player-sub-menu');
    // Fermer les menus en cliquant ailleurs
    document.addEventListener('click', () => {
      $('player-audio-menu')?.classList.remove('open');
      $('player-sub-menu')?.classList.remove('open');
    });

    document.addEventListener('keydown',e=>{
      if(!wrap.classList.contains('open')) return;
      if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      switch(e.key){
        case ' ':case 'k':e.preventDefault();togglePlay();break;
        case 'ArrowLeft':e.preventDefault();video.currentTime=Math.max(0,video.currentTime-10);break;
        case 'ArrowRight':e.preventDefault();video.currentTime=Math.min(video.duration||0,video.currentTime+10);break;
        case 'ArrowUp':e.preventDefault();video.volume=Math.min(1,video.volume+.1);volInput.value=video.volume;updateVolIcon();break;
        case 'ArrowDown':e.preventDefault();video.volume=Math.max(0,video.volume-.1);volInput.value=video.volume;updateVolIcon();break;
        case 'm':video.muted=!video.muted;volInput.value=video.muted?0:video.volume;updateVolIcon();break;
        case 'f':fsBtn.click();break;
      }
      showCursor();
    });
  };

  const play=id=>{
    const m=movies.find(m=>m.id===id); if(!m) return;
    if(!m.videoRef){toast('Aucune vidéo associée à ce film','warning');return;}
    if(!serverOnline){toast('Lance le serveur LANCER_MYFLIX.command pour regarder les vidéos','error');return;}
    const video=$('player-video');
    $('player-center-title').textContent=m.title;
    video.pause(); clearSubtitles(); _hideTrackBtns();
    video.removeAttribute('src');
    $('player-wrap').classList.add('open','show-cursor');
    _ss.stop(); // Suspendre l'écran de veille pendant la lecture
    document.body.style.overflow='hidden';
    video.volume=1; video.muted=false; $('player-vol').value=1;
    // Masquer les boutons épisode (film)
    if($('player-prev-ep')) $('player-prev-ep').style.display='none';
    if($('player-next-ep')) $('player-next-ep').style.display='none';
    const onMeta=()=>{
      video.removeEventListener('loadedmetadata',onMeta);
      loadTracks(m.videoRef);
      _updateRestartBtn(m.id);
      const prog = getProgress(m.id);
      if(prog && prog.ts > 10) {
        video.currentTime = prog.ts;
        toast(`Reprise à ${fmt(prog.ts)}`, 'info');
      }
    };
    video.addEventListener('loadedmetadata',onMeta);
    // Fin du film
    const onEnded = () => {
      clearProgress(m.id);
      showEndScreen('movie', m);
    };
    if(video._movieEnded) video.removeEventListener('ended', video._movieEnded);
    video._movieEnded = onEnded;
    video.addEventListener('ended', onEnded);
    const src=`${API}/media/${m.videoRef.split('/').map(encodeURIComponent).join('/')}`;
    video.src=src; video.load(); video.play().catch(()=>{});
    startProgressWatcher(m.id);
    initSprite(m.videoRef);
  };
  // ── PAGE DE FIN ────────────────────────────────────────────────────────────────
  const showEndScreen = (type, data) => {
    // Supprimer un éventuel écran de fin existant
    document.getElementById('player-end-screen')?.remove();

    const isLastEp = type === 'series-end'; // toute la série terminée
    const isEpisode = type === 'episode';   // épisode terminé mais série continue
    const isMovie = type === 'movie';

    const backdrop = isMovie
      ? (backdropSrc(data) || posterSrc(data))
      : (backdropSrc(data.series) || posterSrc(data.series));
    const title = isMovie ? data.title : data.series.title;
    const subtitle = isMovie
      ? (data.year || '')
      : isLastEp
        ? 'Série terminée'
        : `S${String(data.ep.season).padStart(2,'0')}E${String(data.ep.episode).padStart(2,'0')} — ${data.ep.title || ''}`;

    const ov = document.createElement('div');
    ov.id = 'player-end-screen';
    ov.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;text-align:center;animation:fadeIn .6s ease';

    // Fond flouté avec image
    ov.innerHTML = `
      ${backdrop ? `<div style="position:absolute;inset:0;background-image:url(${esc(backdrop)});background-size:cover;background-position:center;filter:blur(20px) brightness(.35);transform:scale(1.1)"></div>` : '<div style="position:absolute;inset:0;background:#000"></div>'}
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:1.2rem;padding:2rem">
        ${backdrop ? `<img src="${esc(backdrop)}" alt="" style="width:160px;height:auto;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.8);object-fit:cover">` : ''}
        <div>
          <div style="font-family:var(--font-h);font-size:clamp(18px,3vw,32px);color:#fff;letter-spacing:.03em;margin-bottom:.3rem">${esc(title)}</div>
          <div style="font-family:var(--font-b);font-size:14px;color:rgba(255,255,255,.5);letter-spacing:.05em">${esc(subtitle)}</div>
        </div>
        ${isLastEp ? `
          <div style="font-family:var(--font-b);font-size:13px;color:rgba(255,255,255,.6);margin-top:-.3rem">
            Vous avez regardé tous les épisodes
          </div>` : ''}
        <div style="display:flex;gap:.8rem;margin-top:.5rem">
          <button id="end-btn-home" style="
            background:rgba(255,255,255,.15);backdrop-filter:blur(12px);
            border:1px solid rgba(255,255,255,.25);border-radius:100px;
            color:#fff;font-family:var(--font-b);font-size:13px;
            padding:.75rem 1.6rem;cursor:pointer;transition:background .2s;
            display:flex;align-items:center;gap:.5rem;
          ">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            Retour à l'accueil
          </button>
        </div>
      </div>`;

    $('player-wrap').appendChild(ov);

    ov.querySelector('#end-btn-home').addEventListener('click', () => {
      closePlayer();
      goHome();
    });
    ov.querySelector('#end-btn-home').addEventListener('mouseover', e => { e.currentTarget.style.background='rgba(255,255,255,.25)'; });
    ov.querySelector('#end-btn-home').addEventListener('mouseout', e => { e.currentTarget.style.background='rgba(255,255,255,.15)'; });
  };

  const hideEndScreen = () => {
    document.getElementById('player-end-screen')?.remove();
  };

  // Bouton "Depuis le début" — visible si progression > seuil
  const _updateRestartBtn = (contentId) => {
    const btn = $('player-restart-btn');
    if (!btn) return;
    const prog = getProgress(contentId);
    if (prog && prog.watchedSec >= ACTIVE_THRESHOLD && prog.ts > 10) {
      btn.style.display = 'flex';
      btn.onclick = () => {
        clearProgress(contentId);
        btn.style.display = 'none';
        // Remettre le compteur à zéro — il faudra regarder 5min pour re-sauvegarder
        _pwActiveSec = 0;
        const video = $('player-video');
        if (video) video.currentTime = 0;
      };
    } else {
      btn.style.display = 'none';
    }
  };
  const _hideRestartBtn = () => { const b=$('player-restart-btn'); if(b) b.style.display='none'; };

  const closePlayer=()=>{
    _ss.resetTimer(); // Reprendre le compte à rebours de veille
    const video=$('player-video'); video.pause(); video.removeAttribute('src'); video.load();
    clearSubtitles();
    $('player-sub-menu')?.classList.remove('open');
    $('player-audio-menu')?.classList.remove('open');
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    $('player-wrap').classList.remove('open','show-cursor');
    document.body.style.overflow='';
    _hideNextEpOverlay();
    hideEndScreen();
    _hideRestartBtn();
    _currentEpId = null; _currentSid = null;
    stopProgressWatcher();
    if($('player-prev-ep')) $('player-prev-ep').style.display = 'none';
    if($('player-next-ep')) $('player-next-ep').style.display = 'none';
    if(video._epTimeUpdate) { video.removeEventListener('timeupdate', video._epTimeUpdate); video._epTimeUpdate = null; }
    if(video._movieEnded) { video.removeEventListener('ended', video._movieEnded); video._movieEnded = null; }
    if(video._epEnded) { video.removeEventListener('ended', video._epEnded); video._epEnded = null; }
    // Reset preview vidéo
    const pv = document.getElementById('preview-vid');
    if(pv) { pv.pause(); pv.removeAttribute('src'); pv.load(); }
    const pb = document.getElementById('player-preview-box');
    if(pb) pb.style.display = 'none';
  };

  // ── PISTES AUDIO & SOUS-TITRES ────────────────────────────────────────────────
  let currentVideoRef  = null;
  let currentSubTracks = [];
  let FFPROBE_AVAILABLE = false;

  // Correspondances codes → noms de langues (labels Handbrake + codes ISO)
  const AUDIO_LANG_MAP = {
    // Codes ISO 639-2
    'fre':'Français','fra':'Français','fr':'Français',
    'eng':'English','en':'English',
    'spa':'Español','es':'Español',
    'deu':'Deutsch','de':'Deutsch',
    'ita':'Italiano','it':'Italiano',
    'jpn':'Japonais','ja':'Japonais','jap':'Japonais',
    'por':'Português','pt':'Português',
    'kor':'Coréen','ko':'Coréen',
    'chi':'Chinois','zho':'Chinois','zh':'Chinois',
    'ara':'Arabe','ar':'Arabe',
    'rus':'Russe','ru':'Russe',
    'nld':'Néerlandais','nl':'Néerlandais',
    'pol':'Polonais','pl':'Polonais',
    'swe':'Suédois','sv':'Suédois',
    'nor':'Norvégien','no':'Norvégien',
    'dan':'Danois','da':'Danois',
    'fin':'Finnois','fi':'Finnois',
    'tur':'Turc','tr':'Turc',
    'heb':'Hébreu','he':'Hébreu',
    'hin':'Hindi','hi':'Hindi',
    'tha':'Thaï','th':'Thaï',
    'vie':'Vietnamien','vi':'Vietnamien',
    'und':'Inconnu',
    // Codes Handbrake / labels courants
    'vfi':'Français','vff':'Français',
    'vfq':'Français (Québec)',
  };

  const langLabel = (lang, title) => {
    const l = AUDIO_LANG_MAP[lang?.toLowerCase()] || lang?.toUpperCase() || '?';
    return title ? `${l} — ${title}` : l;
  };
  // ex: "VFI AC3 640kb/s" → "Français"
  // ex: "KOR AC3 640kb/s" → "Coréen"
  // ex: "English" → "English"
  const parseAudioLabel = (label, language, index) => {
    if (!label && !language) return `Piste ${index + 1}`;

    // Essayer d'abord le code de langue (track.language de Safari)
    if (language) {
      const lang = language.toLowerCase();
      if (AUDIO_LANG_MAP[lang]) return AUDIO_LANG_MAP[lang];
    }

    if (!label) return `Piste ${index + 1}`;

    // Extraire le premier mot du label (ex: "VFI" de "VFI AC3 640kb/s")
    const firstWord = label.split(/[\s,]/)[0].toLowerCase();
    if (AUDIO_LANG_MAP[firstWord]) return AUDIO_LANG_MAP[firstWord];

    // Le label lui-même est peut-être une langue connue
    const labelLow = label.toLowerCase();
    for (const [code, name] of Object.entries(AUDIO_LANG_MAP)) {
      if (labelLow === code || labelLow === name.toLowerCase()) return name;
    }

    // Chercher un code de langue dans le label (3 lettres majuscules)
    const match = label.match(/\b([A-Z]{2,3})\b/);
    if (match) {
      const code = match[1].toLowerCase();
      if (AUDIO_LANG_MAP[code]) return AUDIO_LANG_MAP[code];
    }

    // Fallback : retourner le label tel quel mais nettoyer le bruit technique
    return label.replace(/\s*(AC3|AAC|DTS|TrueHD|MP3|FLAC|EAC3|Opus)\s*\d*\s*kb\/s?/gi, '').trim() || `Piste ${index + 1}`;
  };

  // Masquer les boutons audio et sous-titres
  const _hideTrackBtns = () => {
    const ab=$('player-audio-btn'), sb=$('player-sub-btn');
    if(ab) ab.style.display='none';
    if(sb) sb.style.display='none';
  };

  const loadTracks = async (videoRef) => {
    currentVideoRef  = videoRef;
    currentSubTracks = [];
    _hideTrackBtns();

    const video = $('player-video');

    // ── Pistes audio natives (Safari) ────────────────────────────────────────
    const buildAudioFromNative = () => {
      const at = video.audioTracks;
      if (!at || at.length <= 1) return false;
      const btn=$('player-audio-btn'), menu=$('player-audio-menu');
      if (!btn||!menu) return false;
      btn.style.display = 'flex';
      menu.innerHTML = `<div class="player-menu-title">Piste audio</div>`;
      for (let i = 0; i < at.length; i++) {
        const track = at[i];
        const item = document.createElement('div');
        item.className = 'player-menu-item' + (track.enabled ? ' active' : '');
        const label = parseAudioLabel(track.label, track.language, i);
        item.textContent = label;
        item.addEventListener('click', () => {
          for (let j = 0; j < at.length; j++) at[j].enabled = (j === i);
          menu.querySelectorAll('.player-menu-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          menu.classList.remove('open');
          toast('Piste audio changée', 'success');
        });
        menu.appendChild(item);
      }
      return true;
    };

    // Désactiver les sous-titres natifs Safari (qui s'activent automatiquement)
    // On n'utilise PAS textTracks pour les sous-titres MyFlix — on a notre propre overlay HTML
    const disableNativeTracks = () => {
      if (!video.textTracks) return;
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }
    };
    disableNativeTracks();
    // Surveiller les nouvelles pistes natives ajoutées par Safari
    if (video.textTracks) {
      video.textTracks.onaddtrack = e => {
        if (e.track) e.track.mode = 'disabled';
      };
    }
    video.addEventListener('canplay', disableNativeTracks, { once: true });

    // Safari remplit audioTracks de façon asynchrone — on réessaie sur plusieurs événements
    // Guard pour éviter de construire le menu plusieurs fois
    let _audioBuilt = false;
    const tryBuildAudio = () => {
      if (_audioBuilt) return;
      if (buildAudioFromNative()) _audioBuilt = true;
    };

    tryBuildAudio();
    if (!_audioBuilt) {
      video.addEventListener('canplay',        tryBuildAudio, { once: true });
      video.addEventListener('canplaythrough', tryBuildAudio, { once: true });
      if (video.audioTracks) {
        video.audioTracks.onaddtrack = () => tryBuildAudio();
      }
      setTimeout(tryBuildAudio, 1000);
      setTimeout(tryBuildAudio, 2000);
    }

    // ── Sous-titres via FFprobe ───────────────────────────────────────────────
    try {
      const data = await apiGet(`/api/tracks?rel=${encodeURIComponent(videoRef)}`);
      currentSubTracks = data?.subtitles || [];
      // Réinitialiser le guard pour que le menu se construise bien
      const menu = $('player-sub-menu');
      if (menu) delete menu.dataset.built;
      buildSubMenu(currentSubTracks);
    } catch(e) {
      buildSubMenu([]);
    }
  };

  // ── MENU SOUS-TITRES ────────────────────────────────────────────────────────
  const buildSubMenu = (tracks) => {
    const btn=$('player-sub-btn'), menu=$('player-sub-menu');
    if (!btn||!menu) return;
    // Ne pas reconstruire si déjà fait avec les mêmes pistes
    if (menu.dataset.built === String(tracks.length)) return;
    menu.dataset.built = String(tracks.length);
    btn.style.display='flex';
    menu.innerHTML=`<div class="player-menu-title">Sous-titres</div>`;

    const none=document.createElement('div');
    none.className='player-menu-item active'; none.textContent='Aucun';
    none.addEventListener('click',()=>{
      clearSubtitles();
      menu.querySelectorAll('.player-menu-item').forEach(el=>el.classList.remove('active'));
      none.classList.add('active');
      menu.classList.remove('open');
    });
    menu.appendChild(none);

    if (!tracks.length) {
      const info=document.createElement('div');
      info.style.cssText='color:var(--text-3);font-size:11px;padding:.4rem .8rem;font-family:var(--font-b)';
      info.textContent='Aucune piste disponible';
      menu.appendChild(info);
    }

    tracks.forEach(t => {
      const item=document.createElement('div'); item.className='player-menu-item';
      item.textContent = langLabel(t.lang, t.title) + (t.forced?' (Forcé)':'');
      item.addEventListener('click',()=>{
        menu.querySelectorAll('.player-menu-item').forEach(el=>el.classList.remove('active'));
        item.classList.add('active');
        menu.classList.remove('open');
        loadSubtitle(t.index);
      });
      menu.appendChild(item);
    });

    // Séparateur + lien apparence
    const sep = document.createElement('div');
    sep.style.cssText='height:1px;background:var(--border);margin:.4rem 0';
    menu.appendChild(sep);
    const styleBtn = document.createElement('div');
    styleBtn.className='player-menu-item';
    styleBtn.style.cssText='color:var(--text-3);font-size:11px;display:flex;align-items:center;gap:.4rem';
    styleBtn.innerHTML=`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> Apparence`;
    styleBtn.addEventListener('click', e => { e.stopPropagation(); menu.classList.remove('open'); openSubStyle(); });
    menu.appendChild(styleBtn);
  };

  // ── APPARENCE SOUS-TITRES ─────────────────────────────────────────────────────
  // Paramètres stockés en localStorage
  const SUB_STYLE_KEY = 'myflix_sub_style';
  let subStyle = (() => {
    try { return JSON.parse(localStorage.getItem(SUB_STYLE_KEY)) || {}; } catch(e) { return {}; }
  })();
  const SUB_DEFAULTS = { size:22, color:'#ffffff', opacity:1, shadow:true, bg:false, bgOpacity:0.5 };
  const getSubStyle = () => ({ ...SUB_DEFAULTS, ...subStyle });

  const saveSubStyle = () => {
    localStorage.setItem(SUB_STYLE_KEY, JSON.stringify(subStyle));
    applySubStyle();
  };

  const applySubStyle = () => {
    const ov = document.getElementById('sub-overlay');
    if (!ov) return;
    const s = getSubStyle();
    const r = parseInt(s.color.slice(1,3),16);
    const g = parseInt(s.color.slice(3,5),16);
    const b = parseInt(s.color.slice(5,7),16);
    ov.style.fontSize   = s.size + 'px';
    ov.style.color      = `rgba(${r},${g},${b},${s.opacity})`;
    ov.style.textShadow = s.shadow ? '0 1px 4px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.8)' : 'none';
    ov.style.background = s.bg ? `rgba(0,0,0,${s.bgOpacity})` : 'transparent';
    ov.style.padding    = s.bg ? '4px 10px' : '0';
    ov.style.borderRadius = s.bg ? '4px' : '0';
  };

  const openSubStyle = () => {
    const s = getSubStyle();
    const overlay = document.createElement('div');
    overlay.className = 'm-overlay open'; overlay.id = 'modal-sub-style';
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="m-box" style="max-width:360px">
        <div class="m-head">
          <h2>APPARENCE SOUS-TITRES</h2>
          <div class="m-close" id="ss-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body" style="display:flex;flex-direction:column;gap:1.2rem">

          <!-- Aperçu -->
          <div style="background:#111;border-radius:var(--r);padding:1.2rem;text-align:center;position:relative;min-height:60px;display:flex;align-items:center;justify-content:center">
            <div id="ss-preview" style="font-family:var(--font-b);white-space:pre-line;line-height:1.4;pointer-events:none">Exemple de sous-titre</div>
          </div>

          <!-- Taille -->
          <div class="fg" style="margin:0">
            <label style="display:flex;justify-content:space-between">Taille <span id="ss-size-val">${s.size}px</span></label>
            <input type="range" id="ss-size" min="14" max="48" step="1" value="${s.size}" style="width:100%;margin-top:.4rem">
          </div>

          <!-- Couleur -->
          <div class="fg" style="margin:0">
            <label>Couleur du texte</label>
            <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem" id="ss-colors">
              ${['#ffffff','#ffff00','#00ff00','#00ffff','#ff8800','#ff6b6b','#cccccc'].map(c =>
                `<button onclick="App._subStyleColor('${c}')" style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid ${c===s.color?'var(--accent)':'transparent'};cursor:pointer;flex-shrink:0" data-color="${c}"></button>`
              ).join('')}
              <input type="color" id="ss-color-picker" value="${s.color}" title="Couleur personnalisée"
                style="width:28px;height:28px;border-radius:50%;border:2px solid var(--border);cursor:pointer;padding:0;background:none">
            </div>
          </div>

          <!-- Opacité -->
          <div class="fg" style="margin:0">
            <label style="display:flex;justify-content:space-between">Opacité <span id="ss-opacity-val">${Math.round(s.opacity*100)}%</span></label>
            <input type="range" id="ss-opacity" min="0.1" max="1" step="0.05" value="${s.opacity}" style="width:100%;margin-top:.4rem">
          </div>

          <!-- Ombre -->
          <div style="display:flex;align-items:center;justify-content:space-between">
            <label style="color:var(--text-2);font-size:12px;font-family:var(--font-b);letter-spacing:.05em;text-transform:uppercase">Ombre portée</label>
            <button id="ss-shadow" onclick="App._subStyleToggle('shadow')"
              style="width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;transition:background .2s;background:${s.shadow?'var(--accent)':'rgba(255,255,255,.15)'}">
              <div style="width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;transform:translateX(${s.shadow?'20px':'2px'})"></div>
            </button>
          </div>

          <!-- Fond -->
          <div style="display:flex;align-items:center;justify-content:space-between">
            <label style="color:var(--text-2);font-size:12px;font-family:var(--font-b);letter-spacing:.05em;text-transform:uppercase">Fond noir</label>
            <button id="ss-bg" onclick="App._subStyleToggle('bg')"
              style="width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;transition:background .2s;background:${s.bg?'var(--accent)':'rgba(255,255,255,.15)'}">
              <div style="width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;transform:translateX(${s.bg?'20px':'2px'})"></div>
            </button>
          </div>

          <!-- Opacité fond (visible si bg actif) -->
          <div class="fg" id="ss-bg-opacity-row" style="margin:0;${s.bg?'':'display:none'}">
            <label style="display:flex;justify-content:space-between">Opacité du fond <span id="ss-bg-opacity-val">${Math.round(s.bgOpacity*100)}%</span></label>
            <input type="range" id="ss-bg-opacity" min="0.1" max="1" step="0.05" value="${s.bgOpacity}" style="width:100%;margin-top:.4rem">
          </div>

          <button class="btn-submit" onclick="App._subStyleReset()" style="background:rgba(255,255,255,.08);border:1px solid var(--border);margin:0">
            Réinitialiser
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    overlay.querySelector('#ss-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if(e.target===overlay) close(); });

    const updatePreview = () => {
      const sv = getSubStyle();
      const pr = document.getElementById('ss-preview');
      if (!pr) return;
      const r=parseInt(sv.color.slice(1,3),16), g=parseInt(sv.color.slice(3,5),16), b=parseInt(sv.color.slice(5,7),16);
      pr.style.fontSize   = sv.size+'px';
      pr.style.color      = `rgba(${r},${g},${b},${sv.opacity})`;
      pr.style.textShadow = sv.shadow?'0 1px 4px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.8)':'none';
      pr.style.background = sv.bg?`rgba(0,0,0,${sv.bgOpacity})`:'transparent';
      pr.style.padding    = sv.bg?'4px 10px':'0';
      pr.style.borderRadius = sv.bg?'4px':'0';
    };
    updatePreview();

    document.getElementById('ss-size').addEventListener('input', e => {
      subStyle.size = parseInt(e.target.value);
      document.getElementById('ss-size-val').textContent = subStyle.size+'px';
      saveSubStyle(); updatePreview();
    });
    document.getElementById('ss-opacity').addEventListener('input', e => {
      subStyle.opacity = parseFloat(e.target.value);
      document.getElementById('ss-opacity-val').textContent = Math.round(subStyle.opacity*100)+'%';
      saveSubStyle(); updatePreview();
    });
    document.getElementById('ss-bg-opacity').addEventListener('input', e => {
      subStyle.bgOpacity = parseFloat(e.target.value);
      document.getElementById('ss-bg-opacity-val').textContent = Math.round(subStyle.bgOpacity*100)+'%';
      saveSubStyle(); updatePreview();
    });
    document.getElementById('ss-color-picker').addEventListener('input', e => {
      App._subStyleColor(e.target.value);
    });
  };

  const _subStyleColor = (color) => {
    subStyle.color = color;
    // Mettre à jour les boutons
    document.querySelectorAll('#ss-colors button').forEach(b => {
      b.style.borderColor = b.dataset.color === color ? 'var(--accent)' : 'transparent';
    });
    const picker = document.getElementById('ss-color-picker');
    if (picker) picker.value = color;
    saveSubStyle();
    // Mettre à jour l'aperçu
    const pr = document.getElementById('ss-preview');
    if (pr) { const s=getSubStyle(); const r=parseInt(s.color.slice(1,3),16),g=parseInt(s.color.slice(3,5),16),b2=parseInt(s.color.slice(5,7),16); pr.style.color=`rgba(${r},${g},${b2},${s.opacity})`; }
  };

  const _subStyleToggle = (key) => {
    subStyle[key] = !getSubStyle()[key];
    saveSubStyle();
    // Mettre à jour le toggle visuellement
    const btn = document.getElementById(`ss-${key}`);
    const val = getSubStyle()[key];
    if (btn) {
      btn.style.background = val ? 'var(--accent)' : 'rgba(255,255,255,.15)';
      const dot = btn.querySelector('div');
      if (dot) dot.style.transform = `translateX(${val?'20px':'2px'})`;
    }
    if (key === 'bg') {
      const row = document.getElementById('ss-bg-opacity-row');
      if (row) row.style.display = val ? '' : 'none';
    }
    // Aperçu
    const pr = document.getElementById('ss-preview');
    if (pr) {
      const s=getSubStyle(); const r=parseInt(s.color.slice(1,3),16),g=parseInt(s.color.slice(3,5),16),b2=parseInt(s.color.slice(5,7),16);
      pr.style.textShadow = s.shadow?'0 1px 4px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.8)':'none';
      pr.style.background = s.bg?`rgba(0,0,0,${s.bgOpacity})`:'transparent';
      pr.style.padding    = s.bg?'4px 10px':'0';
    }
  };

  const _subStyleReset = () => {
    subStyle = {};
    saveSubStyle();
    const overlay = document.getElementById('modal-sub-style');
    if (overlay) { overlay.remove(); openSubStyle(); }
  };

  // ── SOUS-TITRES — OVERLAY HTML ────────────────────────────────────────────────
  let _subCues     = [];   // [{start, end, text}]
  let _subInterval = null;

  const loadSubtitle = async (streamIndex) => {
    if (!currentVideoRef) return;
    clearSubtitles();
    toast('Chargement des sous-titres…', 'info');

    const vttUrl = `${API}/api/subtitle?rel=${encodeURIComponent(currentVideoRef)}&index=${streamIndex}&_=${Date.now()}`;
    try {
      const resp = await fetch(vttUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      _subCues = _parseVTT(text);
      if (!_subCues.length) { toast('Aucun sous-titre trouvé', 'warning'); return; }
      _startSubOverlay();
      toast(`${_subCues.length} sous-titres chargés`, 'success');
    } catch(e) {
      toast('Erreur chargement sous-titres', 'error');
      console.error('[Sub]', e);
    }
  };

  // Parser VTT minimal
  const _parseVTT = (text) => {
    const cues = [];
    const lines = text.replace(/\r\n/g,'\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      // Chercher une ligne de timing  00:00:00.000 --> 00:00:00.000
      const timeLine = lines[i];
      const m = timeLine.match(/^([\d:,.]+)\s*-->\s*([\d:,.]+)/);
      if (m) {
        const start = _vttTime(m[1]);
        const end   = _vttTime(m[2]);
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '') {
          // Nettoyer les balises HTML des sous-titres
          textLines.push(lines[i].replace(/<[^>]+>/g,'').trim());
          i++;
        }
        if (textLines.length) cues.push({ start, end, text: textLines.join('\n') });
      } else {
        i++;
      }
    }
    return cues;
  };

  const _vttTime = (s) => {
    // Accepte HH:MM:SS.mmm ou MM:SS.mmm
    const parts = s.replace(',','.').split(':').map(Number);
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    return parts[0]*60 + parts[1];
  };

  const _startSubOverlay = () => {
    // Créer ou récupérer le div overlay
    let ov = document.getElementById('sub-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'sub-overlay';
      ov.style.cssText = [
        'position:absolute',
        'bottom:90px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:20',
        'text-align:center',
        'pointer-events:none',
        'max-width:80%',
        'font-family:var(--font-b)',
        'font-size:22px',
        'line-height:1.4',
        'color:#fff',
        'text-shadow:0 1px 4px rgba(0,0,0,.9),0 0 8px rgba(0,0,0,.7)',
        'white-space:pre-line',
      ].join(';');
      $('player-wrap').appendChild(ov);
    }
    ov.textContent = '';
    ov.style.display = 'block';
    applySubStyle(); // appliquer le style sauvegardé

    // Mettre à jour toutes les 100ms
    if (_subInterval) clearInterval(_subInterval);
    _subInterval = setInterval(() => {
      const video = $('player-video');
      if (!video) return;
      const t = video.currentTime;
      const cue = _subCues.find(c => t >= c.start && t <= c.end);
      ov.textContent = cue ? cue.text : '';
    }, 100);
  };

  const clearSubtitles = () => {
    _subCues = [];
    if (_subInterval) { clearInterval(_subInterval); _subInterval = null; }
    const ov = document.getElementById('sub-overlay');
    if (ov) { ov.textContent = ''; ov.style.display = 'none'; }
    // Retirer uniquement les <track> ajoutées dynamiquement par MyFlix
    const video = $('player-video');
    if (!video) return;
    Array.from(video.querySelectorAll('track')).forEach(t => video.removeChild(t));
    // Désactiver toutes les pistes texte natives
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }
    }
  };

  const _playFromStart = (id) => {
    clearProgress(id);
    play(id);
  };

  // ── DETAIL ──
  const showDetail=id=>{
    const m=movies.find(m=>m.id===id); if(!m) return;
    const ps=posterSrc(m); const bs=backdropSrc(m)||ps;
    // Pré-calculer les boutons hors template literal (compatibilité Safari)
    const _prog = getProgress(m.id);
    let _watchBtns;
    if (!m.videoRef) {
      _watchBtns = `<button class="hero-btn-info" style="opacity:.5;cursor:default;font-size:13px;padding:10px 22px">${svg('ic-play')} Pas de vidéo</button>`;
    } else if (_prog && _prog.ts > 10) {
      _watchBtns = `<button class="hero-btn-play" style="font-size:13px;padding:10px 22px" onclick="App.play('${m.id}')">${svg('ic-play')} Reprendre à ${fmt(_prog.ts)}</button>
                   <button class="hero-btn-info" style="font-size:13px;padding:10px 22px" onclick="App._playFromStart('${m.id}')">${svg('ic-play')} Depuis le début</button>`;
    } else {
      _watchBtns = `<button class="hero-btn-play" style="font-size:13px;padding:10px 22px" onclick="App.play('${m.id}')">${svg('ic-play')} Regarder</button>`;
    }
    const _detailLogoSrc = logoSrcF(m);
    const _detailTitleHtml = _detailLogoSrc
      ? `<div class="detail-title-logo"><img class="detail-logo-img" src="${esc(_detailLogoSrc)}" alt="${esc(m.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div class="detail-title" style="display:none">${esc(m.title)}</div></div>`
      : `<div class="detail-title">${esc(m.title)}</div>`;
    $('detail-box').innerHTML=`
      <div class="detail-back">${bs?`<img src="${esc(bs)}" alt="">`:'<div class="detail-back-empty"></div>'}<div class="detail-back-grad"></div><div class="detail-x" onclick="App.closeDetail()">${svg('ic-x')}</div></div>
      <div class="detail-body">
        ${_detailTitleHtml}
        <div class="detail-meta">
          ${m.year?`<span>${esc(m.year)}</span>`:''}
          ${m.duration?`<span>${esc(m.duration)} min</span>`:''}
          ${(m.genres||[]).map(g=>`<span class="dm-genre">${esc(g)}</span>`).join('')}
          ${m.rating?`<span class="dm-rating">★ ${esc(m.rating)}</span>`:''}
        </div>
        <div class="detail-actions">
          ${_watchBtns}
          <button class="hero-btn-info admin-only" style="font-size:13px;padding:10px 22px" onclick="App.openEdit('${m.id}');App.closeDetail()">${svg('ic-edit')} Modifier</button>
          <button class="hero-btn-info hero-btn-danger" style="font-size:13px;padding:10px 22px" onclick="App.confirmDelete('${m.id}');App.closeDetail()">${svg('ic-trash')} Supprimer</button>
        </div>
        ${m.description?`<p class="detail-desc">${esc(m.description)}</p>`:''}
        <div class="detail-grid">
          ${m.director?`<div class="dg-item"><label>Réalisateur</label><span>${esc(m.director)}</span></div>`:''}
          ${m.section?`<div class="dg-item"><label>Section</label><span>${esc(m.section)}</span></div>`:''}
          ${m.year?`<div class="dg-item"><label>Année</label><span>${esc(m.year)}</span></div>`:''}
          ${m.duration?`<div class="dg-item"><label>Durée</label><span>${esc(m.duration)} min</span></div>`:''}
          ${m.rating?`<div class="dg-item"><label>Note</label><span>★ ${esc(m.rating)}/10</span></div>`:''}
          <div class="dg-item"><label>Ajouté le</label><span>${new Date(m.addedAt).toLocaleDateString('fr-FR')}</span></div>
        </div>
      </div>`;
    openModal('modal-detail');
  };
  const closeDetail=()=>closeModal('modal-detail');

  const confirmDelete=id=>{
    const m=movies.find(m=>m.id===id); if(!m) return;
    _confirm({
      title: 'SUPPRIMER LE FILM', message: `Tu es sur le point de supprimer <strong style="color:#fff">${esc(m.title)}</strong>. Le fichier vidéo reste intact sur le disque.`,
      confirmLabel: 'Supprimer', confirmClass: 'btn-confirm-danger',
      onConfirm: () => { movies=movies.filter(x=>x.id!==id); save(); toast('Film supprimé','info'); renderPage(); }
    });
  };

  // ── HERO ──
  const buildHeroProgress=()=>{
    const el=$('hero-progress'); el.innerHTML='';
    heroPool.forEach((_,i)=>{
      const span=document.createElement('span'); span.className='hp-item'+(i===heroIdx?' active':'');
      if(i===heroIdx) span.innerHTML='<span class="hp-fill" id="hp-fill"></span>';
      span.addEventListener('click',()=>jumpHero(i));
      el.appendChild(span);
    });
  };
  const startFill=()=>{
    cancelAnimationFrame(heroProgress); const fill=$('hp-fill'); if(!fill) return;
    heroStart=performance.now();
    const tick=now=>{ const pct=Math.min((now-heroStart)/HERO_DUR,1); fill.style.transform=`scaleX(${pct})`; if(pct<1) heroProgress=requestAnimationFrame(tick); else nextHero(); };
    heroProgress=requestAnimationFrame(tick);
  };
  const setHeroSlide=m=>{
    const content=$('hero-content'); content.classList.add('fading');
    setTimeout(()=>{
      const a=$('hero-bg-a'),b=$('hero-bg-b');
      const heroSrc = imgUrl(m.backdrop || m.poster);
      if (heroSrc) {
        const _hcrop = _settings.get('heroCrop_' + m.id);
        let bgPos = 'center 25%', bgSize = 'cover';
        if (_hcrop && _hcrop.bgX !== undefined) {
          const dx = 100 - _hcrop.bgW, dy = 100 - _hcrop.bgH;
          const px = dx > 0 ? _hcrop.bgX / dx * 100 : 50;
          const py = dy > 0 ? _hcrop.bgY / dy * 100 : 50;
          bgPos  = px + '% ' + py + '%';
          const sizeVal = (100 / _hcrop.bgW * 100);
          // Si le zoom est minimal (≈100%), utiliser cover pour garantir le remplissage
          bgSize = sizeVal <= 102 ? 'cover' : sizeVal + '%';
        }
        const applyBg = (el, src, pos, size) => {
          // Utiliser <img> avec object-fit:cover pour garantir le cadrage
          el.style.backgroundImage = '';
          let img = el.querySelector('img.hero-bg-img');
          if (!img) {
            img = document.createElement('img');
            img.className = 'hero-bg-img';
            img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 25%;display:block;pointer-events:none;';
            el.appendChild(img);
          }
          // Appliquer object-position si crop personnalisé
          if (pos && pos !== 'center 25%') {
            img.style.objectPosition = pos;
          } else {
            img.style.objectPosition = 'center 25%';
          }
          img.src = src;
        };
        applyBg(a, heroSrc, bgPos, bgSize);
        applyBg(b, heroSrc, bgPos, bgSize);
        b.style.opacity='1';
        setTimeout(()=>{ b.style.opacity='0'; }, 50);
      } else { a.style.backgroundImage='none'; a.style.background='linear-gradient(135deg,#1a0505,#0d0d0d)'; }
      $('hero-title').textContent = m.title;
      // Badges : type | année | durée | genres | note
      const badgesEl = $('hero-badges');
      if (badgesEl) {
        const parts = [];
        if (m._isSeries) parts.push('<span class="hero-badge hero-badge-accent">Série</span>');
        else             parts.push('<span class="hero-badge hero-badge-accent">Film</span>');
        if (m.year)      parts.push('<span class="hero-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> '+esc(m.year)+'</span>');
        if (m.rating)    parts.push('<span class="hero-badge hero-badge-rating">★ '+esc(m.rating)+'</span>');
        // genres masqués dans le hero
        badgesEl.innerHTML = parts.join('');
      }
      $('hero-desc').textContent=m.description||'';
      $('hero-play').onclick=()=>play(m.id); $('hero-info').onclick=()=>showDetail(m.id);
      content.classList.remove('fading');
    },300);
  };
  const jumpHero=i=>{ cancelAnimationFrame(heroProgress); heroIdx=i; setHeroSlide(heroPool[heroIdx]); buildHeroProgress(); startFill(); };
  const nextHero=()=>{ heroIdx=(heroIdx+1)%heroPool.length; setHeroSlide(heroPool[heroIdx]); buildHeroProgress(); startFill(); };
  const startHero=()=>{
    cancelAnimationFrame(heroProgress);
    heroPool=[
      ...movies.filter(m=>heroImgSrc(m)),
      ...SeriesManager.getAll().filter(s=>heroImgSrc(s))
    ].slice(0,8);
    if(!heroPool.length){
      const fallback=[...movies,...SeriesManager.getAll()][0];
      if(fallback) heroPool=[fallback]; else return;
    }
    heroIdx=0; $('hero').style.display='flex'; setHeroSlide(heroPool[0]); buildHeroProgress();
    if(heroPool.length>1) startFill();
  };
  const stopHero=()=>{ cancelAnimationFrame(heroProgress); $('hero').style.display='none'; };

  // ── FAVORITES ──
  const isFav=id=>{ const m=movies.find(m=>m.id===id); return m?.favorite||false; };
  const toggleFav=(id,e)=>{
    e.stopPropagation();
    const m=movies.find(m=>m.id===id); if(!m) return;
    m.favorite=!m.favorite; save();
    // update star button in place without re-rendering
    const btn=document.querySelector(`.mc-fav[data-id="${id}"]`);
    if(btn) btn.classList.toggle('active',m.favorite);
    toast(m.favorite?'Ajouté aux favoris':'Retiré des favoris', m.favorite?'success':'info');
  };

  // ── SYSTÈME DE PROGRESSION DE VISIONNAGE ─────────────────────────────────────
  // Storage : localStorage 'myflix_progress'
  // Format  : { [contentId]: { ts, watchedSec, duration, epId? } }
  // Règles  :
  //   - Sauvegarde uniquement après 5 min de visionnage ACTIF (pause non comptée)
  //   - Sauvegarde toutes les 30s une fois le seuil atteint
  //   - Effacé si >= 95% du film regardé (considéré comme "Vu")

  const PROGRESS_KEY     = 'myflix_progress';
  const ACTIVE_THRESHOLD = 5 * 60;   // 5 min en secondes
  const SAVE_INTERVAL    = 30;        // sauvegarder toutes les 30s
  const DONE_THRESHOLD   = 0.95;      // 95% = terminé

  let _progressData = (() => {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch(e) { return {}; }
  })();
  const _saveProgress = () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(_progressData));
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 500);
  };

  // Lire la progression d'un contenu (film ou épisode)
  const getProgress = (contentId) => _progressData[contentId] || null;

  // Effacer la progression (film terminé)
  const clearProgress = (contentId) => {
    delete _progressData[contentId];
    _saveProgress();
  };

  // Watcher actif pendant la lecture
  let _pwContentId  = null;  // id du contenu en cours (movieId ou epId)
  let _pwSeriesId   = null;  // si épisode, id de la série
  let _pwActiveSec  = 0;     // secondes de visionnage actif
  let _pwLastSave   = 0;     // timestamp de la dernière sauvegarde
  let _pwLastTime   = null;  // video.currentTime au tick précédent
  let _pwInterval   = null;

  const startProgressWatcher = (contentId, seriesId = null) => {
    stopProgressWatcher();
    _pwContentId = contentId;
    _pwSeriesId  = seriesId;
    _pwLastSave  = 0;
    _pwLastTime  = null;

    // Restaurer le temps déjà regardé depuis la progression sauvegardée
    const existing = getProgress(contentId);
    _pwActiveSec = existing?.watchedSec || 0;

    const video = $('player-video');

    // Sauvegarder la progression immédiatement
    const saveNow = () => {
      if (!video || !video.duration) return;
      const t = video.currentTime;
      const pct = t / video.duration;
      if (pct >= DONE_THRESHOLD) {
        clearProgress(contentId);
        return;
      }
      _progressData[contentId] = {
        ts: t, duration: video.duration,
        watchedSec: _pwActiveSec,
        seriesId: seriesId || null,
        updatedAt: Date.now(),
      };
      _saveProgress();
      _pwLastSave = t;
    };

    _pwInterval = setInterval(() => {
      if (!video || video.paused || !video.duration) return;

      const now = video.currentTime;
      if (_pwLastTime !== null) {
        const delta = now - _pwLastTime;
        if (delta > 0 && delta < 2) _pwActiveSec += delta;
      }
      _pwLastTime = now;

      // Fin du contenu ?
      if (video.duration && now / video.duration >= DONE_THRESHOLD) {
        clearProgress(contentId);
        stopProgressWatcher();
        return;
      }

      // Sauvegarder dès que le seuil est atteint, puis chaque seconde
      if (_pwActiveSec >= ACTIVE_THRESHOLD) saveNow();
    }, 1000);

    // Sauvegarder aussi sur les seeks (clic sur la barre de lecture)
    const onSeeked = () => {
      if (_pwActiveSec >= ACTIVE_THRESHOLD) saveNow();
    };
    video.addEventListener('seeked', onSeeked);
    video._pwSeeked = onSeeked;
  };

  const stopProgressWatcher = () => {
    if (_pwInterval) { clearInterval(_pwInterval); _pwInterval = null; }
    const video = $('player-video');
    if (video?._pwSeeked) {
      video.removeEventListener('seeked', video._pwSeeked);
      video._pwSeeked = null;
    }
    _pwContentId = null; _pwSeriesId = null;
  };

  // Obtenir tous les contenus "en cours" (progression enregistrée)
  const getInProgress = () => {
    const result = [];
    Object.entries(_progressData).forEach(([id, prog]) => {
      // Film ?
      const movie = movies.find(m => m.id === id);
      if (movie) { result.push({ type:'movie', obj:movie, prog }); return; }
      // Épisode ?
      const ep = SeriesManager.episodes.find(e => e.id === id);
      if (ep) {
        const series = SeriesManager.getById(ep.seriesId);
        if (series) result.push({ type:'episode', obj:ep, series, prog });
      }
    });
    // Trier par date de visionnage la plus récente
    return result.sort((a,b) => (b.prog.updatedAt||0) - (a.prog.updatedAt||0));
  };

  // ── CARD ──
  const mkCard=m=>{
    const div=document.createElement('div'); div.className='movie-card';
    const ps=posterSrc(m);
    const logoSrc=logoSrcF(m);
    const sectionLabel = m.isAnime ? (m.section==='series'?'SÉRIE':'FILM') : (m.section==='series'?'SÉRIE':m.section==='anime'?'SÉRIE':'FILM');
    const descShort=(m.description||'').slice(0,120);
    const prog = getProgress(m.id);
    const progPct = prog ? Math.round(prog.ts / prog.duration * 100) : 0;
    div.innerHTML=`
      <div class="mc-bg" style="${ps?`background-image:url(${ps})`:'display:none'}"></div>
      <div class="mc-bg-empty" style="${ps?'display:none':''}">
        <svg><use href="#ic-film"/></svg>
      </div>
      <div class="mc-overlay-top"></div>
      <div class="mc-badge">${sectionLabel}</div>
      ${prog ? `<div class="mc-progress-bar"><div class="mc-progress-fill" style="width:${progPct}%"></div></div>` : ''}
      <div class="mc-hover-overlay" onclick="App.showDetail('${m.id}')">
        ${logoSrc?`<img class="mc-logo" src="${esc(logoSrc)}" alt="${esc(m.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`:''}
        <div class="mc-title" style="${logoSrc?'display:none':''}">${esc(m.title)}</div>
        <div class="mc-meta">
          ${m.year?`<span class="mc-year">${esc(m.year)}</span>`:''}
          ${m.year&&m.rating?`<span class="mc-dot">·</span>`:''}
          ${m.rating?`<span class="mc-rating">★ ${esc(m.rating)}</span>`:''}
        </div>
        ${descShort?`<div class="mc-desc">${esc(descShort)}</div>`:''}
      </div>`;
    return div;
  };

  const mkSection=(container,title,list,onSeeAll=null,gridClass='movies-grid')=>{
    if(!list.length) return;
    const sec=document.createElement('div'); sec.className='movie-section';
    sec.innerHTML=`<div class="section-header"><div class="section-title">${esc(title)} <span class="section-count">${list.length} film${list.length>1?'s':''}</span></div>${onSeeAll?`<span class="section-see-all" onclick="${onSeeAll}">Voir tout →</span>`:''}</div><div class="${gridClass}"></div>`;
    container.appendChild(sec);
    list.forEach(m=>sec.querySelector('.'+gridClass.split(' ')[0]).appendChild(mkCard(m)));
  };

  // ── GENRE CARD ──
  const mkGenreCard=(genre, list, section)=>{
    const card=document.createElement('div'); card.className='genre-card';
    const colors=GENRE_COLORS[genre]||['#1a1a1a','#2a2a2a'];
    const sample=list.find(m=>backdropSrc(m)||posterSrc(m));
    const imgSrc=sample?(backdropSrc(sample)||posterSrc(sample)):null;
    card.style.cssText=imgSrc?'':`--gc1:${colors[0]};--gc2:${colors[1]}`;
    card.innerHTML=`
      ${imgSrc?`<div class="genre-card-bg" style="background-image:url(${imgSrc})"></div>`:`<div class="genre-card-bg genre-card-no-img"></div>`}
      <div class="genre-card-overlay"></div>
      <div class="genre-card-name">${esc(genre)}</div>
      <div class="genre-card-count">${list.length} film${list.length>1?'s':''}</div>`;
    card.addEventListener('click',()=>goGenre(genre,section));
    return card;
  };

  // ── PAGES ──
  // ── SERIES CARD ──────────────────────────────────────────────────────────────
  const mkSeriesCard = s => {
    const div = document.createElement('div'); div.className = 'movie-card';
    const ps = posterSrc(s);
    const logoSrc = logoSrcF(s);
    const epCount = SeriesManager.countEpisodes(s.id);
    const sectionLabel = 'SÉRIE';
    const inProgEp = SeriesManager.getEpisodes(s.id)
      .map(ep => ({ ep, prog: getProgress(ep.id) }))
      .filter(x => x.prog)
      .sort((a,b) => (b.prog.updatedAt||0) - (a.prog.updatedAt||0))[0];
    const prog = inProgEp?.prog;
    const progPct = prog ? Math.round(prog.ts / prog.duration * 100) : 0;
    div.innerHTML = `
      <div class="mc-bg" style="${ps?`background-image:url(${ps})`:'display:none'}"></div>
      <div class="mc-bg-empty" style="${ps?'display:none':''}">
        <svg><use href="#ic-film"/></svg>
      </div>
      <div class="mc-overlay-top"></div>
      <div class="mc-badge">${sectionLabel}</div>
      ${/* pas de barre de progression sur la cover série */ ''}
      <div class="mc-hover-overlay" onclick="App.showSeriesDetail('${s.id}')">
        ${logoSrc ? `<img class="mc-logo" src="${esc(logoSrc)}" alt="${esc(s.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">` : ''}
        <div class="mc-title" style="${logoSrc?'display:none':''}">${esc(s.title)}</div>
        <div class="mc-meta">
          ${s.year ? `<span class="mc-year">${esc(s.year)}</span>` : ''}
          ${s.year && epCount ? `<span class="mc-dot">·</span>` : ''}
          ${epCount ? `<span>${epCount} ép.</span>` : ''}
          ${s.rating ? `<span class="mc-dot">·</span><span class="mc-rating">★ ${esc(s.rating)}</span>` : ''}
        </div>
        ${s.description ? `<div class="mc-desc">${esc(s.description.slice(0,120))}</div>` : ''}
      </div>`;
    return div;
  };

  // ── SERIES DETAIL ──────────────────────────────────────────────────────────────
  const showSeriesDetail = sid => {
    const s = SeriesManager.getById(sid); if (!s) return;
    const ps = imgUrl(s.poster);
    const bs = imgUrl(s.backdrop) || ps;
    const seasons = SeriesManager.getBySeason(sid);
    const seasonNums = Object.keys(seasons).map(Number).sort((a,b)=>a-b);

    let seasonsHtml = '';

    // Pré-calculer le bouton reprendre (hors template literal)
    const _inProgEp = SeriesManager.getEpisodes(sid)
      .map(ep => ({ ep, prog: getProgress(ep.id) }))
      .filter(x => x.prog)
      .sort((a,b) => (b.prog.updatedAt||0) - (a.prog.updatedAt||0))[0];
    const _resumeBtn = _inProgEp
      ? `<button class="hero-btn-play" style="font-size:13px;padding:10px 22px" onclick="App.playEpisode('${_inProgEp.ep.id}')">${svg('ic-play')} Reprendre S${_inProgEp.ep.season}E${_inProgEp.ep.episode} — ${fmt(_inProgEp.prog.ts)}</button>`
      : '';
    if (seasonNums.length === 0) {
      seasonsHtml = `<p style="color:var(--text-3);font-size:13px;text-align:center;padding:1rem">Aucun épisode pour l'instant.</p>`;
    } else {
      // Fonction pour générer le HTML d'un épisode
      const mkEpHtml = ep => {
        const thumbSrc = ep.thumb ? imgUrl(ep.thumb) : null;
        const epProg = getProgress(ep.id);
        const epProgPct = epProg ? Math.round(epProg.ts / epProg.duration * 100) : 0;
        return `
          <div class="episode-item" onclick="App.playEpisode('${ep.id}')">
            <div class="ep-num">${ep.episode}</div>
            <div class="ep-thumb${!ep.videoRef?' ep-thumb--nofile':''}">
              ${thumbSrc ? `<img src="${esc(thumbSrc)}" alt="">` : `<div class="ep-thumb-placeholder"><svg width="22" height="22"><use href="#ic-film"/></svg></div>`}
              ${ep.videoRef ? `<div class="ep-thumb-play"><svg width="18" height="18"><use href="#ic-play"/></svg></div>` : ''}
              ${epProg ? `<div class="ep-thumb-progress"><div class="ep-thumb-progress-fill" style="width:${epProgPct}%"></div></div>` : ''}
            </div>
            <div class="ep-info">
              <div class="ep-info-top">
                <div class="ep-title">${esc(ep.title || `Épisode ${ep.episode}`)}</div>
                ${ep.duration ? `<div class="ep-duration">${esc(ep.duration)}</div>` : ''}
              </div>
              ${ep.description ? `<div class="ep-desc">${esc(ep.description)}</div>` : ''}
              ${!ep.videoRef ? `<div class="ep-no-video">Aucun fichier vidéo</div>` : ''}
            </div>
            <div class="ep-actions" onclick="event.stopPropagation()">
              <button class="ep-edit-btn" onclick="App.editEpisode('${ep.id}','${sid}')" title="Modifier"><svg><use href="#ic-edit"/></svg></button>
              <button class="ep-del-btn" onclick="App.deleteEpisode('${ep.id}','${sid}')" title="Supprimer"><svg><use href="#ic-trash"/></svg></button>
            </div>
          </div>`;
      };

      // Mode sans saison : tous les épisodes à plat, triés par numéro
      const isNoSeason = seasonNums.length === 1 && seasonNums[0] === 0;
      if (isNoSeason) {
        const allEps = [...(seasons[0]||[])].sort((a,b) => a.episode - b.episode);
        seasonsHtml = `<div class="seasons-wrap noseasen-list">${allEps.map(mkEpHtml).join('')}</div>`;
      } else {
        seasonsHtml = `<div class="seasons-wrap">` + seasonNums.map((sn,i) => {
          const eps = seasons[sn];
          const epsHtml = eps.map(mkEpHtml).join('');
          return `
            <div class="season-block">
              <div class="season-header" onclick="App.toggleSeason(this)">
                <div class="season-header-left">
                  <span class="season-label">Saison ${sn}</span>
                  <span class="season-count">${eps.length} épisode${eps.length>1?'s':''}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
                  <button class="season-del-btn" onclick="App.deleteSeasonEpisodes('${sid}',${sn})">
                    <svg width="13" height="13"><use href="#ic-trash"/></svg> Supprimer la saison
                  </button>
                  <span class="season-chevron${i===0?' open':''}"><svg><use href="#ic-chevron-right"/></svg></span>
                </div>
              </div>
              <div class="episodes-list" style="${i===0?'':'display:none'}">${epsHtml}</div>
            </div>`;
        }).join('') + `</div>`;
      }
    }

    $('series-detail-box').innerHTML = `
      <div class="series-detail-back">
        ${bs ? `<img src="${esc(bs)}" alt="">` : '<div class="series-detail-back-empty"></div>'}
        <div class="series-detail-back-grad"></div>
        <div class="series-detail-x" onclick="App.closeSeriesDetail()"><svg><use href="#ic-x"/></svg></div>
      </div>
      <div class="series-detail-body">
        ${imgUrl(s.logo)
          ? `<div class="detail-title-logo"><img class="detail-logo-img" src="${esc(imgUrl(s.logo))}" alt="${esc(s.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div class="series-detail-title" style="display:none">${esc(s.title)}</div></div>`
          : `<div class="series-detail-title">${esc(s.title)}</div>`
        }
        <div class="series-detail-meta">
          ${s.year ? `<span>${esc(s.year)}</span>` : ''}
          ${(s.genres||[]).map(g=>`<span class="dm-genre">${esc(g)}</span>`).join('')}
          ${s.rating ? `<span class="dm-rating">★ ${esc(s.rating)}</span>` : ''}
        </div>
        <div class="series-detail-actions">
          ${_resumeBtn}
          <button class="hero-btn-info admin-only" style="font-size:13px;padding:10px 22px" onclick="App.openEditSeries('${s.id}')">${svg('ic-edit')} Modifier</button>
          <button class="hero-btn-info hero-btn-danger" style="font-size:13px;padding:10px 22px" onclick="App.deleteSeries('${s.id}')">${svg('ic-trash')} Supprimer</button>
        </div>
        ${s.description ? `<p class="series-detail-desc">${esc(s.description)}</p>` : ''}
        ${seasonsHtml}
        <button class="btn-add-episode primary" onclick="App.openAddEpisodeForSeries('${s.id}')">
          <span style="font-size:16px;line-height:1;margin-top:-1px">+</span> Ajouter un épisode
        </button>
        <button class="btn-add-episode" onclick="App.openBulkImport('${s.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Importer une saison
        </button>
      </div>`;
    openModal('modal-series-detail');
  };

  const closeSeriesDetail = () => closeModal('modal-series-detail');

  const toggleSeason = (header) => {
    const list = header.nextElementSibling;
    const chevron = header.querySelector('.season-chevron');
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : '';
    chevron.classList.toggle('open', !open);
  };

  const toggleSeriesFav = (id, e) => {
    e.stopPropagation();
    const fav = SeriesManager.toggleFav(id);
    const btn = document.querySelector(`.mc-fav[data-id="${id}"]`);
    if (btn) btn.classList.toggle('active', fav);
    toast(fav ? 'Ajouté aux favoris' : 'Retiré des favoris', fav ? 'success' : 'info');
  };

  const deleteSeries = (id) => {
    const s = SeriesManager.getById(id); if (!s) return;
    const epCount = SeriesManager.countEpisodes(id);
    _confirm({
      title: 'SUPPRIMER LA SÉRIE', message: `Tu es sur le point de supprimer <strong style="color:#fff">${esc(s.title)}</strong> et ses ${epCount} épisode${epCount>1?'s':''}. Les fichiers vidéo restent intacts sur le disque.`,
      confirmLabel: 'Supprimer', confirmClass: 'btn-confirm-danger',
      onConfirm: () => { SeriesManager.deleteSeries(id); closeSeriesDetail(); toast('Série supprimée', 'info'); renderPage(); }
    });
  };

  const editEpisode = (epId, sid) => {
    const ep = SeriesManager.episodes.find(e => e.id === epId); if (!ep) return;
    const overlay = document.createElement('div');
    overlay.className = 'm-overlay open'; overlay.id = 'modal-ep-edit';
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="m-box" style="max-width:480px">
        <div class="m-head">
          <h2>MODIFIER L'ÉPISODE</h2>
          <div class="m-close" id="ep-edit-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body">
          <div class="fg-row">
            <div class="fg">
              <label>Saison</label>
              <input type="number" id="epe-season" value="${ep.season}" min="1" max="99">
            </div>
            <div class="fg">
              <label>Épisode</label>
              <input type="number" id="epe-number" value="${ep.episode}" min="1" max="999">
            </div>
          </div>
          <div class="fg">
            <label>Titre</label>
            <input type="text" id="epe-title" value="${esc(ep.title||'')}" placeholder="Titre de l'épisode">
          </div>
          <div class="fg">
            <label>Durée</label>
            <input type="text" id="epe-duration" value="${esc(ep.duration||'')}" placeholder="Ex : 23 min">
          </div>
          <div class="fg">
            <label>Description</label>
            <textarea id="epe-desc" rows="3" placeholder="Résumé de l'épisode…" style="resize:vertical">${esc(ep.description||'')}</textarea>
          </div>
          <div class="fg">
            <label>Image <span style="color:var(--text-3);font-weight:400;letter-spacing:0;text-transform:none;font-size:10px">— nom du fichier dans <code>images/</code></span></label>
            <input type="text" id="epe-thumb" value="${esc(ep.thumb||'')}" placeholder="ex: serie-s01e01.jpg" autocomplete="off">
            <div id="epe-thumb-preview" style="${ep.thumb?'':'display:none;'}margin-top:.5rem;border-radius:6px;overflow:hidden;max-height:120px">
              <img id="epe-thumb-img" src="${ep.thumb?imgUrl(ep.thumb):''}" alt="" style="width:100%;height:120px;object-fit:cover">
            </div>
            <div id="epe-apply-range-wrap" style="display:${ep.thumb?'block':'none'};margin-top:.6rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:.75rem">
              <div style="font-family:var(--font-b);font-size:10px;color:var(--text-3);letter-spacing:.07em;text-transform:uppercase;margin-bottom:.55rem">Appliquer à une plage d'épisodes</div>
              <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                <span style="font-family:var(--font-b);font-size:12px;color:var(--text-2);white-space:nowrap">De l'ép.</span>
                <input type="number" id="epe-range-from" placeholder="${ep.episode}" min="1"
                  style="width:80px;padding:.35rem .5rem;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;color:#fff;font-family:var(--font-b);font-size:12px;text-align:center">
                <span style="font-family:var(--font-b);font-size:12px;color:var(--text-2);white-space:nowrap">à l'ép.</span>
                <input type="number" id="epe-range-to" placeholder="${ep.episode}" min="1"
                  style="width:80px;padding:.35rem .5rem;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;color:#fff;font-family:var(--font-b);font-size:12px;text-align:center">
                <button id="epe-apply-range" type="button"
                  style="flex:1;min-width:80px;padding:.38rem .7rem;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#fff;font-family:var(--font-b);font-size:11px;cursor:pointer;transition:background .15s;white-space:nowrap">
                  Appliquer
                </button>
              </div>
              <div id="epe-apply-feedback" style="display:none;margin-top:.4rem;font-family:var(--font-b);font-size:11px;color:#4caf50"></div>
            </div>
          </div>
          <div class="fg">
            <label>Fichier vidéo</label>
            <div style="display:flex;align-items:center;gap:.6rem">
              <div style="flex:1;padding:.55rem .75rem;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:var(--r);font-size:12px;color:var(--text-2);font-family:var(--font-b);word-break:break-all">
                ${ep.videoRef ? esc(ep.videoRef.split('/').pop()) : '<span style="color:var(--text-3)">Aucun fichier</span>'}
              </div>
              <button onclick="App._epEditChooseFile('${epId}')" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.55rem .8rem;font-family:var(--font-b);font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">Changer</button>
            </div>
          </div>
          <div style="display:flex;gap:.6rem;margin-top:1rem">
            <button id="ep-edit-cancel" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.65rem 1rem;font-family:var(--font-b);font-size:12px;cursor:pointer;flex-shrink:0">Annuler</button>
            <button class="btn-submit" id="ep-edit-save" style="flex:1;margin:0">Enregistrer</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    overlay.querySelector('#ep-edit-close').addEventListener('click', close);
    overlay.querySelector('#ep-edit-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Watcher thumbnail
    const thumbInp   = overlay.querySelector('#epe-thumb');

    thumbInp.addEventListener('input', () => {
      const name = thumbInp.value.trim();
      const wrap = overlay.querySelector('#epe-thumb-preview');
      const img  = overlay.querySelector('#epe-thumb-img');
      if (name) {
        img.src = imgUrl(name);
        wrap.style.display = 'block';
        if (applyRangeWrap) applyRangeWrap.style.display = 'block';
      } else {
        wrap.style.display = 'none';
        if (applyRangeWrap) applyRangeWrap.style.display = 'none';
      }
    });

    // Appliquer à une plage d'épisodes
    const applyRangeWrap = overlay.querySelector('#epe-apply-range-wrap');
    const applyRangeBtn  = overlay.querySelector('#epe-apply-range');
    const feedback       = overlay.querySelector('#epe-apply-feedback');

    if (applyRangeBtn) {
      applyRangeBtn.addEventListener('click', () => {
        const thumbVal = thumbInp.value.trim();
        if (!thumbVal) return;

        const fromVal = overlay.querySelector('#epe-range-from').value.trim();
        const toVal   = overlay.querySelector('#epe-range-to').value.trim();
        const fromNum = fromVal ? parseInt(fromVal) : null;
        const toNum   = toVal   ? parseInt(toVal)   : null;

        const allEps = SeriesManager.getEpisodes(sid);
        const targets = allEps.filter(e => {
          if (fromNum !== null && e.episode < fromNum) return false;
          if (toNum   !== null && e.episode > toNum)   return false;
          return true;
        });

        if (!targets.length) {
          toast('Aucun épisode dans cette plage', 'error'); return;
        }

        const rangeLabel = (fromNum || '?') + ' → ' + (toNum || '?');
        if (!confirm('Appliquer "' + thumbVal + '" aux ' + targets.length + ' épisodes (' + rangeLabel + ') ?')) return;

        targets.forEach(e => SeriesManager.updateEpisode(e.id, { thumb: thumbVal }));
        toast('Image appliquée à ' + targets.length + ' épisode' + (targets.length>1?'s':'') + ' ✓', 'success');

        if (feedback) {
          feedback.textContent = '✓ Appliqué à ' + targets.length + ' épisode' + (targets.length>1?'s':'') + ' (ép. ' + rangeLabel + ')';
          feedback.style.display = 'block';
        }
        applyRangeBtn.style.background = 'rgba(76,175,80,.2)';
        applyRangeBtn.style.borderColor = 'rgba(76,175,80,.4)';
        setTimeout(() => {
          applyRangeBtn.style.background = '';
          applyRangeBtn.style.borderColor = '';
        }, 2000);
      });
    }

    // Sauvegarder
    overlay.querySelector('#ep-edit-save').addEventListener('click', () => {
      SeriesManager.updateEpisode(epId, {
        season     : parseInt(overlay.querySelector('#epe-season').value) || ep.season,
        episode    : parseInt(overlay.querySelector('#epe-number').value) || ep.episode,
        title      : overlay.querySelector('#epe-title').value.trim() || ep.title,
        duration   : overlay.querySelector('#epe-duration').value.trim(),
        description: overlay.querySelector('#epe-desc').value.trim(),
        thumb      : overlay.querySelector('#epe-thumb').value.trim() || null,
      });
      toast('Épisode mis à jour', 'success');
      close();
      showSeriesDetail(sid);
    });
  };

  // Changer le fichier vidéo depuis la modale d'édition épisode
  let _epEditId = null;
  const _epEditChooseFile = (epId) => {
    _epEditId = epId;
    _filePickerMode = 'episode-edit';
    openFilePicker('episode-edit');
  };

  // ── MODALE DE CONFIRMATION CUSTOM ────────────────────────────────────────────
  const _confirm = (opts) => {
    const existing = document.getElementById('modal-custom-confirm');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-custom-confirm';
    overlay.className = 'm-overlay open';
    overlay.style.cssText = 'z-index:9999';
    const confirmCls = opts.confirmClass || 'btn-confirm-danger';
    overlay.innerHTML = `
      <div class="m-box" style="max-width:380px">
        <div class="m-head" style="border-bottom:none;padding-bottom:0">
          <h2 style="font-size:13px;letter-spacing:.08em">${esc(opts.title || 'CONFIRMATION')}</h2>
        </div>
        <div class="m-body" style="padding-top:.6rem">
          <p style="color:var(--text-2);font-size:14px;line-height:1.6;margin-bottom:1.4rem">${opts.message || ''}</p>
          <div style="display:flex;gap:.6rem;justify-content:flex-end">
            <button id="cc-cancel" class="hero-btn-info" style="font-size:13px;padding:9px 20px">Annuler</button>
            <button id="cc-ok" class="${confirmCls}" style="font-size:13px;padding:9px 20px">${esc(opts.confirmLabel || 'Confirmer')}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.querySelector('#cc-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#cc-ok').onclick = () => { close(); opts.onConfirm(); };
  };

  const deleteEpisode = (epId, sid) => {
    _confirm({
      title: 'SUPPRIMER L\'ÉPISODE',
      message: 'Cette action est irréversible. Seule la référence est supprimée, le fichier vidéo reste intact sur le disque.',
      confirmLabel: 'Supprimer', confirmClass: 'btn-confirm-danger',
      onConfirm: () => { SeriesManager.deleteEpisode(epId); toast('Épisode supprimé', 'info'); showSeriesDetail(sid); }
    });
  };

  const deleteSeasonEpisodes = (sid, sn) => {
    const eps = SeriesManager.getEpisodes(sid).filter(e => e.season === Number(sn));
    if (!eps.length) return;
    _confirm({
      title: `SUPPRIMER LA SAISON ${sn}`,
      message: `Tu es sur le point de supprimer les <strong style="color:#fff">${eps.length} épisode${eps.length>1?'s':''}</strong> de la saison ${sn}. Les fichiers vidéo restent intacts sur le disque.`,
      confirmLabel: `Supprimer ${eps.length} épisode${eps.length>1?'s':''}`, confirmClass: 'btn-confirm-danger',
      onConfirm: () => { eps.forEach(e=>SeriesManager.deleteEpisode(e.id)); toast(`Saison ${sn} supprimée`, 'info'); showSeriesDetail(sid); }
    });
  };

  // ── PLAY EPISODE ──
  // ── NAVIGATION ÉPISODES ──────────────────────────────────────────────────────
  let _currentEpId  = null; // id de l'épisode en cours
  let _currentSid   = null; // id de la série en cours

  const _getAdjacentEpisode = (offset) => {
    if (!_currentEpId || !_currentSid) return null;
    const eps = SeriesManager.getEpisodes(_currentSid)
      .sort((a,b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode);
    const idx = eps.findIndex(e => e.id === _currentEpId);
    if (idx === -1) return null;
    return eps[idx + offset] || null;
  };

  const _updateEpNavButtons = () => {
    const prev = _getAdjacentEpisode(-1);
    const next = _getAdjacentEpisode(1);
    const prevBtn = $('player-prev-ep');
    const nextBtn = $('player-next-ep');
    if (!prevBtn || !nextBtn) return;
    if (_currentEpId) {
      prevBtn.style.display = prev ? 'flex' : 'none';
      nextBtn.style.display = next ? 'flex' : 'none';
    } else {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    }
  };

  const _hideNextEpOverlay = () => {
    const ov = $('player-next-ep-overlay');
    if (ov) ov.style.display = 'none';
  };

  const _showNextEpOverlay = () => {
    const next = _getAdjacentEpisode(1);
    if (!next) return;
    const ov = $('player-next-ep-overlay');
    if (ov) ov.style.display = 'block';
  };

  const playEpisode = epId => {
    const ep = SeriesManager.episodes.find(e => e.id === epId);
    if (!ep) return;
    if (!ep.videoRef) { toast('Aucun fichier vidéo pour cet épisode', 'warning'); return; }
    if (!serverOnline) { toast('Lance le serveur LANCER_MYFLIX.command pour regarder les vidéos', 'error'); return; }
    const s = SeriesManager.getById(ep.seriesId);
    const title = `${s?.title||''} — S${String(ep.season).padStart(2,'0')}E${String(ep.episode).padStart(2,'0')} ${ep.title||''}`.trim();
    const video = $('player-video');
    $('player-center-title').textContent = title;

    video.pause();
    clearSubtitles();
    _hideTrackBtns();
    _hideNextEpOverlay();
    video.removeAttribute('src');

    // Mémoriser l'épisode courant
    _currentEpId = epId;
    _currentSid  = ep.seriesId;

    $('player-wrap').classList.add('open','show-cursor');
    _ss.stop(); // Suspendre l'écran de veille pendant la lecture
    document.body.style.overflow = 'hidden';
    video.volume=1; video.muted=false; $('player-vol').value=1;

    // Afficher/masquer les boutons prev/next
    _updateEpNavButtons();

    const onMeta = () => {
      video.removeEventListener('loadedmetadata', onMeta);
      loadTracks(ep.videoRef);
      _updateRestartBtn(epId);
      const prog = getProgress(epId);
      if(prog && prog.ts > 10) {
        video.currentTime = prog.ts;
        toast(`Reprise à ${fmt(prog.ts)}`, 'info');
      }
    };
    video.addEventListener('loadedmetadata', onMeta);

    // Détecter les 30 dernières secondes pour afficher l'overlay
    if (video._epTimeUpdate) video.removeEventListener('timeupdate', video._epTimeUpdate);
    const onTimeUpdate = () => {
      if (!video.duration) return;
      const remaining = video.duration - video.currentTime;
      if (remaining <= 30 && remaining > 0) _showNextEpOverlay();
      else _hideNextEpOverlay();
    };
    video._epTimeUpdate = onTimeUpdate;
    video.addEventListener('timeupdate', onTimeUpdate);

    const src = `${API}/media/${ep.videoRef.split('/').map(encodeURIComponent).join('/')}`;
    video.src = src;
    video.load();
    video.play().catch(()=>{});
    startProgressWatcher(epId, ep.seriesId);
    initSprite(ep.videoRef);

    // Fin de l'épisode
    const onEpEnded = () => {
      clearProgress(epId);
      _hideNextEpOverlay();
      const next = _getAdjacentEpisode(1);
      if (next) {
        // Il y a un épisode suivant — ne rien faire, l'overlay "suivant" aura déjà apparu
        // mais on affiche quand même la page de fin avec l'option de continuer
        showEndScreen('episode', { ep, series: s });
      } else {
        // Dernier épisode de la série
        showEndScreen('series-end', { ep, series: s });
      }
    };
    if(video._epEnded) video.removeEventListener('ended', video._epEnded);
    video._epEnded = onEpEnded;
    video.addEventListener('ended', onEpEnded);
  };

  // ── CREATE / EDIT SERIES MODAL ────────────────────────────────────────────────
  let editSeriesId = null;
  let sfSelectedGenres = [];

  const renderSFGenrePicker = (section='series') => {
    const genres = section === 'anime' ? GENRES_ANIME : GENRES_SERIES;
    const el = $('sf-genre-picker'); el.innerHTML = '';
    genres.forEach(g => {
      const chip = document.createElement('span');
      chip.className = 'gp-chip' + (sfSelectedGenres.includes(g) ? ' selected' : '');
      chip.textContent = g;
      chip.addEventListener('click', () => {
        if (sfSelectedGenres.includes(g)) sfSelectedGenres = sfSelectedGenres.filter(x=>x!==g);
        else sfSelectedGenres.push(g);
        chip.classList.toggle('selected', sfSelectedGenres.includes(g));
      });
      el.appendChild(chip);
    });
  };

  const openNewSeries = (prefill = null) => {
    editSeriesId = null; sfSelectedGenres = [];
    $('modal-series-title').textContent = 'NOUVELLE SÉRIE';
    if($('sf-no-season')) $('sf-no-season').checked = false;
    $('series-form').reset();
    if($('sf-poster-name'))   $('sf-poster-name').value='';
    if($('sf-backdrop-name')) $('sf-backdrop-name').value='';
    if($('sf-logo-name'))     $('sf-logo-name').value='';
    $('sf-poster-img').style.display = 'none';
    $('sf-poster-thumb').querySelector('svg').style.display = '';
    $('sf-backdrop-wrap').style.display = 'none';
    if($('sf-logo-wrap')) $('sf-logo-wrap').style.display = 'none';
    if (prefill?.title) $('sf-title').value = prefill.title;
    if (prefill?.section) $('sf-section').value = prefill.section;
    renderSFGenrePicker($('sf-section').value);
    $('sf-submit').textContent = 'Créer la série';
    openModal('modal-series');
  };

  const openEditSeries = id => {
    const s = SeriesManager.getById(id); if (!s) return;
    editSeriesId = id; sfSelectedGenres = [...(s.genres||[])];
    $('modal-series-title').textContent = 'MODIFIER LA SÉRIE';
    $('sf-title').value = s.title||''; $('sf-year').value = s.year||'';
    $('sf-section').value = s.section||'series'; $('sf-rating').value = s.rating||'';
    $('sf-description').value = s.description||'';
    if (s.poster)   { if($('sf-poster-name'))   $('sf-poster-name').value=s.poster;   loadImgEl($('sf-poster-img'),s.poster);   $('sf-poster-img').style.display='block'; $('sf-poster-thumb').querySelector('svg').style.display='none'; }
    if (s.backdrop) { if($('sf-backdrop-name')) $('sf-backdrop-name').value=s.backdrop; loadImgEl($('sf-backdrop-img'),s.backdrop); $('sf-backdrop-wrap').style.display='block'; }
    if (s.logo)     { if($('sf-logo-name'))     $('sf-logo-name').value=s.logo;         loadImgEl($('sf-logo-img'),s.logo);         $('sf-logo-wrap').style.display='block'; }
    renderSFGenrePicker(s.section||'series');
    if($('sf-no-season')) $('sf-no-season').checked = !!(s.noSeason);
    $('sf-submit').textContent = 'Enregistrer';
    closeSeriesDetail();
    openModal('modal-series');
  };

  const submitSeries = () => {
    const title = $('sf-title').value.trim();
    if (!title) { toast('Le titre est requis', 'error'); return; }
    const prev = editSeriesId ? SeriesManager.getById(editSeriesId) : null;
    const data = {
      title, year:$('sf-year').value||'', section:$('sf-section').value||'series',
      genres:sfSelectedGenres.length?[...sfSelectedGenres]:['Autre'],
      rating:$('sf-rating').value||'', description:$('sf-description').value.trim()||'',
      poster  : $('sf-poster-name')?.value.trim()   || prev?.poster   || null,
      backdrop: $('sf-backdrop-name')?.value.trim() || prev?.backdrop || null,
      logo    : $('sf-logo-name')?.value.trim()     || prev?.logo     || null,
      noSeason: !!($('sf-no-season')?.checked),
    };
    if (editSeriesId) {
      SeriesManager.updateSeries(editSeriesId, data);
      // Si on active "sans saison", migrer tous les épisodes season!=0 vers season:0
      if (data.noSeason) {
        SeriesManager.getEpisodes(editSeriesId)
          .filter(ep => ep.season !== 0)
          .forEach(ep => SeriesManager.updateEpisode(ep.id, { season: 0 }));
      }
      toast('Série mise à jour !', 'success');
    }
    else { SeriesManager.createSeries(data); toast('Série créée !', 'success'); }
    _flushSaveNow();
    closeModal('modal-series');
    renderPage();
    return editSeriesId ? null : SeriesManager.getAll()[0];
  };

  // ── ADD EPISODE MODAL ──────────────────────────────────────────────────────────
  let epCurrentSeriesId = null;
  let epCurrentFile = null;
  let epCurrentFileRef = null;

  const openAddEpisode = (fileRef = null, fileName = null) => {
    epCurrentFile = null;
    epCurrentFileRef = fileRef;
    epCurrentSeriesId = null;
    $('ep-file-name').textContent = fileName || 'Aucun fichier sélectionné';
    $('ep-file-size').textContent = fileRef ? '— disque dur' : '';
    $('modal-ep-title').textContent = 'AJOUTER UN ÉPISODE';
    resetEpisodeForm();
    openModal('modal-episode');
  };

  const openAddEpisodeForSeries = (sid) => {
    epCurrentFile = null; epCurrentFileRef = null;
    epCurrentSeriesId = sid;
    const s = SeriesManager.getById(sid);
    $('ep-file-name').textContent = 'Aucun fichier sélectionné';
    $('ep-file-size').textContent = '';
    $('modal-ep-title').textContent = `ÉPISODE — ${s?.title||''}`;
    resetEpisodeForm(sid);
    openModal('modal-episode');
    closeSeriesDetail();
  };

  const resetEpisodeForm = (preselectSid = null) => {
    $('ep-season').value = 1; $('ep-number').value = 1; $('ep-title').value = '';
    $('ep-series-search').value = '';
    if (preselectSid) {
      const s = SeriesManager.getById(preselectSid);
      if (s) selectEpisodeSeries(s);
    } else {
      $('ep-series-selected').style.display = 'none';
      $('ep-series-pick-group').querySelector('.ep-series-search-wrap').style.display = '';
      $('ep-series-search').style.display = '';
    }
  };

  const selectEpisodeSeries = (s) => {
    epCurrentSeriesId = s.id;
    $('ep-series-selected-info').textContent = s.title;
    $('ep-series-selected').style.display = 'flex';
    $('ep-series-dropdown').style.display = 'none';
    $('ep-series-search').style.display = 'none';
  };

  const submitEpisode = async () => {
    if (!epCurrentSeriesId) { toast('Choisis ou crée une série', 'error'); return; }
    const season  = parseInt($('ep-season').value) || 1;
    const episode = parseInt($('ep-number').value) || 1;
    if (SeriesManager.episodeExists(epCurrentSeriesId, season, episode)) {
      if (!confirm(`S${season}E${episode} existe déjà. Remplacer ?`)) return;
      const existing = SeriesManager.getEpisodes(epCurrentSeriesId).find(e=>e.season===season&&e.episode===episode);
      if (existing) SeriesManager.deleteEpisode(existing.id);
    }
    const btn = $('ep-submit'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    SeriesManager.addEpisode({
      seriesId: epCurrentSeriesId, season, episode,
      title: $('ep-title').value.trim() || `Épisode ${episode}`,
      videoRef: epCurrentFileRef || null
    });
    toast(`S${season}E${episode} ajouté !`, 'success');
    closeModal('modal-episode'); renderPage();
    btn.disabled = false; btn.textContent = "Enregistrer l'épisode";
  };

  // ── IMPORT AUTOMATIQUE D'UNE SAISON ──────────────────────────────────────────
  // Parse les noms de fichiers pour détecter saison/épisode
  // Supporte : S01E01, s1e1, 1x01, E01, ep01, ep1, 01, etc.
  const _parseEpInfo = (filename) => {
    const name = filename.replace(/\.[^.]+$/, ''); // enlever extension
    let season = null, episode = null;

    // Format SxxExx ou sxexx (ex: S01E05, s2e3)
    let m = name.match(/[Ss](\d{1,2})[Ee](\d{1,4})/);
    if (m) { season = parseInt(m[1]); episode = parseInt(m[2]); return { season, episode }; }

    // NxNN
    m = name.match(/(\d{1,2})x(\d{1,4})/i);
    if (m) { season = parseInt(m[1]); episode = parseInt(m[2]); return { season, episode }; }

    // Episode N
    m = name.match(/(?:episode|ep\.?)\s*(\d{1,4})/i);
    if (m) { return { season: 1, episode: parseInt(m[1]) }; }

    // E01 seul - jusqu'a 4 chiffres
    m = name.match(/\bE(\d{1,4})\b/i);
    if (m) { return { season: 1, episode: parseInt(m[1]) }; }

    // Numero seul
    m = name.match(/\b(\d{2,4})\b(?!.*\d)/);
    if (m) { return { season: 1, episode: parseInt(m[1]) }; }

    return null;
  };

  // Nettoyer le nom de fichier pour en faire un titre lisible
  const _cleanTitle = (filename) => {
    return filename
      .replace(/\.[^.]+$/, '')           // extension
      .replace(/[Ss]\d{1,2}[Ee]\d{1,3}/, '') // SxxExx
      .replace(/\d{1,2}x\d{1,3}/i, '')   // NxNN
      .replace(/(?:episode|ep\.?)\s*\d+/i, '') // Episode N
      .replace(/\bE\d{1,4}\b/i, '')
      .replace(/[._\-]+/g, ' ')           // ponctuation → espace
      .replace(/\s{2,}/g, ' ')            // espaces multiples
      .trim();
  };

  const openBulkImport = async (sid) => {
    if (!serverOnline) { toast('Le serveur n\'est pas démarre', 'error'); return; }
    const s = SeriesManager.getById(sid); if (!s) return;
    const d = await apiGet('/api/files');
    if (!d || d.error) { toast('Impossible de charger les fichiers', 'error'); return; }

    const noSeason = !!(s.noSeason);
    const usedRels = new Set(SeriesManager.getEpisodes(sid).map(e => e.videoRef).filter(Boolean));

    // Filtrer par nom de série
    const seriesTitleLower = s.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const seriesFiles = d.files.filter(f => (f.rel||f.name||'').toLowerCase().replace(/[^a-z0-9]/g,'').includes(seriesTitleLower));
    const sourceFiles = seriesFiles.length > 0 ? seriesFiles : d.files;

    let detected;
    if (noSeason) {
      const sorted = [...sourceFiles].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric:true }));
      detected = sorted.map(f => {
        const info = _parseEpInfo(f.name);
        return { ...f, season:0, episode: info ? info.episode : 0 };
      });
    } else {
      // Détecter les épisodes avec leur numéro
      const parsed = sourceFiles
        .map(f => { const info = _parseEpInfo(f.name); return info ? { ...f, ...info } : null; })
        .filter(Boolean)
        .sort((a,b) => a.episode-b.episode);
      
      // Si tous les fichiers ont season:1 et aucun "S1" dans le nom → probablement sans saison
      const allSeason1 = parsed.length > 0 && parsed.every(f => f.season === 1);
      const hasExplicitSeason = parsed.some(f => /[Ss]\d{1,2}[Ee]/.test(f.name));
      
      if (!parsed.length) {
        // Aucun épisode détecté → mode sans saison automatique
        const sorted = [...sourceFiles].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric:true }));
        SeriesManager.updateSeries(sid, { noSeason: true });
        detected = sorted.map(f => {
          const info = _parseEpInfo(f.name);
          return { ...f, season:0, episode: info ? info.episode : 0 };
        });
      } else if (allSeason1 && !hasExplicitSeason) {
        // E1143 détecté comme S1E1143 alors qu'il n'y a pas de S1 → forcer sans saison
        SeriesManager.updateSeries(sid, { noSeason: true });
        detected = parsed.map(f => ({ ...f, season:0 }));
      } else {
        detected = parsed;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'm-overlay open'; overlay.id = 'modal-bulk';
    overlay.style.zIndex = '500';

    const buildRows = (filter) => {
      const list = filter ? detected.filter(f => f.name.toLowerCase().includes(filter.toLowerCase())) : detected;
      if (!list.length) return '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:2rem">Aucun fichier trouv\u00e9.</div>';
      return list.map(f => {
        const isUsed = usedRels.has(f.rel);
        const title  = _cleanTitle(f.name);
        const epLbl  = noSeason ? ('\u00c9p. '+f.episode) : ('S'+f.season+'E'+String(f.episode).padStart(2,'0'));
        return '<label class="bulk-row' + (isUsed?' bulk-row--used':'') + '" style="display:flex;align-items:center;gap:.7rem;padding:.55rem .8rem;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:var(--r);cursor:pointer">'
          + '<input type="checkbox" data-rel="'+esc(f.rel)+'" data-name="'+esc(f.name)+'" data-season="'+f.season+'" data-episode="'+f.episode+'" '+(isUsed?'':'checked')+' style="accent-color:var(--accent);width:14px;height:14px;flex-shrink:0">'
          + '<div style="flex:1;min-width:0"><div style="font-size:12px;font-family:var(--font-b);color:'+(isUsed?'var(--text-3)':'#fff')+'"><span style="color:var(--accent);margin-right:6px">'+epLbl+'</span>'+esc(title||f.name)+'</div>'
          + '<div style="font-size:11px;color:var(--text-3);margin-top:2px">'+f.sizeMB+' MB'+(isUsed?' · <span style="color:#4caf50">\u2713 D\u00e9j\u00e0 ajout\u00e9</span>':'')+'</div></div></label>';
      }).join('');
    };

    const modeLabel = noSeason ? '\u00c9PISODES' : 'IMPORTER UNE SAISON';
    overlay.innerHTML = '<div class="m-box wide" style="max-width:620px">'
      + '<div class="m-head"><h2>'+modeLabel+' <span style="font-family:var(--font-b);font-size:12px;font-weight:400;color:var(--text-3)">\u2014 '+esc(s.title)+'</span></h2>'
      + '<div class="m-close" id="bulk-close"><svg><use href="#ic-x"/></svg></div></div>'
      + '<div class="m-body" style="padding-top:.8rem">'
      + '<div style="font-size:12px;color:var(--text-3);margin-bottom:.8rem">'+detected.length+' fichier'+(detected.length>1?'s':'')+' trouv'+(detected.length>1?'\u00e9s':'\u00e9')+'.</div>'
      + '<div style="display:flex;gap:.5rem;margin-bottom:.8rem;align-items:center">'
      + '<div style="position:relative;flex:1"><svg width="13" height="13" style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--text-3)"><use href="#ic-search"/></svg>'
      + '<input id="bulk-search" type="text" placeholder="Filtrer\u2026" style="width:100%;padding:.5rem .7rem .5rem 2rem;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:var(--r);color:#fff;font-family:var(--font-b);font-size:12px;box-sizing:border-box"></div>'
      + '<button id="bulk-check-all" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.45rem .8rem;font-family:var(--font-b);font-size:11px;cursor:pointer;white-space:nowrap">Tout cocher</button>'
      + '<button id="bulk-uncheck-all" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.45rem .8rem;font-family:var(--font-b);font-size:11px;cursor:pointer;white-space:nowrap">Tout d\u00e9cocher</button></div>'
      + '<div id="bulk-list" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:.3rem">'+buildRows()+'</div>'
      + '<div style="display:flex;gap:.6rem;margin-top:1rem;align-items:center">'
      + '<span id="bulk-count" style="font-size:12px;color:var(--text-3);flex:1"></span>'
      + '<button id="bulk-cancel" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.65rem 1rem;font-family:var(--font-b);font-size:12px;cursor:pointer">Annuler</button>'
      + '<button id="bulk-submit" class="btn-submit" style="margin:0">Importer les s\u00e9lectionn\u00e9s</button>'
      + '</div></div></div>';

    document.body.appendChild(overlay);

    const updateCount = () => {
      const n = overlay.querySelectorAll('input[type=checkbox]:checked').length;
      $('bulk-count').textContent = n ? (n+' \u00e9pisode'+(n>1?'s':'')+' s\u00e9lectionn\u00e9'+(n>1?'s':'')) : '';
    };
    updateCount();
    overlay.addEventListener('change', updateCount);
    $('bulk-search').addEventListener('input', e => { $('bulk-list').innerHTML = buildRows(e.target.value); updateCount(); });
    $('bulk-check-all').addEventListener('click', () => { overlay.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true); updateCount(); });
    $('bulk-uncheck-all').addEventListener('click', () => { overlay.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false); updateCount(); });

    const close = () => overlay.remove();
    $('bulk-close').addEventListener('click', close);
    $('bulk-cancel').addEventListener('click', close);

    $('bulk-submit').addEventListener('click', () => {
      const checked = [...overlay.querySelectorAll('input[type=checkbox]:checked')];
      if (!checked.length) { toast('Aucun \u00e9pisode s\u00e9lectionn\u00e9', 'error'); return; }
      const btn = $('bulk-submit'); btn.disabled=true; btn.textContent='Import en cours\u2026';
      let added = 0;
      checked.forEach(cb => {
        const rel=cb.dataset.rel, name=cb.dataset.name;
        const season=parseInt(cb.dataset.season), episode=parseInt(cb.dataset.episode);
        const title=_cleanTitle(name);
        const existing=SeriesManager.getEpisodes(sid).find(e=>e.season===season&&e.episode===episode);
        if (existing) SeriesManager.deleteEpisode(existing.id);
        SeriesManager.addEpisode({ seriesId:sid, season, episode, title:title||('\u00c9pisode '+episode), videoRef:rel });
        added++;
      });
      toast(added+' \u00e9pisode'+(added>1?'s':'')+' import\u00e9'+(added>1?'s':'')+' !', 'success');
      close(); showSeriesDetail(sid);
    });
  };

  const mkSeriesSection = (container, title, list, onSeeAll=null) => {
    if (!list.length) return;
    const sec = document.createElement('div'); sec.className = 'movie-section';
    sec.innerHTML = `<div class="section-header"><div class="section-title">${esc(title)} <span class="section-count">${list.length} série${list.length>1?'s':''}</span></div>${onSeeAll?`<span class="section-see-all" onclick="${onSeeAll}">Voir tout →</span>`:''}</div><div class="movies-grid"></div>`;
    container.appendChild(sec);
    list.forEach(s => sec.querySelector('.movies-grid').appendChild(mkSeriesCard(s)));
  };

  // ── EN VEDETTE ─────────────────────────────────────────────────────────────────
  // Stockage : tableau de max 8 { type:'movie'|'series', id }
  const FEATURED_KEY = 'myflix_featured';
  let featuredList = (() => {
    try { return JSON.parse(localStorage.getItem(FEATURED_KEY)) || []; } catch(e) { return []; }
  })();
  const saveFeatured = () => {
    localStorage.setItem(FEATURED_KEY, JSON.stringify(featuredList));
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 500);
  };

  // Résoudre un item featured en objet film ou série
  const resolveFeatured = item => {
    if (item.type === 'series') return SeriesManager.getById(item.id);
    return movies.find(m => m.id === item.id);
  };

  // Obtenir la liste résolue (en filtrant les items qui n'existent plus)
  const getFeaturedResolved = () => {
    const resolved = featuredList.map(f => ({ ...f, obj: resolveFeatured(f) })).filter(f => f.obj);
    // Nettoyer les morts du storage
    if (resolved.length !== featuredList.length) {
      featuredList = resolved.map(f => ({ type: f.type, id: f.id }));
      saveFeatured();
    }
    return resolved;
  };

  // Rendre la section "En vedette" dans le container home
  const renderFeaturedSection = (container) => {
    const resolved = getFeaturedResolved();
    if (!resolved.length && !isAdmin()) return;
    const sec = document.createElement('div');
    sec.className = 'movie-section featured-section';
    sec.id = 'featured-section';

    sec.innerHTML = `
      <div class="section-header">
        <div class="section-title">En vedette <span class="section-count">${resolved.length}/8</span></div>
        <span class="section-see-all admin-only" onclick="App.openFeaturedEditor()">Modifier la sélection</span>
      </div>
      <div class="featured-grid" id="featured-grid"></div>`;

    container.appendChild(sec);

    const grid = sec.querySelector('#featured-grid');

    if (!resolved.length) {
      grid.innerHTML = `<div class="featured-empty" onclick="App.openFeaturedEditor()">
        <svg width="32" height="32"><use href="#ic-plus"/></svg>
        <span>Cliquer pour choisir vos vedettes</span>
      </div>`;
      return;
    }

    resolved.forEach(f => {
      const obj = f.obj;
      const card = f.type === 'series' ? mkSeriesCard(obj) : mkCard(obj);
      grid.appendChild(card);
    });
  };

  // ── ÉDITEUR "EN VEDETTE" ─────────────────────────────────────────────────────────
  let _feditList = []; // copie de travail pendant l'édition
  let _dragSrc = null;

  const openFeaturedEditor = () => {
    _feditList = [...featuredList];
    const overlay = document.createElement('div');
    overlay.className = 'm-overlay open';
    overlay.id = 'modal-featured';
    overlay.style.zIndex = '500';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    _renderFeaturedEditor();
  };

  const _renderFeaturedEditor = () => {
    const overlay = document.getElementById('modal-featured');
    if (!overlay) return;

    const resolved = _feditList.map(f => ({ ...f, obj: resolveFeatured(f) })).filter(f => f.obj);
    const slots = resolved.length;
    const showEmpty = slots < 8;

    overlay.innerHTML = `
      <div class="m-box" style="max-width:560px">
        <div class="m-head">
          <h2>EN VEDETTE <span style="font-family:var(--font-b);font-size:11px;font-weight:400;color:var(--text-3);letter-spacing:0;text-transform:none">${slots}/8</span></h2>
          <div class="m-close" id="featured-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body">
          <p style="color:var(--text-3);font-size:12px;margin-bottom:1rem;line-height:1.5">
            Jusqu'à 8 films ou séries. <strong style="color:var(--text-2)">Glisse-dépose</strong> pour réordonner.
          </p>
          <div class="fedit-covers" id="fedit-covers"></div>
          <div style="display:flex;gap:.6rem;margin-top:1.2rem">
            <button id="fedit-cancel" style="background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text-2);border-radius:var(--r);padding:.65rem 1rem;font-family:var(--font-b);font-size:12px;cursor:pointer;flex-shrink:0">Annuler</button>
            <button class="btn-submit" id="fedit-save" style="flex:1;margin:0">Enregistrer</button>
          </div>
        </div>
      </div>`;

    const coversEl = overlay.querySelector('#fedit-covers');

    // Construire les 8 slots (4×2), toujours 8 cases
    for (let i = 0; i < 8; i++) {
      const f = resolved[i];
      const slot = document.createElement('div');
      slot.className = 'fedit-cover' + (f ? ' filled' : ' fedit-cover-empty');
      slot.dataset.idx = i;

      if (f) {
        const obj = f.obj;
        const ps = posterSrc(obj) || backdropSrc(obj);
        slot.draggable = true;
        slot.innerHTML = `
          <div class="fedit-cover-img" style="${ps ? `background-image:url(${esc(ps)})` : ''}">
            ${!ps ? `<svg width="20" height="20"><use href="#ic-film"/></svg>` : ''}
          </div>
          <button class="fedit-cover-remove" onclick="App._feRemove(${i})" title="Retirer">×</button>`;
      } else if (i === slots) {
        // Premier slot vide = bouton ajouter
        slot.classList.add('fedit-cover-add');
        slot.innerHTML = `<svg width="20" height="20"><use href="#ic-plus"/></svg><span>Ajouter</span>`;
        slot.addEventListener('click', () => _fePickSlot(slots));
      }
      // Les slots vides après le bouton ajouter restent vides/grisés

      coversEl.appendChild(slot);
    }

    // ── Drag & drop avec barre rouge en position fixe ────────────────────────
    let _insertIdx = null;

    const getFilledCards = () => [...coversEl.querySelectorAll('.fedit-cover.filled')];

    // Barre rouge en position:fixed — ne perturbe pas la grille
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;width:4px;border-radius:3px;background:var(--accent);box-shadow:0 0 10px rgba(var(--accent-rgb),.9);pointer-events:none;display:none;z-index:9999';
    document.body.appendChild(bar);

    const hideBar = () => { bar.style.display = 'none'; _insertIdx = null; };

    const updateBar = (e) => {
      const cards = getFilledCards();
      if (!cards.length) { hideBar(); return; }

      // Trouver la carte la plus proche sur la même rangée que la souris
      // On cherche la meilleure position d'insertion
      let bestInsert = cards.length;
      let bestLeft = null, bestTop = null, bestH = null;

      // Filtrer les cartes sur la rangée de la souris
      const rowCards = cards.filter(c => {
        const r = c.getBoundingClientRect();
        return e.clientY >= r.top - 10 && e.clientY <= r.bottom + 10;
      });

      const workCards = rowCards.length ? rowCards : cards;

      for (let i = 0; i < workCards.length; i++) {
        const r = workCards[i].getBoundingClientRect();
        const mid = r.left + r.width / 2;
        const globalIdx = parseInt(workCards[i].dataset.idx);
        if (e.clientX <= mid) {
          bestInsert = globalIdx;
          bestLeft = r.left - 5;
          bestTop = r.top;
          bestH = r.height;
          break;
        } else {
          bestInsert = globalIdx + 1;
          bestLeft = r.right + 1;
          bestTop = r.top;
          bestH = r.height;
        }
      }

      if (bestInsert === _dragSrc || bestInsert === _dragSrc + 1 || bestLeft === null) {
        hideBar(); return;
      }

      _insertIdx = bestInsert;
      bar.style.display = 'block';
      bar.style.left   = bestLeft + 'px';
      bar.style.top    = bestTop + 'px';
      bar.style.height = bestH + 'px';
    };

    coversEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      updateBar(e);
    });
    coversEl.addEventListener('dragleave', e => {
      if (!coversEl.contains(e.relatedTarget)) hideBar();
    });
    coversEl.addEventListener('drop', e => {
      e.preventDefault();
      const insertAt = _insertIdx;
      hideBar();
      if (_dragSrc === null || insertAt === null) return;
      if (insertAt === _dragSrc || insertAt === _dragSrc + 1) return;
      const item = _feditList[_dragSrc];
      if (!item) return;
      _feditList.splice(_dragSrc, 1);
      const newIdx = insertAt > _dragSrc ? insertAt - 1 : insertAt;
      _feditList.splice(newIdx, 0, item);
      _dragSrc = null;
      bar.remove();
      _renderFeaturedEditor();
    });

    getFilledCards().forEach(card => {
      card.addEventListener('dragstart', e => {
        _dragSrc = parseInt(card.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        hideBar();
      });
    });

    overlay.querySelector('#featured-close').addEventListener('click', _closeFeaturedEditor);
    overlay.querySelector('#fedit-cancel').addEventListener('click', _closeFeaturedEditor);
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeFeaturedEditor(); });
    overlay.querySelector('#fedit-save').addEventListener('click', () => {
      featuredList = [..._feditList];
      saveFeatured();
      _closeFeaturedEditor();
      goHome();
      toast('Sélection enregistrée !', 'success');
    });
  };

  const _closeFeaturedEditor = () => {
    const ov = document.getElementById('modal-featured');
    if (ov) { ov.remove(); document.body.style.overflow = ''; }
    // Nettoyer la barre si elle traîne
    document.getElementById('fe-indicator') && document.getElementById('fe-indicator').remove();
    document.querySelectorAll('div[style*="position:fixed"][style*="#e50914"]').forEach(el => el.remove());
  };

  // Slot picker — choisir un film ou série pour un slot
  const _fePickSlot = (slotIdx) => {
    // Construire une liste de tous les films + séries disponibles
    const allItems = [
      ...movies.map(m => ({ type:'movie', id:m.id, obj:m })),
      ...SeriesManager.getAll().map(s => ({ type:'series', id:s.id, obj:s }))
    ];
    const already = new Set(_feditList.map(f => f.type + ':' + f.id));

    const overlay2 = document.createElement('div');
    overlay2.className = 'm-overlay open';
    overlay2.id = 'modal-fe-pick';
    overlay2.style.zIndex = '600';
    overlay2.innerHTML = `
      <div class="m-box" style="max-width:500px">
        <div class="m-head">
          <h2>CHOISIR POUR LE SLOT ${slotIdx + 1}</h2>
          <div class="m-close" id="fepick-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body" style="padding-top:.8rem">
          <div style="position:relative;margin-bottom:.8rem">
            <svg width="13" height="13" style="position:absolute;left:.8rem;top:50%;transform:translateY(-50%);color:var(--text-3)"><use href="#ic-search"/></svg>
            <input type="text" id="fepick-search" placeholder="Rechercher…" autocomplete="off"
              style="width:100%;padding:.6rem .8rem .6rem 2.1rem;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:var(--r);color:#fff;font-family:var(--font-b);font-size:13px;box-sizing:border-box">
          </div>
          <div id="fepick-list" style="max-height:380px;overflow-y:auto;display:flex;flex-direction:column;gap:.35rem"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay2);

    const renderPickList = (query) => {
      const list = overlay2.querySelector('#fepick-list');
      list.innerHTML = '';
      const filtered = allItems.filter(f =>
        (!query || f.obj.title.toLowerCase().includes(query.toLowerCase()))
      );
      if (!filtered.length) {
        list.innerHTML = `<div style="color:var(--text-3);font-size:13px;text-align:center;padding:1.5rem">Aucun résultat</div>`;
        return;
      }
      filtered.forEach(f => {
        const ps = posterSrc(f.obj) || backdropSrc(f.obj);
        const isUsed = already.has(f.type + ':' + f.id);
        const item = document.createElement('div');
        item.className = 'fp-item';
        item.style.opacity = isUsed ? '.45' : '1';
        item.innerHTML = `
          <div class="fedit-pick-thumb" style="${ps ? `background-image:url(${esc(ps)})` : ''}">
            ${!ps ? `<svg width="14" height="14"><use href="#ic-film"/></svg>` : ''}
          </div>
          <div class="fp-item-info">
            <div class="fp-item-name">${esc(f.obj.title)}</div>
            <div class="fp-item-meta">${f.type === 'series' ? (f.obj.section === 'anime' ? 'Anime' : 'Série') : 'Film'}${f.obj.year ? ' · ' + f.obj.year : ''}${isUsed ? ' · <span style="color:#4caf50">Déjà en vedette</span>' : ''}</div>
          </div>
          ${!isUsed ? `<button class="fp-item-btn" style="flex-shrink:0">Choisir</button>` : ''}`;
        if (!isUsed) {
          item.querySelector('.fp-item-btn').addEventListener('click', () => {
            // Remplir le slot
            while (_feditList.length <= slotIdx) _feditList.push(null);
            _feditList[slotIdx] = { type: f.type, id: f.id };
            // Nettoyer les nulls
            _feditList = _feditList.filter(Boolean);
            overlay2.remove();
            _renderFeaturedEditor();
          });
        }
        list.appendChild(item);
      });
    };
    renderPickList('');
    overlay2.querySelector('#fepick-search').addEventListener('input', e => renderPickList(e.target.value));
    const closeP = () => overlay2.remove();
    overlay2.querySelector('#fepick-close').addEventListener('click', closeP);
    overlay2.addEventListener('click', e => { if (e.target === overlay2) closeP(); });
  };

  // Retirer un slot
  const _feRemove = (idx) => {
    _feditList.splice(idx, 1);
    _renderFeaturedEditor();
  };

  // ── FIN DRAG & DROP (géré dans _renderFeaturedEditor) ──────────────────────

  const goHome=()=>{
    window.scrollTo({ top:0, behavior:'instant' });
    const nb=document.getElementById('navbar'); if(nb) nb.style.display='';
    const mc=$('main-content'); if(mc) mc.style.padding='';
    page='home'; pageParam=null; pageSection=null; searchQ=''; $('nav-search-input').value='';
    $$('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.section==='home'));
    document.body.classList.add('page-home');
    const c=$('main-content'); c.innerHTML='';

    const allSeries = SeriesManager.getAll();
    const totalContent = movies.length + allSeries.length;

    if(!totalContent){
      stopHero();
      c.innerHTML=`<div class="empty-state"><svg width="56" height="56"><use href="#ic-film"/></svg><h3>MÉDIATHÈQUE VIDE</h3><p>Clique sur Ajouter pour commencer.</p><div class="empty-actions"><button class="nav-btn nav-btn-primary" onclick="App.openFilePicker('film')">${svg('ic-plus')} Ajouter</button></div></div>`;
      return;
    }

    // Hero : utiliser la liste "En vedette" si remplie, sinon fallback automatique
    const featuredResolved = getFeaturedResolved().map(f=>f.obj).filter(obj=>backdropSrc(obj)||posterSrc(obj));
    const heroItems = featuredResolved.length
      ? featuredResolved
      : [...movies.filter(m=>m.backdrop||m.poster), ...allSeries.filter(s=>s.backdrop||s.poster)].slice(0,8);
    if(heroItems.length){
      $('hero').style.display='flex';
      heroPool = heroItems;
      heroIdx = 0;
      setHeroSlide(heroPool[0]);
      buildHeroProgress();
      if(heroPool.length > 1) startFill();
    } else stopHero();

    // Section "En vedette"
    renderFeaturedSection(c);

    // Continuer à regarder
    const inProg = getInProgress();
    if (inProg.length) {
      const sec = document.createElement('div'); sec.className = 'movie-section';
      sec.innerHTML = `<div class="section-header"><div class="section-title">Continuer à regarder <span class="section-count">${inProg.length}</span></div></div><div class="movies-grid" id="continue-grid"></div>`;
      c.appendChild(sec);
      const grid = sec.querySelector('#continue-grid');
      // Dédupliquer les séries (ne montrer que la progression la plus récente par série)
      const seen = new Set();
      inProg.forEach(item => {
        if (item.type === 'movie') {
          grid.appendChild(mkCard(item.obj));
        } else {
          const sid = item.series.id;
          if (seen.has(sid)) return;
          seen.add(sid);
          // Carte série avec badge épisode en cours
          const ep = item.obj; const s = item.series; const prog = item.prog;
          const ps = posterSrc(s) || backdropSrc(s);
          const logoSrc = logoSrcF(s);
          const progPct = Math.round(prog.ts / prog.duration * 100);
          const div = document.createElement('div'); div.className = 'movie-card';
          div.innerHTML = `
            <div class="mc-bg" style="${ps?`background-image:url(${ps})`:'display:none'}"></div>
            <div class="mc-bg-empty" style="${ps?'display:none':''}"><svg><use href="#ic-film"/></svg></div>
            <div class="mc-overlay-top"></div>
            <div class="mc-badge">SÉRIE</div>
            <div class="mc-hover-overlay" onclick="App.showSeriesDetail('${sid}')">
              ${logoSrc ? `<img class="mc-logo" src="${esc(logoSrc)}" alt="${esc(s.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">` : ''}
              <div class="mc-title" style="${logoSrc?'display:none':''}">${esc(s.title)}</div>
              <div class="mc-meta">
                ${s.year?`<span class="mc-year">${esc(s.year)}</span>`:''}
              </div>
              ${s.description?`<div class="mc-desc">${esc(s.description.slice(0,100))}</div>`:''}
            </div>`;
          grid.appendChild(div);
        }
      });
    }

    // Récents films (non-anime)
    const allRecentFilms = [...movies].filter(m=>!m.isAnime && m.section!=='anime' && m.section!=='animation').sort((a,b)=>b.addedAt-a.addedAt);
    if(allRecentFilms.length) {
      // Construire la section sans limite pour l'instant
      const secRecent = document.createElement('div'); secRecent.className='movie-section';
      secRecent.innerHTML=`<div class="section-header"><div class="section-title">Films récents <span class="section-count" id="recent-count"></span></div><span class="section-see-all" onclick="App.goSection('films')">Voir tout →</span></div><div class="movies-grid" id="recent-films-grid"></div>`;
      c.appendChild(secRecent);

      const _buildRecentGrid = () => {
        const grid = document.getElementById('recent-films-grid');
        if (!grid) return;
        const gridW = grid.clientWidth || grid.offsetWidth;
        const minW = 185, gap = 19; // minmax(185px,1fr) + gap:1.2rem≈19px
        const cols = Math.max(1, Math.floor((gridW + gap) / (minW + gap)));
        const count = cols * 2;
        const slice = allRecentFilms.slice(0, count);
        grid.innerHTML = '';
        slice.forEach(m => grid.appendChild(mkCard(m)));
        const countEl = document.getElementById('recent-count');
        if (countEl) countEl.textContent = allRecentFilms.length + ' film' + (allRecentFilms.length>1?'s':'');
      };

      // Premier rendu après layout
      requestAnimationFrame(() => { requestAnimationFrame(_buildRecentGrid); });

      // Recalcul si la fenêtre est redimensionnée
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => _buildRecentGrid());
        ro.observe(document.getElementById('recent-films-grid') || secRecent);
      } else {
        window.addEventListener('resize', _buildRecentGrid);
      }
    }

    // Séries (non-anime)
    const seriesAll = SeriesManager.getBySection('series');
    if(seriesAll.length) mkSeriesSection(c,'Séries',seriesAll.slice(0,8),`App.goSection('series')`);

    // Anime (films + séries mélangés)
    const animeMovies = movies.filter(m=>m.isAnime || m.section==='anime');
    const animeSeries = SeriesManager.getAll().filter(s=>s.section==='anime');
    if(animeMovies.length || animeSeries.length) {
      const sec = document.createElement('div'); sec.className='movie-section';
      const total = animeMovies.length + animeSeries.length;
      sec.innerHTML=`<div class="section-header"><div class="section-title">Anime <span class="section-count">${total}</span></div><span class="section-see-all" onclick="App.goSection('anime')">Voir tout</span></div><div class="movies-grid"></div>`;
      const grid = sec.querySelector('.movies-grid');
      // Mélanger films et séries dans l'ordre d'ajout
      const allAnime = [
        ...animeMovies.map(m=>({type:'movie',obj:m,addedAt:m.addedAt})),
        ...animeSeries.map(s=>({type:'series',obj:s,addedAt:s.addedAt}))
      ].sort((a,b)=>b.addedAt-a.addedAt).slice(0,8);
      allAnime.forEach(item => grid.appendChild(item.type==='movie' ? mkCard(item.obj) : mkSeriesCard(item.obj)));
      c.appendChild(sec);
    }

    // Animation (films + séries d'animation non-japonaise)
    const animationMovies = movies.filter(m => m.section === 'animation');
    const animationSeries = SeriesManager.getAll().filter(s => s.section === 'animation');
    if (animationMovies.length || animationSeries.length) {
      const sec = document.createElement('div'); sec.className = 'movie-section';
      const total = animationMovies.length + animationSeries.length;
      sec.innerHTML = `<div class="section-header"><div class="section-title">Animation <span class="section-count">${total}</span></div><span class="section-see-all" onclick="App.goSection('animation')">Voir tout</span></div><div class="movies-grid"></div>`;
      const grid = sec.querySelector('.movies-grid');
      const allAnim = [
        ...animationMovies.map(m => ({ type:'movie', obj:m, addedAt:m.addedAt })),
        ...animationSeries.map(s => ({ type:'series', obj:s, addedAt:s.addedAt }))
      ].sort((a,b) => b.addedAt - a.addedAt).slice(0, 8);
      allAnim.forEach(item => grid.appendChild(item.type === 'movie' ? mkCard(item.obj) : mkSeriesCard(item.obj)));
      c.appendChild(sec);
    }

    // Custom cats
    customCats.filter(cat=>cat.section==='all').forEach(cat=>{
      const list=movies.filter(m=>(m.customCats||[]).includes(cat.id));
      if(list.length) mkSection(c,cat.name,list.slice(0,8),`App.goCustomCat('${cat.id}')`);
    });
  };

  const goSection=sec=>{
    window.scrollTo({ top:0, behavior:'instant' });
    page=sec; pageParam=null; pageSection=sec; searchQ=''; $('nav-search-input').value='';
    $$('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.section===sec));
    document.body.classList.remove('page-home');
    stopHero();
    const c=$('main-content'); c.innerHTML='';
    const label=sec==='films'?'Films':sec==='series'?'Séries':sec==='animation'?'Animation':'Anime';

    // Onglet Anime : tous les contenus marqués anime (films + séries), quel que soit leur type
    // Onglets Films/Séries : exclure les anime
    let sectionMovies, seriesList;
    if (sec === 'anime') {
      sectionMovies = movies.filter(m => m.isAnime || m.section==='anime');
      seriesList    = SeriesManager.getAll().filter(s => s.section==='anime');
    } else if (sec === 'animation') {
      sectionMovies = movies.filter(m => m.section==='animation');
      seriesList    = SeriesManager.getAll().filter(s => s.section==='animation');
    } else if (sec === 'series') {
      sectionMovies = movies.filter(m => m.section==='series' && !m.isAnime);
      seriesList    = SeriesManager.getBySection('series');
    } else { // films
      sectionMovies = movies.filter(m => m.section==='films' && !m.isAnime);
      seriesList    = [];
    }
    const totalCount=sectionMovies.length+seriesList.length;

    const wrap=document.createElement('div'); wrap.className='section-page';
    wrap.innerHTML=`<div class="section-page-header"><h1>${label}</h1><p>${totalCount} titre${totalCount>1?'s':''}</p></div>`;
    c.appendChild(wrap);

    // État vide
    if(!totalCount){
      wrap.appendChild(Object.assign(document.createElement('div'),{
        innerHTML:`<div class="empty-state"><svg width="56" height="56"><use href="#ic-film"/></svg><h3>AUCUN TITRE</h3><p>Ajoutez des ${label.toLowerCase()} pour les voir ici.</p><div class="empty-actions"><button class="nav-btn nav-btn-primary" onclick="App.openFilePicker('film')">${svg('ic-plus')} Ajouter</button></div></div>`
      }));
      return;
    }

    // ── 0. COLLECTIONS (uniquement pour Films) ───────────────────────
    if (sec === 'films') renderCollectionsSection(wrap);

    // ── 1. SLIDER DE GENRES ────────────────────────────────────────────────
    const genres=sec==='anime'?GENRES_ANIME:sec==='animation'?GENRES_ANIMATION:sec==='series'?GENRES_SERIES:GENRES_FILMS;
    const byGenre={};
    sectionMovies.forEach(m=>{(m.genres||['Autre']).forEach(g=>{if(!byGenre[g])byGenre[g]=[];byGenre[g].push(m);});});
    const byGenreSeries={};
    seriesList.forEach(s=>{(s.genres||['Autre']).forEach(g=>{if(!byGenreSeries[g])byGenreSeries[g]=[];byGenreSeries[g].push(s);});});
    const genresWithContent=genres.filter(g=>(byGenre[g]?.length)||(byGenreSeries[g]?.length));

    if(genresWithContent.length){
      const genreSec=document.createElement('div'); genreSec.className='genre-section';
      genreSec.innerHTML=`
        <div class="genre-section-header">
          <div class="genre-section-title">Par genre</div>
        </div>
        <div class="genre-slider-wrap">
          <div class="genre-arrow genre-arrow-left hidden" id="garrow-left-${sec}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </div>
          <div class="genre-grid" id="genre-grid-${sec}"></div>
          <div class="genre-arrow genre-arrow-right" id="garrow-right-${sec}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>`;
      wrap.appendChild(genreSec);
      const grid=genreSec.querySelector('.genre-grid');
      genresWithContent.forEach(g=>{
        const combined=[...(byGenre[g]||[]),...(byGenreSeries[g]||[])];
        grid.appendChild(mkGenreCard(g,combined,sec));
      });
      // Flèches
      const arrowL=$(`garrow-left-${sec}`), arrowR=$(`garrow-right-${sec}`);
      const SCROLL=700;
      const upd=()=>{ arrowL&&arrowL.classList.toggle('hidden',grid.scrollLeft<=10); arrowR&&arrowR.classList.toggle('hidden',grid.scrollLeft+grid.clientWidth>=grid.scrollWidth-10); };
      arrowL&&arrowL.addEventListener('click',()=>{grid.scrollBy({left:-SCROLL,behavior:'smooth'});setTimeout(upd,400);});
      arrowR&&arrowR.addEventListener('click',()=>{grid.scrollBy({left:SCROLL,behavior:'smooth'});setTimeout(upd,400);});
      grid.addEventListener('scroll',upd,{passive:true});
      setTimeout(upd,50);
    }

    // ── 2. CATÉGORIES CUSTOM ──────────────────────────────────────────────
    customCats.filter(cat=>cat.section===sec||cat.section==='all').forEach(cat=>{
      const list=sectionMovies.filter(m=>(m.customCats||[]).includes(cat.id));
      if(!list.length) return;
      const s=document.createElement('div'); s.className='custom-section';
      s.innerHTML=`<div class="custom-section-header"><div class="custom-section-title">${svg('ic-folder')} ${esc(cat.name)} <span class="section-count">${list.length}</span></div><span class="custom-section-del" onclick="App.deleteCustomCat('${cat.id}')">Supprimer</span></div><div class="movies-grid"></div>`;
      list.forEach(m=>s.querySelector('.movies-grid').appendChild(mkCard(m)));
      wrap.appendChild(s);
    });

    // ── 3. TOUT LE CONTENU avec TRI ──────────────────────────────────────────
    const SORT_KEY = `myflix_sort_${sec}`;
    let currentSort = localStorage.getItem(SORT_KEY) || 'added';

    const sortOptions = [
      { key:'added',   label:'Récents' },
      { key:'alpha',   label:'A → Z' },
      { key:'year',    label:'Année' },
      { key:'rating',  label:'Note' },
    ];

    const getAllItems = () => {
      if (sec === 'anime') {
        return [
          ...sectionMovies.map(m=>({type:'movie', obj:m})),
          ...seriesList.map(s=>({type:'series', obj:s}))
        ];
      } else if (sec === 'series') {
        return [
          ...seriesList.map(s=>({type:'series', obj:s})),
          ...sectionMovies.map(m=>({type:'movie', obj:m}))
        ];
      } else {
        return sectionMovies.map(m=>({type:'movie', obj:m}));
      }
    };

    const sortItems = (items, sort) => {
      const arr = [...items];
      if (sort === 'alpha')  return arr.sort((a,b)=>a.obj.title.localeCompare(b.obj.title));
      if (sort === 'year')   return arr.sort((a,b)=>(parseInt(b.obj.year)||0)-(parseInt(a.obj.year)||0));
      if (sort === 'rating') return arr.sort((a,b)=>(parseFloat(b.obj.rating)||0)-(parseFloat(a.obj.rating)||0));
      // 'added' : par date d'ajout décroissante
      return arr.sort((a,b)=>(b.obj.addedAt||0)-(a.obj.addedAt||0));
    };

    const allItems = getAllItems();
    const sectionLabel2 = sec==='anime'?'Tous les anime':sec==='series'?'Tous les titres':'Tous les films';

    if (allItems.length) {
      const contentSec = document.createElement('div'); contentSec.className='movie-section';
      contentSec.id = `sort-section-${sec}`;
      contentSec.innerHTML = `
        <div class="section-header" style="align-items:center">
          <div class="section-title">${sectionLabel2} <span class="section-count">${allItems.length}</span></div>
          <div class="sort-bar" id="sort-bar-${sec}">
            ${sortOptions.map(o=>`
              <button class="sort-btn${currentSort===o.key?' active':''}" onclick="App._setSort('${sec}','${o.key}')">
                ${o.label}
              </button>`).join('')}
          </div>
        </div>
        <div class="movies-grid" id="sort-grid-${sec}"></div>`;
      wrap.appendChild(contentSec);

      const renderGrid = (sort) => {
        const grid = document.getElementById(`sort-grid-${sec}`);
        if (!grid) return;
        grid.innerHTML = '';
        // Mettre à jour les boutons actifs
        document.querySelectorAll(`#sort-bar-${sec} .sort-btn`).forEach(b =>
          b.classList.toggle('active', b.dataset.sort === sort)
        );
        // Rendu par batch pour éviter le lag
        const items = sortItems(allItems, sort);
        const BATCH = 20;
        let i = 0;
        const renderBatch = () => {
          const frag = document.createDocumentFragment();
          const end = Math.min(i + BATCH, items.length);
          for (; i < end; i++) {
            const item = items[i];
            frag.appendChild(item.type==='movie' ? mkCard(item.obj) : mkSeriesCard(item.obj));
          }
          grid.appendChild(frag);
          if (i < items.length) {
            requestAnimationFrame(renderBatch);
          } else {
            // Toutes les cartes rendues — précharger les images restantes en arrière-plan
            items.forEach(item => {
              const src = item.type === 'movie'
                ? (posterSrc(item.obj) || backdropSrc(item.obj))
                : imgUrl(item.obj.poster);
              if (src) { const img = new Image(); img.src = src; }
            });
          }
        };
        requestAnimationFrame(renderBatch);
      };
      renderGrid(currentSort);

      // Stocker la fonction pour l'appel depuis _setSort
      if (!wrap._sortRenderers) wrap._sortRenderers = {};
      wrap._sortRenderers[sec] = renderGrid;
    }
  };

  const _toggleSortMenu = (sec) => {
    const menu = document.getElementById(`sort-menu-${sec}`);
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    document.querySelectorAll('[id^="sort-menu-"]').forEach(m => m.style.display = 'none');
    if (!isOpen) menu.style.display = 'block';
  };

  const _setSort = (sec, sort) => {
    localStorage.setItem(`myflix_sort_${sec}`, sort);

    // Mettre à jour les boutons actifs sans recharger la page
    document.querySelectorAll(`#sort-bar-${sec} .sort-btn`).forEach(b => {
      const label = b.textContent.trim();
      const sortOptions = [{key:'added',label:'Récents'},{key:'alpha',label:'A → Z'},{key:'year',label:'Année'},{key:'rating',label:'Note'}];
      const match = sortOptions.find(o => o.label === label);
      b.classList.toggle('active', match?.key === sort);
    });

    // Re-rendre uniquement la grille
    const grid = document.getElementById(`sort-grid-${sec}`);
    if (!grid) return;
    grid.innerHTML = '';

    // Récupérer les items selon la section
    let sectionMovies, seriesList;
    if (sec === 'anime') {
      sectionMovies = movies.filter(m => m.isAnime || m.section==='anime');
      seriesList    = SeriesManager.getAll().filter(s => s.section==='anime');
    } else if (sec === 'series') {
      sectionMovies = movies.filter(m => m.section==='series' && !m.isAnime);
      seriesList    = SeriesManager.getBySection('series');
    } else {
      sectionMovies = movies.filter(m => m.section==='films' && !m.isAnime);
      seriesList    = [];
    }

    const allItems = [
      ...sectionMovies.map(m=>({type:'movie', obj:m})),
      ...seriesList.map(s=>({type:'series', obj:s}))
    ];

    const sortFn = sort === 'alpha'  ? (a,b) => a.obj.title.localeCompare(b.obj.title)
                 : sort === 'year'   ? (a,b) => (parseInt(b.obj.year)||0) - (parseInt(a.obj.year)||0)
                 : sort === 'rating' ? (a,b) => (parseFloat(b.obj.rating)||0) - (parseFloat(a.obj.rating)||0)
                 : (a,b) => (b.obj.addedAt||0) - (a.obj.addedAt||0);

    [...allItems].sort(sortFn).forEach(item =>
      grid.appendChild(item.type==='movie' ? mkCard(item.obj) : mkSeriesCard(item.obj))
    );
  };

  // Fermer le menu de tri en cliquant ailleurs
  document.addEventListener('click', e => {
    if (!e.target.closest('[id^="sort-wrap-"]')) {
      document.querySelectorAll('[id^="sort-menu-"]').forEach(m => m.style.display = 'none');
    }
  });

  const goGenre=(genre,section)=>{
    page='genre'; pageParam=genre; pageSection=section;
    stopHero();
    const c=$('main-content'); c.innerHTML='';

    // Pour l'anime : inclure films anime + séries anime avec ce genre
    let movieList, seriesList2=[];
    if (section === 'anime') {
      movieList  = movies.filter(m=>(m.isAnime||m.section==='anime')&&(m.genres||[]).includes(genre));
      seriesList2= SeriesManager.getAll().filter(s=>s.section==='anime'&&(s.genres||[]).includes(genre));
    } else if (section === 'series') {
      movieList  = movies.filter(m=>m.section==='series'&&!m.isAnime&&(m.genres||[]).includes(genre));
      seriesList2= SeriesManager.getBySection('series').filter(s=>(s.genres||[]).includes(genre));
    } else {
      movieList  = movies.filter(m=>m.section==='films'&&!m.isAnime&&(m.genres||[]).includes(genre));
    }

    const totalCount = movieList.length + seriesList2.length;
    const secLabel = section==='films'?'Films':section==='series'?'Séries':'Anime';

    const wrap=document.createElement('div'); wrap.className='genre-page';
    wrap.innerHTML=`
      <div class="genre-page-header">
        <div class="genre-page-back" onclick="App.goSection('${section}')">${svg('ic-chevron-left')}</div>
        <div><h2>${esc(genre)}</h2><p style="color:var(--text-3);font-size:13px">${secLabel} · ${totalCount} titre${totalCount>1?'s':''}</p></div>
      </div>`;
    c.appendChild(wrap);

    if(!totalCount){ wrap.innerHTML+=`<div class="empty-state"><h3>AUCUN TITRE</h3></div>`; return; }

    const grid=document.createElement('div'); grid.className='movies-grid';
    // Tout mélangé trié par titre
    const all = [
      ...movieList.map(m=>({type:'movie',obj:m,title:m.title})),
      ...seriesList2.map(s=>({type:'series',obj:s,title:s.title}))
    ].sort((a,b)=>a.title.localeCompare(b.title));
    all.forEach(item => grid.appendChild(item.type==='movie' ? mkCard(item.obj) : mkSeriesCard(item.obj)));
    wrap.appendChild(grid);
  };

  const goCustomCat=id=>{
    const cat=customCats.find(c=>c.id===id); if(!cat) return;
    page='custom-cat'; pageParam=id; stopHero();
    const c=$('main-content'); c.innerHTML='';
    const list=movies.filter(m=>(m.customCats||[]).includes(id));
    const wrap=document.createElement('div'); wrap.className='genre-page';
    wrap.innerHTML=`<div class="genre-page-header"><div class="genre-page-back" onclick="App.goHome()">${svg('ic-chevron-left')}</div><div><h2>${esc(cat.name)}</h2><p style="color:var(--text-3);font-size:13px">${list.length} titre${list.length>1?'s':''}</p></div></div>`;
    c.appendChild(wrap);
    if(!list.length){ wrap.innerHTML+=`<div class="empty-state"><h3>AUCUN TITRE</h3></div>`; return; }
    const grid=document.createElement('div'); grid.className='movies-grid';
    list.forEach(m=>grid.appendChild(mkCard(m))); wrap.appendChild(grid);
  };

  // Version générique de crop avec ratio paramétrable
  const openPhotoCropRatio = (currentVal, prevCrop, aspectRatio, onConfirm) => {
    const existing = document.getElementById('dir-crop-modal');
    if (existing) existing.remove();
    const m = document.createElement('div');
    m.id = 'dir-crop-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);backdrop-filter:blur(12px)';

    // Dimensions de prévisualisation selon ratio
    const isWide = aspectRatio > 1;
    const isSquare = Math.abs(aspectRatio - 1) < 0.05;
    const vpStyle = isWide
      ? 'width:100%;'
      : isSquare
        ? 'width:55%;margin:0 auto;'
        : 'width:52%;margin:0 auto;';

    m.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:20px;width:88%;max-width:440px;padding:1.4rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem">
          <h3 style="font-family:var(--font-h);font-size:14px;color:#fff;letter-spacing:.06em;margin:0">RECADRER</h3>
          <button id="crop-close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:18px;line-height:1">✕</button>
        </div>
        <div id="crop-outer" style="position:relative;${vpStyle}overflow:hidden;border-radius:10px;background:#000;cursor:grab;touch-action:none;user-select:none">
          <img id="crop-img-bg" src="${imgUrl(currentVal)}" style="position:absolute;transform-origin:0 0;will-change:transform;pointer-events:none;max-width:none;opacity:.35;filter:blur(1px)">
          <div id="crop-frame-clip" style="position:absolute;overflow:hidden;border-radius:4px;pointer-events:none">
            <img id="crop-img" src="${imgUrl(currentVal)}" style="position:absolute;transform-origin:0 0;will-change:transform;pointer-events:none;max-width:none">
          </div>
          <div id="crop-frame-border" style="position:absolute;border:2px solid rgba(255,255,255,.85);border-radius:4px;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></div>
          <div id="crop-grid" style="position:absolute;pointer-events:none;opacity:.18">
            <div style="position:absolute;left:33.3%;top:0;bottom:0;width:1px;background:#fff"></div>
            <div style="position:absolute;left:66.6%;top:0;bottom:0;width:1px;background:#fff"></div>
            <div style="position:absolute;top:33.3%;left:0;right:0;height:1px;background:#fff"></div>
            <div style="position:absolute;top:66.6%;left:0;right:0;height:1px;background:#fff"></div>
          </div>
        </div>
        <div style="margin-top:.85rem">
          <label style="font-family:var(--font-b);font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.1em;text-transform:uppercase">Zoom</label>
          <input type="range" id="crop-zoom" min="100" max="400" value="100" style="width:100%;margin-top:.3rem;accent-color:var(--accent);cursor:pointer">
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.9rem">
          <button id="crop-cancel" style="flex:1;padding:.55rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);border-radius:8px;font-family:var(--font-b);font-size:12px;cursor:pointer">Annuler</button>
          <button id="crop-confirm" style="flex:2;padding:.55rem;background:var(--accent);border:none;color:#fff;border-radius:8px;font-family:var(--font-b);font-size:12px;font-weight:700;cursor:pointer">Confirmer</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    const outer   = m.querySelector('#crop-outer');
    const imgBg   = m.querySelector('#crop-img-bg');
    const imgFg   = m.querySelector('#crop-img');
    const clip    = m.querySelector('#crop-frame-clip');
    const border  = m.querySelector('#crop-frame-border');
    const grid    = m.querySelector('#crop-grid');
    const zoomInp = m.querySelector('#crop-zoom');
    const FRAME_RATIO = aspectRatio; // w/h
    let tx=0,ty=0,zoom=1,natW=1,natH=1;
    let frameW=0,frameH=0,frameX=0,frameY=0,outerW=0,outerH=0;
    let dragging=false,startX,startY,startTx,startTy;

    const applyTransform = () => {
      const t = `translate(${tx}px,${ty}px) scale(${zoom})`;
      imgBg.style.transform = t;
      imgFg.style.transform = `translate(${tx-frameX}px,${ty-frameY}px) scale(${zoom})`;
    };

    const clampPos = () => {
      const iW=natW*zoom, iH=natH*zoom;
      tx = Math.min(frameX, Math.max(frameX+frameW-iW, tx));
      ty = Math.min(frameY, Math.max(frameY+frameH-iH, ty));
    };

    const setupLayout = () => {
      outerW = outer.offsetWidth;
      // outer height = frame height + 20% de marge
      frameW = Math.round(outerW * (FRAME_RATIO >= 1 ? 0.82 : 0.72));
      frameH = Math.round(frameW / FRAME_RATIO);
      outerH = Math.round(frameH * 1.18);
      outer.style.height = outerH + 'px';
      frameX = Math.round((outerW - frameW) / 2);
      frameY = Math.round((outerH - frameH) / 2);

      clip.style.cssText   += `;left:${frameX}px;top:${frameY}px;width:${frameW}px;height:${frameH}px`;
      border.style.cssText += `;left:${frameX}px;top:${frameY}px;width:${frameW}px;height:${frameH}px`;
      grid.style.cssText   += `;left:${frameX}px;top:${frameY}px;width:${frameW}px;height:${frameH}px`;

      const initZoom = Math.max(frameW/natW, frameH/natH);
      zoom = initZoom;
      tx = frameX + (frameW - natW*zoom)/2;
      ty = frameY + (frameH - natH*zoom)/2;

      if (prevCrop) {
        zoom = prevCrop.zoom || initZoom;
        tx = prevCrop.tx_abs !== undefined ? prevCrop.tx_abs : tx;
        ty = prevCrop.ty_abs !== undefined ? prevCrop.ty_abs : ty;
      }
      zoomInp.min   = Math.round(initZoom*100);
      zoomInp.max   = Math.round(initZoom*400);
      zoomInp.value = Math.round(zoom*100);
      clampPos(); applyTransform();
    };

    let loadCount = 0;
    const onLoad = () => { if(++loadCount<2) return; natW=imgFg.naturalWidth; natH=imgFg.naturalHeight; imgBg.style.width=imgFg.style.width=natW+'px'; setupLayout(); };
    imgFg.onload = imgBg.onload = onLoad;
    if (imgFg.complete) onLoad();
    if (imgBg.complete) onLoad();

    zoomInp.addEventListener('input', () => {
      const nz = parseFloat(zoomInp.value)/100;
      const cx=frameX+frameW/2, cy=frameY+frameH/2;
      tx = cx-(cx-tx)*(nz/zoom); ty = cy-(cy-ty)*(nz/zoom); zoom=nz;
      clampPos(); applyTransform();
    });

    outer.addEventListener('mousedown', e=>{ e.preventDefault(); dragging=true; startX=e.clientX; startY=e.clientY; startTx=tx; startTy=ty; outer.style.cursor='grabbing'; });
    document.addEventListener('mousemove', e=>{ if(!dragging)return; tx=startTx+(e.clientX-startX); ty=startTy+(e.clientY-startY); clampPos(); applyTransform(); });
    document.addEventListener('mouseup', ()=>{ dragging=false; outer.style.cursor='grab'; });
    outer.addEventListener('touchstart', e=>{ dragging=true; startX=e.touches[0].clientX; startY=e.touches[0].clientY; startTx=tx; startTy=ty; },{passive:true});
    outer.addEventListener('touchmove', e=>{ if(!dragging)return; tx=startTx+(e.touches[0].clientX-startX); ty=startTy+(e.touches[0].clientY-startY); clampPos(); applyTransform(); },{passive:true});
    outer.addEventListener('touchend', ()=>{ dragging=false; });

    m.querySelector('#crop-close').addEventListener('click', ()=>m.remove());
    m.querySelector('#crop-cancel').addEventListener('click', ()=>m.remove());
    m.addEventListener('click', e=>{ if(e.target===m) m.remove(); });

    m.querySelector('#crop-confirm').addEventListener('click', ()=>{
      const denom_x = natW*zoom - frameW, denom_y = natH*zoom - frameH;
      const bgX = denom_x>0 ? (frameX-tx)/(natW*zoom)*100 : 0;
      const bgY = denom_y>0 ? (frameY-ty)/(natH*zoom)*100 : 0;
      const bgW = frameW/(natW*zoom)*100;
      const bgH = frameH/(natH*zoom)*100;
      onConfirm({ bgX, bgY, bgW, bgH, zoom, tx_abs:tx, ty_abs:ty });
      m.remove();
    });
  };



  const goSearchPage = () => {
    page = 'search-page'; pageParam = null; stopHero();
    window.scrollTo({ top: 0, behavior: 'instant' });
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.section === 'search-page'));
    const c = $('main-content'); c.innerHTML = '';

    // ── Données pour les filtres ──
    const allItems = [
      ...movies,
      ...SeriesManager.getAll().map(s => ({ ...s, _isSeries: true }))
    ];

    // Réalisateurs uniques triés
    const directors = [...new Set(
      allItems.map(m => (m.director || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'fr'));

    // Années
    const years = allItems.map(m => parseInt(m.year)).filter(y => y > 1800 && y < 2100).sort((a, b) => a - b);
    const minYear = years[0] || 1900;
    const maxYear = years[years.length - 1] || new Date().getFullYear();

    // Notes
    const ratings = allItems.map(m => parseFloat(m.rating)).filter(r => !isNaN(r) && r > 0);
    const minRating = Math.floor(Math.min(...ratings, 0) * 10) / 10 || 0;
    const maxRating = Math.ceil(Math.max(...ratings, 10) * 10) / 10 || 10;

    // Durées (en minutes)
    const durations = movies.map(m => parseInt(m.duration)).filter(d => d > 0).sort((a, b) => a - b);
    const minDur = durations[0] || 0;
    const maxDur = durations[durations.length - 1] || 300;

    // Genres uniques
    const allGenres = [...new Set(allItems.flatMap(m => m.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));

    const wrap = document.createElement('div');
    wrap.className = 'search-dedicated-page';

    wrap.innerHTML = `
      <div class="search-dedicated-header">
        <h1>Rechercher</h1>
        <div class="search-dedicated-bar">
          <svg width="22" height="22" style="flex-shrink:0;color:var(--text-3)"><use href="#ic-search"/></svg>
          <input type="text" id="search-dedicated-input" placeholder="Titre, genre, réalisateur…" autocomplete="off">
        </div>
      </div>

      <!-- ── Catégories de filtre ── -->
      <div class="sf-categories">
        <button class="sf-cat-btn" data-filter="director">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          <span>Réalisateur</span>
          <div class="sf-cat-count">${directors.length}</div>
        </button>
        <button class="sf-cat-btn" data-filter="year">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Année</span>
          <div class="sf-cat-count">${minYear}–${maxYear}</div>
        </button>
        <button class="sf-cat-btn" data-filter="rating">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span>Note</span>
          <div class="sf-cat-count">1–10</div>
        </button>
        <button class="sf-cat-btn" data-filter="duration">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Durée</span>
          <div class="sf-cat-count">${minDur}–${maxDur} min</div>
        </button>

      </div>

      <!-- ── Panneau de filtre actif ── -->
      <div class="sf-panel" id="sf-panel" style="display:none"></div>

      <!-- ── Résultats ── -->
      <div class="search-dedicated-results" id="search-dedicated-results" style="display:none">
        <div class="search-dedicated-results-header" id="search-dedicated-header"></div>
        <div class="movies-grid" id="search-dedicated-grid"></div>
      </div>`;

    c.appendChild(wrap);

    // ── Panels de filtre ──
    const panel = $('sf-panel');

    // ── Rendu des résultats ──
    const showResults = (items, label) => {
      const res = $('search-dedicated-results');
      const header = $('search-dedicated-header');
      const grid = $('search-dedicated-grid');
      res.style.display = 'block';
      res.querySelector('.req-search-ask')?.remove();
      header.innerHTML = `<span>${items.length} résultat${items.length !== 1 ? 's' : ''}</span>${label ? ` · ${label}` : ''}`;
      grid.innerHTML = '';
      items.forEach(m => {
        if (m._isSeries) {
          const card = mkSeriesCard(m);
          grid.appendChild(card);
        } else {
          grid.appendChild(mkCard(m));
        }
      });
    };

    const hideResults = () => { $('search-dedicated-results').style.display = 'none'; };

    // ── Barre de recherche texte ──
    let st;
    const inp = $('search-dedicated-input');
    inp.addEventListener('input', e => {
      clearTimeout(st);
      st = setTimeout(() => {
        const q = e.target.value.trim();
        // Désactiver les filtres catégorie
        $$('.sf-cat-btn').forEach(b => b.classList.remove('active'));
        $('sf-panel').style.display = 'none';
        if (!q) { hideResults(); return; }
        const res = allItems.filter(m =>
          [m.title, ...(m.genres || []), m.director, m.description]
            .some(f => f && f.toLowerCase().includes(q.toLowerCase()))
        );
        showResults(res, `"${esc(q)}"`);
        if (!isAdmin()) {
          const ask = document.createElement('div');
          ask.className = 'req-search-ask';
          ask.innerHTML = `${res.length ? 'Pas ce que tu cherches ?' : 'Ce titre n\'est pas sur MyFlix.'} <button type="button">Demander « ${esc(q)} »</button>`;
          ask.querySelector('button').addEventListener('click', () => openRequestsPanel(q));
          $('search-dedicated-results').appendChild(ask);
        }
      }, 250);
    });

    // ── Helpers réalisateur ──
    const dirKey = d => d.trim();
    const dirPhoto = d => {
      const info = directorsData[dirKey(d)];
      return (info && info.photo) ? imgUrl(info.photo) : null;
    };
    const dirInitials = d => d.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

    const saveDirectors = () => {
      localStorage.setItem('myflix_directors', JSON.stringify(directorsData));
      _flushSaveNow();
    };

    // Retourne le style CSS background pour un crop sauvegardé
    const cropBgStyle = (photoUrl, cropObj) => {
      if (!photoUrl) return '';
      if (cropObj && cropObj.bgX !== undefined) {
        const denom_x = 100 - cropObj.bgW, denom_y = 100 - cropObj.bgH;
        const px = denom_x > 0 ? cropObj.bgX / denom_x * 100 : 50;
        const py = denom_y > 0 ? cropObj.bgY / denom_y * 100 : 50;
        return `background-image:url(${photoUrl});background-size:${100/cropObj.bgW*100}%;background-position:${px}% ${py}%`;
      }
      return `background-image:url(${photoUrl});background-size:cover;background-position:center top`;
    };

    // ── Recadrage photo (crop UI inline) ──
    const openPhotoCrop = (currentVal, prevCrop, onConfirm) => {
      const existing = document.getElementById('dir-crop-modal');
      if (existing) existing.remove();
      const m = document.createElement('div');
      m.id = 'dir-crop-modal';
      m.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);backdrop-filter:blur(12px)';

      m.innerHTML = `
        <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:20px;width:88%;max-width:440px;padding:1.4rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem">
            <h3 style="font-family:var(--font-h);font-size:15px;color:#fff;letter-spacing:.06em;margin:0">RECADRER LA PHOTO</h3>
            <button id="crop-close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:18px;line-height:1">✕</button>
          </div>

          <!-- Zone de crop : image pleine + masques sombres latéraux + cadre -->
          <div id="crop-outer" style="position:relative;width:100%;overflow:hidden;border-radius:10px;background:#000;cursor:grab;touch-action:none;user-select:none">
            <!-- Image complète, légèrement assombrie hors cadre -->
            <img id="crop-img-bg" src="${imgUrl(currentVal)}"
              style="position:absolute;transform-origin:0 0;will-change:transform;pointer-events:none;max-width:none;opacity:.35;filter:blur(1px)">
            <!-- Image nette dans le cadre (clip) -->
            <div id="crop-frame-clip" style="position:absolute;overflow:hidden;border-radius:6px;pointer-events:none">
              <img id="crop-img" src="${imgUrl(currentVal)}"
                style="position:absolute;transform-origin:0 0;will-change:transform;pointer-events:none;max-width:none">
            </div>
            <!-- Contour du cadre -->
            <div id="crop-frame-border" style="position:absolute;border:2px solid rgba(255,255,255,.85);border-radius:6px;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 20px rgba(0,0,0,.4)"></div>
            <!-- Grille de tiers (optionnel) -->
            <div id="crop-grid" style="position:absolute;pointer-events:none;opacity:.2">
              <div style="position:absolute;left:33.3%;top:0;bottom:0;width:1px;background:#fff"></div>
              <div style="position:absolute;left:66.6%;top:0;bottom:0;width:1px;background:#fff"></div>
              <div style="position:absolute;top:33.3%;left:0;right:0;height:1px;background:#fff"></div>
              <div style="position:absolute;top:66.6%;left:0;right:0;height:1px;background:#fff"></div>
            </div>
          </div>

          <div style="margin-top:.85rem">
            <label style="font-family:var(--font-b);font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.1em;text-transform:uppercase">Zoom</label>
            <input type="range" id="crop-zoom" min="100" max="400" value="100"
              style="width:100%;margin-top:.3rem;accent-color:var(--accent);cursor:pointer">
          </div>
          <div style="display:flex;gap:.5rem;margin-top:.9rem">
            <button id="crop-cancel" style="flex:1;padding:.55rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);border-radius:8px;font-family:var(--font-b);font-size:12px;cursor:pointer">Annuler</button>
            <button id="crop-confirm" style="flex:2;padding:.55rem;background:var(--accent);border:none;color:#fff;border-radius:8px;font-family:var(--font-b);font-size:12px;font-weight:700;cursor:pointer">Confirmer le cadrage</button>
          </div>
        </div>`;
      document.body.appendChild(m);

      const outer    = m.querySelector('#crop-outer');
      const imgBg    = m.querySelector('#crop-img-bg');
      const imgFg    = m.querySelector('#crop-img');
      const clip     = m.querySelector('#crop-frame-clip');
      const border   = m.querySelector('#crop-frame-border');
      const grid     = m.querySelector('#crop-grid');
      const zoomInp  = m.querySelector('#crop-zoom');

      // Le cadre est au ratio 2/3 centré dans le outer
      // outer a une hauteur dynamique basée sur la largeur
      const FRAME_RATIO = 2/3; // largeur/hauteur de la carte
      let tx = 0, ty = 0, zoom = 1, natW = 1, natH = 1;
      let frameW = 0, frameH = 0, frameX = 0, frameY = 0;
      let outerW = 0, outerH = 0;
      let dragging = false, startX, startY, startTx, startTy;

      const applyTransform = () => {
        const t = `translate(${tx}px,${ty}px) scale(${zoom})`;
        imgBg.style.transform = t;
        imgFg.style.transform  = `translate(${tx - frameX}px,${ty - frameY}px) scale(${zoom})`;
      };

      const setupLayout = () => {
        outerW = outer.offsetWidth;
        // outer height = assez grand pour voir image + marges
        outerH = Math.round(outerW * 1.1); // un peu plus haut que le cadre
        outer.style.height = outerH + 'px';

        // Cadre centré dans outer
        frameW = Math.round(outerW * 0.72);
        frameH = Math.round(frameW / FRAME_RATIO);
        frameX = Math.round((outerW - frameW) / 2);
        frameY = Math.round((outerH - frameH) / 2);

        clip.style.left   = frameX + 'px';
        clip.style.top    = frameY + 'px';
        clip.style.width  = frameW + 'px';
        clip.style.height = frameH + 'px';

        border.style.left   = frameX + 'px';
        border.style.top    = frameY + 'px';
        border.style.width  = frameW + 'px';
        border.style.height = frameH + 'px';

        grid.style.left   = frameX + 'px';
        grid.style.top    = frameY + 'px';
        grid.style.width  = frameW + 'px';
        grid.style.height = frameH + 'px';

        // Zoom initial : image couvre le cadre entièrement
        const initZoom = Math.max(frameW / natW, frameH / natH);
        zoom = initZoom;
        // Centrer l'image sur le cadre
        tx = frameX + (frameW - natW * zoom) / 2;
        ty = frameY + (frameH - natH * zoom) / 2;

        // Si crop précédent, le restaurer
        if (prevCrop) {
          zoom = prevCrop.scaleX * natW / natW * initZoom / initZoom; // recalc
          zoom = prevCrop.zoom || initZoom;
          tx = prevCrop.tx_abs || tx;
          ty = prevCrop.ty_abs || ty;
        }

        zoomInp.min   = Math.round(initZoom * 100);
        zoomInp.max   = Math.round(initZoom * 400);
        zoomInp.value = Math.round(zoom * 100);
        clampPos();
        applyTransform();
      };

      const clampPos = () => {
        // L'image doit couvrir le cadre entièrement
        const iW = natW * zoom, iH = natH * zoom;
        const minTx = frameX + frameW - iW;
        const minTy = frameY + frameH - iH;
        const maxTx = frameX;
        const maxTy = frameY;
        tx = Math.min(maxTx, Math.max(minTx, tx));
        ty = Math.min(maxTy, Math.max(minTy, ty));
      };

      imgFg.onload = imgBg.onload = (() => {
        let loaded = 0;
        return () => {
          loaded++;
          if (loaded < 2) return;
          natW = imgFg.naturalWidth;
          natH = imgFg.naturalHeight;
          imgBg.style.width = natW + 'px';
          imgFg.style.width  = natW + 'px';
          setupLayout();
        };
      })();

      zoomInp.addEventListener('input', () => {
        const newZoom = parseFloat(zoomInp.value) / 100;
        // Zoomer centré sur le centre du cadre
        const cx = frameX + frameW / 2;
        const cy = frameY + frameH / 2;
        tx = cx - (cx - tx) * (newZoom / zoom);
        ty = cy - (cy - ty) * (newZoom / zoom);
        zoom = newZoom;
        clampPos();
        applyTransform();
      });

      outer.addEventListener('mousedown', e => {
        e.preventDefault();
        dragging = true; startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty;
        outer.style.cursor = 'grabbing';
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        tx = startTx + (e.clientX - startX);
        ty = startTy + (e.clientY - startY);
        clampPos(); applyTransform();
      });
      document.addEventListener('mouseup', () => { dragging = false; outer.style.cursor = 'grab'; });

      outer.addEventListener('touchstart', e => {
        dragging = true;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        startTx = tx; startTy = ty;
      }, { passive: true });
      outer.addEventListener('touchmove', e => {
        if (!dragging) return;
        tx = startTx + (e.touches[0].clientX - startX);
        ty = startTy + (e.touches[0].clientY - startY);
        clampPos(); applyTransform();
      }, { passive: true });
      outer.addEventListener('touchend', () => { dragging = false; });

      m.querySelector('#crop-close').addEventListener('click',  () => m.remove());
      m.querySelector('#crop-cancel').addEventListener('click', () => m.remove());
      m.addEventListener('click', e => { if (e.target === m) m.remove(); });

      m.querySelector('#crop-confirm').addEventListener('click', () => {
        // Sauvegarder en % de l'image naturelle → rendu reproductible
        const cropX_pct = (frameX - tx) / (natW * zoom) * 100;  // % depuis gauche image
        const cropY_pct = (frameY - ty) / (natH * zoom) * 100;  // % depuis haut image
        const cropW_pct = frameW / (natW * zoom) * 100;          // % largeur de l'image
        const cropH_pct = frameH / (natH * zoom) * 100;          // % hauteur de l'image
        onConfirm({
          // Pour CSS background-position + background-size
          bgX: cropX_pct, bgY: cropY_pct,
          bgW: cropW_pct, bgH: cropH_pct,
          // Pour restauration
          zoom, tx_abs: tx, ty_abs: ty,
        });
        m.remove();
      });
    };

        // ── Grille réalisateurs ──
    let dirSort = 'alpha';  // 'alpha' | 'nationality' | 'count' | 'rating'
    let dirSearch = '';
    let dirNatFilter = ''; // filtre par nationalité

    const renderDirectorPanel = () => {
      const getFilteredDirs = () => {
        let list = [...directors];
        if (dirSearch) list = list.filter(d => d.toLowerCase().includes(dirSearch.toLowerCase()));
        // Filtre par nationalité
        if (dirNatFilter) list = list.filter(d => {
          const nat = (directorsData[dirKey(d)]?.nationality || '').toLowerCase().trim();
          return nat === dirNatFilter.toLowerCase().trim();
        });
        if (dirSort === 'alpha') list.sort((a,b) => a.localeCompare(b,'fr'));
        else if (dirSort === 'nationality') list.sort((a,b) => {
          const na = (directorsData[dirKey(a)]?.nationality||'').toLowerCase();
          const nb = (directorsData[dirKey(b)]?.nationality||'').toLowerCase();
          return na.localeCompare(nb,'fr') || a.localeCompare(b,'fr');
        });
        else if (dirSort === 'count') list.sort((a,b) =>
          allItems.filter(m=>m.director===b).length - allItems.filter(m=>m.director===a).length
        );
        else if (dirSort === 'rating') list.sort((a,b) => {
          const avgR = d => { const it=allItems.filter(m=>m.director===d&&m.rating); return it.length?it.reduce((s,m)=>s+parseFloat(m.rating),0)/it.length:0; };
          return avgR(b)-avgR(a);
        });
        return list;
      };

      const rebuildGrid = () => {
        const grid = panel.querySelector('#dir-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const list = getFilteredDirs();
        if (!list.length) {
          grid.innerHTML = `<div style="color:var(--text-3);font-size:13px;font-family:var(--font-b);padding:1rem">Aucun réalisateur trouvé.</div>`;
          return;
        }
        list.forEach(d => {
          const info = directorsData[dirKey(d)] || {};
          const count = allItems.filter(m => m.director === d).length;
          const photo = dirPhoto(d);
          const crop = info.crop;
          let bgStyle = '';
          if (photo) {
            const crop = info.crop;
            if (crop && crop.bgX !== undefined) {
              // Recalcul CSS : background-position exprime le décalage de l'image
              // bgX/bgY = % de l'image naturelle qui est coupé à gauche/haut
              // CSS background-position : quelle partie de l'image est centrée dans la boîte
              const posX = crop.bgX / (100 - crop.bgW) * 100;
              const posY = crop.bgY / (100 - crop.bgH) * 100;
              bgStyle = `background-image:url(${photo});background-size:${100/crop.bgW*100}%;background-position:${posX}% ${posY}%`;
            } else {
              bgStyle = `background-image:url(${photo});background-size:cover;background-position:center top`;
            }
          }

          const card = document.createElement('div');
          card.className = 'dir-card';
          card.innerHTML = `
            <div class="dir-card-bg" style="${bgStyle}">
              ${!photo ? `<div class="dir-card-initials">${dirInitials(d)}</div>` : ''}
            </div>
            <div class="dir-card-overlay"></div>
            <div class="dir-card-info">
              ${info.nationality ? `<div class="dir-card-nat">${esc(info.nationality)}</div>` : ''}
              <div class="dir-card-name">${esc(d)}</div>
              <div class="dir-card-count">${count} titre${count>1?'s':''}</div>
            </div>`;
          card.addEventListener('click', () => showDirectorDetail(d));
          grid.appendChild(card);
        });
      };

      // Collecter toutes les nationalités uniques présentes
      const allNats = [...new Set(
        directors.map(d => (directorsData[dirKey(d)]?.nationality||'').trim()).filter(Boolean)
      )].sort((a,b) => a.localeCompare(b,'fr'));

      const natPillsHtml = allNats.length ? `
        <div class="dir-nat-pills" id="dir-nat-pills" style="${dirSort==='nationality'?'':'display:none'}">
          <button class="dir-nat-pill ${!dirNatFilter?'active':''}" data-nat="">Toutes</button>
          ${allNats.map(n => `<button class="dir-nat-pill ${dirNatFilter===n?'active':''}" data-nat="${esc(n)}">${esc(n)}</button>`).join('')}
        </div>` : '';

      panel.innerHTML = `
        <div class="sf-panel-header">
          <span>Réalisateurs · <span id="dir-count-label">${directors.length}</span></span>
          <button class="sf-panel-close" id="sf-close">✕</button>
        </div>

        <!-- Barre de recherche + tri -->
        <div class="dir-toolbar">
          <div class="dir-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="dir-search-inp" placeholder="Rechercher un réalisateur…" value="${dirSearch}" autocomplete="off">
          </div>
          <div class="dir-sort-wrap">
            <button class="dir-sort-btn ${dirSort==='alpha'?'active':''}" data-sort="alpha">A–Z</button>
            <button class="dir-sort-btn ${dirSort==='nationality'?'active':''}" data-sort="nationality">Origine</button>
            <button class="dir-sort-btn ${dirSort==='count'?'active':''}" data-sort="count">Titres</button>
            <button class="dir-sort-btn ${dirSort==='rating'?'active':''}" data-sort="rating">Note</button>
          </div>
        </div>

        ${natPillsHtml}

        <div class="dir-grid" id="dir-grid"></div>`;

      panel.style.display = 'block';
      panel.querySelector('#sf-close').addEventListener('click', closePanel);

      // Recherche
      panel.querySelector('#dir-search-inp').addEventListener('input', e => {
        dirSearch = e.target.value;
        rebuildGrid();
      });

      // Tri
      panel.querySelectorAll('.dir-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          dirSort = btn.dataset.sort;
          panel.querySelectorAll('.dir-sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort===dirSort));
          // Afficher/cacher les pills selon le tri sélectionné
          const pills = panel.querySelector('#dir-nat-pills');
          if (pills) pills.style.display = dirSort === 'nationality' ? '' : 'none';
          // Réinitialiser le filtre si on quitte "Origine"
          if (dirSort !== 'nationality') {
            dirNatFilter = '';
            if (pills) pills.querySelectorAll('.dir-nat-pill').forEach(p => p.classList.toggle('active', p.dataset.nat===''));
          }
          rebuildGrid();
        });
      });

      // Filtre par nationalité
      panel.querySelectorAll('.dir-nat-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          dirNatFilter = pill.dataset.nat;
          panel.querySelectorAll('.dir-nat-pill').forEach(p => p.classList.toggle('active', p.dataset.nat===dirNatFilter));
          rebuildGrid();
        });
      });

      rebuildGrid();
    };

    const openDirectorEdit = (d) => {
      const info = directorsData[dirKey(d)] || {};
      const existing = document.getElementById('dir-edit-modal');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = 'dir-edit-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(10px)';

      const mkCropRow = (labelText, inputId, previewId, cropKey, existingFile, existingCrop, ratio) => {
        const hasFile = !!existingFile;
        const previewBg = hasFile ? cropBgStyle(imgUrl(existingFile), existingCrop) : '';
        const previewH = ratio === '16/5' ? '70px' : ratio === '3/4' ? '100px' : '120px';
        return `
          <div class="fg" style="margin-bottom:.1rem">
            <label style="display:flex;justify-content:space-between;align-items:center">
              <span>${labelText}</span>
              <button id="crop-btn-${inputId}" style="background:rgba(255,255,255,.07);border:1px solid var(--border);color:var(--text-2);border-radius:6px;padding:.3rem .65rem;font-family:var(--font-b);font-size:10px;cursor:pointer;${hasFile?'':'display:none'}">✂ Recadrer</button>
            </label>
            <input type="text" id="${inputId}" value="${existingFile||''}" placeholder="nom du fichier dans images/" style="margin-top:.3rem">
            <div id="${previewId}" style="margin-top:.4rem;border-radius:8px;overflow:hidden;height:${previewH};background:#111;${previewBg};background-size:${previewBg?'':'cover'};${hasFile?'':'display:none'}">
            </div>
          </div>`;
      };

      modal.innerHTML = `
        <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:20px;width:90%;max-width:500px;max-height:88vh;overflow-y:auto;padding:1.6rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem">
            <h3 style="font-family:var(--font-h);font-size:16px;color:#fff;letter-spacing:.04em;margin:0">${esc(d).toUpperCase()}</h3>
            <button id="dir-edit-close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:18px">✕</button>
          </div>

          <!-- 3 zones de crop -->
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:1rem;margin-bottom:1rem">
            <div style="font-family:var(--font-b);font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:.8rem">Images</div>

            ${mkCropRow('Photo catalogue <span style="color:var(--text-3);font-size:9px;font-weight:400;text-transform:none">— carte 2/3 dans la grille</span>',
              'dir-photo-inp', 'dir-photo-prev', 'crop', info.photo||'', info.crop, '2/3')}

            ${mkCropRow('Photo fiche <span style="color:var(--text-3);font-size:9px;font-weight:400;text-transform:none">— portrait carré sur la carte info</span>',
              'dir-portrait-inp', 'dir-portrait-prev', 'cropPortrait', info.portrait||info.photo||'', info.cropPortrait, '1/1')}

            ${mkCropRow('Bannière <span style="color:var(--text-3);font-size:9px;font-weight:400;text-transform:none">— image paysage en arrière-plan</span>',
              'dir-banner-inp', 'dir-banner-prev', 'cropBanner', info.banner||'', info.cropBanner, '16/9')}
          </div>

          <div class="fg">
            <label>Nationalité</label>
            <input type="text" id="dir-nat-inp" value="${esc(info.nationality||'')}" placeholder="ex: Japonais, Américain…">
          </div>
          <div class="fg">
            <label>Année de naissance</label>
            <input type="number" id="dir-birth-inp" value="${info.birthYear||''}" placeholder="ex: 1910" min="1850" max="2010">
          </div>
          <div class="fg">
            <label>Biographie</label>
            <textarea id="dir-bio-inp" rows="4" placeholder="Présentation du réalisateur…" style="resize:vertical">${esc(info.bio||'')}</textarea>
          </div>
          <button class="btn-submit" id="dir-save-btn" style="margin-top:.8rem">Enregistrer</button>
        </div>`;
      document.body.appendChild(modal);

      // State local pour les crops en cours
      let pendingCrops = {
        crop        : info.crop        || null,
        cropPortrait: info.cropPortrait || null,
        cropBanner  : info.cropBanner  || null,
      };

      // Helper : setup input + preview + crop button pour une zone
      const setupCropZone = (inputId, previewId, cropKey, ratio) => {
        const inp  = modal.querySelector('#' + inputId);
        const prev = modal.querySelector('#' + previewId);
        const btn  = modal.querySelector('#crop-btn-' + inputId);
        if (!inp) return;

        const refreshPreview = () => {
          const v = inp.value.trim();
          if (v) {
            const style = cropBgStyle(imgUrl(v), pendingCrops[cropKey]);
            prev.style.cssText = prev.style.cssText.replace(/display:none;?/g,'');
            prev.style.background = '';
            if (style) {
              const parts = style.split(';');
              parts.forEach(p => {
                const [k,...vs] = p.split(':');
                if (k && vs.length) prev.style[k.trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = vs.join(':').trim();
              });
            } else {
              prev.style.backgroundImage = `url(${imgUrl(v)})`;
              prev.style.backgroundSize = 'cover';
              prev.style.backgroundPosition = 'center top';
            }
            if (btn) btn.style.display = '';
          } else {
            prev.style.display = 'none';
            if (btn) btn.style.display = 'none';
          }
        };

        inp.addEventListener('input', () => { pendingCrops[cropKey] = null; refreshPreview(); });

        if (btn) {
          btn.addEventListener('click', () => {
            const file = inp.value.trim();
            if (!file) return;
            // Calculer le ratio pour le crop
            const [rw, rh] = ratio.split('/').map(Number);
            openPhotoCropRatio(file, pendingCrops[cropKey], rw/rh, crop => {
              pendingCrops[cropKey] = crop;
              refreshPreview();
              toast('Cadrage enregistré ✓', 'success');
            });
          });
        }

        refreshPreview();
      };

      setupCropZone('dir-photo-inp',    'dir-photo-prev',    'crop',         '2/3');
      setupCropZone('dir-portrait-inp', 'dir-portrait-prev', 'cropPortrait', '3/4');
      setupCropZone('dir-banner-inp',   'dir-banner-prev',   'cropBanner',   '16/5');

      modal.querySelector('#dir-edit-close').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

      modal.querySelector('#dir-save-btn').addEventListener('click', () => {
        directorsData[dirKey(d)] = {
          photo        : modal.querySelector('#dir-photo-inp').value.trim()    || null,
          portrait     : modal.querySelector('#dir-portrait-inp').value.trim() || null,
          banner       : modal.querySelector('#dir-banner-inp').value.trim()   || null,
          crop         : pendingCrops.crop,
          cropPortrait : pendingCrops.cropPortrait,
          cropBanner   : pendingCrops.cropBanner,
          nationality  : modal.querySelector('#dir-nat-inp').value.trim(),
          birthYear    : modal.querySelector('#dir-birth-inp').value || '',
          bio          : modal.querySelector('#dir-bio-inp').value.trim(),
        };
        saveDirectors();
        modal.remove();
        showDirectorDetail(d);
        toast('Réalisateur mis à jour', 'success');
      });
    };

    const showDirectorDetail = (d) => {
      const info = directorsData[dirKey(d)] || {};
      const dirItems = allItems.filter(m => m.director === d);
      const avgRating = dirItems.filter(m=>m.rating).length
        ? (dirItems.filter(m=>m.rating).reduce((a,m)=>a+parseFloat(m.rating),0)/dirItems.filter(m=>m.rating).length).toFixed(1)
        : null;

      const bannerUrl   = info.banner   ? imgUrl(info.banner)   : (info.photo ? imgUrl(info.photo) : null);
      const portraitUrl = info.portrait ? imgUrl(info.portrait) : (info.photo ? imgUrl(info.photo) : null);
      const bannerStyle   = cropBgStyle(bannerUrl,   info.cropBanner);
      const portraitStyle = cropBgStyle(portraitUrl, info.cropPortrait || info.crop);

      const metaParts = [];
      if (info.nationality) metaParts.push(esc(info.nationality));
      if (info.birthYear)   metaParts.push('N\u00e9 en ' + info.birthYear);
      metaParts.push(dirItems.length + ' titre' + (dirItems.length>1?'s':'') + ' sur MyFlix');
      if (avgRating)        metaParts.push('\u2605 ' + avgRating + ' moy.');

      const portraitInner = portraitUrl ? '' : '<span style="font-family:var(--font-h);font-size:36px;color:rgba(255,255,255,.25)">' + dirInitials(d) + '</span>';
      const bioHtml = info.bio
        ? '<p class="dir-info-bio">' + esc(info.bio) + '</p>'
        : '<p class="dir-info-bio-empty">Aucune biographie. <button id="sf-dir-edit-inline" style="background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font-b);font-size:12px;padding:0;text-decoration:underline">+ Ajouter</button></p>';

      panel.innerHTML = '<div class="sf-panel-header">'
        + '<button class="sf-panel-back" id="sf-back">\u2190 R\u00e9alisateurs</button>'
        + '<button class="sf-panel-close" id="sf-close">\u00d7</button>'
        + '</div><div class="sf-director-detail">'
        + '<div class="dir-info-card">'
        + '<div class="dir-info-banner" style="' + (bannerStyle || 'background:linear-gradient(135deg,#1a1a2e,#0d0d0d)') + '"></div>'
        + '<div class="dir-info-banner-overlay"></div>'
        + '<div class="dir-info-content">'
        + '<div class="dir-info-portrait" style="' + (portraitStyle || 'background:rgba(255,255,255,.08)') + '">' + portraitInner + '</div>'
        + '<div class="dir-info-text">'
        + '<h2 class="dir-info-name">' + esc(d) + '</h2>'
        + '<div class="dir-info-meta">' + metaParts.map(function(p){ return '<span>' + p + '</span>'; }).join('') + '</div>'
        + bioHtml
        + '</div>'
        + '<button class="sf-dir-edit-btn" id="sf-dir-edit" style="position:absolute;top:1rem;right:1rem">'
        + '<svg width="12" height="12"><use href="#ic-edit"/></svg> Modifier'
        + '</button>'
        + '</div></div>'
        + '<div style="font-family:var(--font-b);font-size:11px;color:var(--text-3);letter-spacing:.08em;text-transform:uppercase;margin:1.4rem 0 .7rem">'
        + 'Filmographie \u00b7 ' + dirItems.length + ' titre' + (dirItems.length>1?'s':'')
        + '</div>'
        + '<div class="movies-grid sf-director-grid" id="sf-director-grid"></div>'
        + '</div>';

      panel.querySelector('#sf-close').addEventListener('click', closePanel);
      panel.querySelector('#sf-back').addEventListener('click', function(){ renderDirectorPanel(); });
      panel.querySelector('#sf-dir-edit').addEventListener('click', function(){ openDirectorEdit(d); });
      var inlineBtn = panel.querySelector('#sf-dir-edit-inline');
      if (inlineBtn) inlineBtn.addEventListener('click', function(){ openDirectorEdit(d); });
      var grid = panel.querySelector('#sf-director-grid');
      dirItems.forEach(function(m) {
        var card = m._isSeries ? mkSeriesCard(m) : mkCard(m);
        grid.appendChild(card);
      });
    };

    const makeRangeSlider = (container, min, max, valMin, valMax, step, fmt, onChange) => {
      let vMin = valMin, vMax = valMax;
      const pct = v => ((v - min) / (max - min)) * 100;
      const clamp = v => Math.min(max, Math.max(min, v));

      container.innerHTML = `
        <div class="sf-range-wrap">
          <div class="sf-range-track" id="rtrack">
            <div class="sf-range-fill" id="rfill"></div>
            <div class="sf-range-thumb" id="rthumb-min" tabindex="0"></div>
            <div class="sf-range-thumb" id="rthumb-max" tabindex="0"></div>
          </div>
          <div class="sf-range-labels">
            <span id="rlabel-min">${fmt(vMin)}</span>
            <span id="rlabel-max">${fmt(vMax)}</span>
          </div>
        </div>`;

      const track = container.querySelector('#rtrack');
      const fill  = container.querySelector('#rfill');
      const tMin  = container.querySelector('#rthumb-min');
      const tMax  = container.querySelector('#rthumb-max');
      const lMin  = container.querySelector('#rlabel-min');
      const lMax  = container.querySelector('#rlabel-max');

      const update = () => {
        const pMin = pct(vMin), pMax = pct(vMax);
        fill.style.left  = pMin + '%';
        fill.style.width = (pMax - pMin) + '%';
        tMin.style.left  = pMin + '%';
        tMax.style.left  = pMax + '%';
        lMin.textContent = fmt(vMin);
        lMax.textContent = fmt(vMax);
        onChange(vMin, vMax);
      };

      const drag = (thumb, isMin) => {
        const onMove = e => {
          const r = track.getBoundingClientRect();
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          let ratio = (clientX - r.left) / r.width;
          let val = min + ratio * (max - min);
          val = Math.round(val / step) * step;
          val = clamp(val);
          if (isMin) { vMin = Math.min(val, vMax - step); }
          else        { vMax = Math.max(val, vMin + step); }
          update();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onUp);
      };

      tMin.addEventListener('mousedown', () => drag(tMin, true));
      tMin.addEventListener('touchstart', () => drag(tMin, true), { passive: true });
      tMax.addEventListener('mousedown', () => drag(tMax, false));
      tMax.addEventListener('touchstart', () => drag(tMax, false), { passive: true });
      update();
    };

    const renderYearPanel = () => {
      panel.innerHTML = `
        <div class="sf-panel-header"><span>Filtrer par année</span><button class="sf-panel-close" id="sf-close">✕</button></div>
        <div class="sf-range-panel">
          <div class="sf-timeline-labels">
            <span class="sf-timeline-min">${minYear}</span>
            <span class="sf-timeline-title">LIGNE DU TEMPS</span>
            <span class="sf-timeline-max">${maxYear}</span>
          </div>
          <div id="sf-year-slider"></div>
          <div class="sf-range-results" id="sf-year-results"></div>
        </div>`;
      panel.style.display = 'block';
      panel.querySelector('#sf-close').addEventListener('click', closePanel);
      const resEl = panel.querySelector('#sf-year-results');
      makeRangeSlider(
        panel.querySelector('#sf-year-slider'),
        minYear, maxYear, minYear, maxYear, 1,
        v => v,
        (vMin, vMax) => {
          const res = allItems.filter(m => { const y = parseInt(m.year); return y >= vMin && y <= vMax; });
          resEl.innerHTML = `<span>${res.length} titre${res.length!==1?'s':''} entre ${vMin} et ${vMax}</span>`;
          showResults(res, `${vMin}–${vMax}`);
        }
      );
    };

    const renderRatingPanel = () => {
      panel.innerHTML = `
        <div class="sf-panel-header"><span>Filtrer par note</span><button class="sf-panel-close" id="sf-close">✕</button></div>
        <div class="sf-range-panel">
          <div class="sf-rating-scale">
            ${[1,2,3,4,5,6,7,8,9,10].map(n=>`<span>${n}</span>`).join('')}
          </div>
          <div id="sf-rating-slider"></div>
          <div class="sf-range-results" id="sf-rating-results"></div>
        </div>`;
      panel.style.display = 'block';
      panel.querySelector('#sf-close').addEventListener('click', closePanel);
      const resEl = panel.querySelector('#sf-rating-results');
      makeRangeSlider(
        panel.querySelector('#sf-rating-slider'),
        0, 10, 0, 10, 0.1,
        v => v.toFixed(1),
        (vMin, vMax) => {
          const res = allItems
            .filter(m => { const r = parseFloat(m.rating); return !isNaN(r) && r >= vMin && r <= vMax; })
            .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
          resEl.innerHTML = `<span>${res.length} titre${res.length!==1?'s':''} entre ★${vMin.toFixed(1)} et ★${vMax.toFixed(1)}</span>`;
          showResults(res, `★ ${vMin.toFixed(1)}–${vMax.toFixed(1)}`);
        }
      );
    };

    const renderDurationPanel = () => {
      panel.innerHTML = `
        <div class="sf-panel-header"><span>Filtrer par durée</span><button class="sf-panel-close" id="sf-close">✕</button></div>
        <div class="sf-range-panel">
          <div id="sf-dur-slider"></div>
          <div class="sf-range-results" id="sf-dur-results"></div>
        </div>`;
      panel.style.display = 'block';
      panel.querySelector('#sf-close').addEventListener('click', closePanel);
      const resEl = panel.querySelector('#sf-dur-results');
      const fmtDur = v => v >= 60 ? `${Math.floor(v/60)}h${v%60>0?String(v%60).padStart(2,'0'):''}` : `${v}min`;
      makeRangeSlider(
        panel.querySelector('#sf-dur-slider'),
        minDur, maxDur, minDur, maxDur, 5,
        fmtDur,
        (vMin, vMax) => {
          const res = movies
            .filter(m => { const d = parseInt(m.duration); return d >= vMin && d <= vMax; })
            .sort((a, b) => parseInt(a.duration) - parseInt(b.duration));
          resEl.innerHTML = `<span>${res.length} film${res.length!==1?'s':''} entre ${fmtDur(vMin)} et ${fmtDur(vMax)}</span>`;
          showResults(res, `${fmtDur(vMin)}–${fmtDur(vMax)}`);
        }
      );
    };



    const closePanel = () => {
      panel.style.display = 'none';
      $$('.sf-cat-btn').forEach(b => b.classList.remove('active'));
      hideResults();
    };

    $$('.sf-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        const wasActive = btn.classList.contains('active');
        $$('.sf-cat-btn').forEach(b => b.classList.remove('active'));
        $('search-dedicated-input').value = '';
        if (wasActive) { closePanel(); return; }
        btn.classList.add('active');
        if (f === 'director') renderDirectorPanel();
        else if (f === 'year') renderYearPanel();
        else if (f === 'rating') renderRatingPanel();
        else if (f === 'duration') renderDurationPanel();

      });
    });

    setTimeout(() => { const inp = $('search-dedicated-input'); if (inp) inp.focus(); }, 100);
  };



    const doSearch=q=>{
    searchQ=q.trim(); if(!searchQ){ renderPage(); return; }
    page='search'; stopHero();
    $('nav-search-clear').style.display='flex';
    const c=$('main-content'); c.innerHTML='';
    const res=movies.filter(m=>[m.title,...(m.genres||[]),m.director,m.description].some(f=>f&&f.toLowerCase().includes(searchQ.toLowerCase())));
    const wrap=document.createElement('div'); wrap.id='search-page';
    wrap.innerHTML=`<div class="page-header"><h2>Résultats pour "<span>${esc(searchQ)}</span>"</h2><p>${res.length} titre${res.length!==1?'s':''} trouvé${res.length!==1?'s':''}</p></div>`;
    c.appendChild(wrap);
    if(!res.length){ wrap.innerHTML+=`<div class="empty-state"><svg width="56" height="56"><use href="#ic-search"/></svg><h3>AUCUN RÉSULTAT</h3></div>`; return; }
    const grid=document.createElement('div'); grid.className='movies-grid';
    const _srFrag = document.createDocumentFragment();
    res.forEach(m=>_srFrag.appendChild(mkCard(m)));
    grid.appendChild(_srFrag);
    wrap.appendChild(grid);
  };

  const renderPage=()=>{
    window.scrollTo({ top:0, behavior:'instant' });
    if(page==='search') doSearch(searchQ);
    else if(page==='films'||page==='series'||page==='anime'||page==='animation') goSection(page);
    else if(page==='genre') goGenre(pageParam,pageSection);
    else if(page==='custom-cat') goCustomCat(pageParam);
    else goHome();
  };

  // ══════════════════════════════════════════════════════
  // ── RÉGLAGES ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════

  const _settings = (() => {
    const defaults = { screensaverEnabled: false, screensaverDelay: 30, gridEnabled: false, haloEnabled: true, accentColor: '#e50914', accentR: 229, accentG: 9, accentB: 20, gridBurstRadius: 1.5, scrollSmooth: 0, lowQuality: false };
    let data = defaults;
    try { data = { ...defaults, ...JSON.parse(localStorage.getItem('myflix_settings') || '{}') }; } catch(e) {}
    const save = () => localStorage.setItem('myflix_settings', JSON.stringify(data));
    return {
      get: (k) => data[k],
      set: (k, v) => { data[k] = v; save(); },
      getAll: () => ({ ...data }),
    };
  })();

  // ── Smooth scroll engine ──────────────────────────────
  const _initSmoothScroll = () => {};
  const _applyScrollSmooth = () => {};

  // ── Mode basse qualité ────────────────────────────────
  const _applyLowQuality = (enabled) => {
    document.body.classList.toggle('lq', enabled);
    if (enabled) {
      _grid.disable(); _grid.disableHalo(); cancelAnimationFrame(heroProgress);
    } else {
      if (_settings.get('gridEnabled')) _grid.enable();
      if (_settings.get('haloEnabled')) _grid.enableHalo(); else _grid.disableHalo();
      if (heroPool.length > 1) startFill();
    }
  };

  // ── Color picker canvas custom ────────────────────────
  const _initCustomColorPicker = (applyColor, swatches) => {
    const wheelCanvas = document.getElementById('tcp-wheel');
    const brightnessCanvas = document.getElementById('tcp-brightness');
    const wheelCursor = document.getElementById('tcp-wheel-cursor');
    const brightCursor = document.getElementById('tcp-brightness-cursor');
    const previewSwatch = document.getElementById('tcp-preview-swatch');
    const previewHex = document.getElementById('tcp-preview-hex');
    const applyBtn = document.getElementById('tcp-apply-btn');
    if (!wheelCanvas || !brightnessCanvas) return;
    const SIZE = 200, cx = SIZE/2, cy = SIZE/2, radius = SIZE/2-2;
    let _h=0, _s=1, _l=0.5;
    const _hslToRgb=(h,s,l)=>{let r,g,b;if(s===0){r=g=b=l;}else{const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q,hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);}return[Math.round(r*255),Math.round(g*255),Math.round(b*255)];};
    const _toHex=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
    const drawWheel=()=>{const wCtx=wheelCanvas.getContext('2d');const imgData=wCtx.createImageData(SIZE,SIZE);const d=imgData.data;for(let y=0;y<SIZE;y++){for(let x=0;x<SIZE;x++){const dx=x-cx,dy=y-cy,dist=Math.sqrt(dx*dx+dy*dy);if(dist>radius){d[(y*SIZE+x)*4+3]=0;continue;}const h=((Math.atan2(dy,dx)*180/Math.PI)+360)%360,s=dist/radius;const[r2,g2,b2]=_hslToRgb(h/360,s,_l);const i=(y*SIZE+x)*4;d[i]=r2;d[i+1]=g2;d[i+2]=b2;d[i+3]=255;}}wCtx.putImageData(imgData,0,0);};
    const drawBrightness=()=>{const bCtx=brightnessCanvas.getContext('2d');const grad=bCtx.createLinearGradient(0,0,SIZE,0);grad.addColorStop(0,'#000');const[r2,g2,b2]=_hslToRgb(_h/360,_s,0.5);grad.addColorStop(0.5,`rgb(${r2},${g2},${b2})`);grad.addColorStop(1,'#fff');bCtx.clearRect(0,0,SIZE,16);bCtx.fillStyle=grad;bCtx.beginPath();bCtx.roundRect(0,0,SIZE,16,8);bCtx.fill();};
    const _updateWheelCursor=()=>{const angle=_h*Math.PI/180,x=cx+_s*radius*Math.cos(angle),y=cy+_s*radius*Math.sin(angle);if(wheelCursor){wheelCursor.style.left=x+'px';wheelCursor.style.top=y+'px';}};
    const _updateBrightCursor=()=>{if(brightCursor)brightCursor.style.left=(_l*SIZE)+'px';};
    const _updatePreview=()=>{const[r2,g2,b2]=_hslToRgb(_h/360,_s,_l);const hex=_toHex(r2,g2,b2);if(previewSwatch)previewSwatch.style.background=hex;if(previewHex)previewHex.textContent=hex.toUpperCase();};
    const _refresh=()=>{drawWheel();drawBrightness();_updateWheelCursor();_updateBrightCursor();_updatePreview();};
    const _syncToHex=(hex)=>{const ir=parseInt(hex.slice(1,3),16)/255,ig=parseInt(hex.slice(3,5),16)/255,ib=parseInt(hex.slice(5,7),16)/255;const maxC=Math.max(ir,ig,ib),minC=Math.min(ir,ig,ib);_l=(maxC+minC)/2;_s=maxC===minC?0:_l<0.5?(maxC-minC)/(maxC+minC):(maxC-minC)/(2-maxC-minC);_h=0;if(maxC!==minC){const d=maxC-minC;_h=maxC===ir?((ig-ib)/d+6)%6*60:maxC===ig?((ib-ir)/d+2)*60:((ir-ig)/d+4)*60;}_refresh();};
    _syncToHex(_settings.get('accentColor')||'#e50914');
    window._syncPickerToCurrentColor=()=>_syncToHex(_settings.get('accentColor')||'#e50914');
    const _wheelInteract=(e)=>{const rect=wheelCanvas.getBoundingClientRect();const ex=(e.touches?e.touches[0].clientX:e.clientX)-rect.left,ey=(e.touches?e.touches[0].clientY:e.clientY)-rect.top;const dx=ex-cx,dy=ey-cy,dist=Math.min(Math.sqrt(dx*dx+dy*dy),radius);_h=((Math.atan2(dy,dx)*180/Math.PI)+360)%360;_s=dist/radius;_refresh();};
    let _wheelDrag=false;
    wheelCanvas.addEventListener('mousedown',e=>{_wheelDrag=true;_wheelInteract(e);});
    document.addEventListener('mousemove',e=>{if(_wheelDrag)_wheelInteract(e);});
    document.addEventListener('mouseup',()=>{_wheelDrag=false;});
    wheelCanvas.addEventListener('touchstart',e=>{e.preventDefault();_wheelInteract(e);},{passive:false});
    wheelCanvas.addEventListener('touchmove',e=>{e.preventDefault();_wheelInteract(e);},{passive:false});
    const _brightInteract=(e)=>{const rect=brightnessCanvas.getBoundingClientRect();const ex=(e.touches?e.touches[0].clientX:e.clientX)-rect.left;_l=Math.max(0,Math.min(1,ex/SIZE));_refresh();};
    let _brightDrag=false;
    brightnessCanvas.addEventListener('mousedown',e=>{_brightDrag=true;_brightInteract(e);});
    document.addEventListener('mousemove',e=>{if(_brightDrag)_brightInteract(e);});
    document.addEventListener('mouseup',()=>{_brightDrag=false;});
    brightnessCanvas.addEventListener('touchstart',e=>{e.preventDefault();_brightInteract(e);},{passive:false});
    brightnessCanvas.addEventListener('touchmove',e=>{e.preventDefault();_brightInteract(e);},{passive:false});
    if(applyBtn){applyBtn.addEventListener('click',()=>{const[r2,g2,b2]=_hslToRgb(_h/360,_s,_l);const hex=_toHex(r2,g2,b2);swatches.forEach(s=>{if(s.id!=='theme-swatch-custom')s.classList.remove('active');});document.getElementById('theme-swatch-custom')?.classList.add('active');applyColor(hex,r2,g2,b2);});}
  };

  const openSettings = () => {
    // Charger les valeurs actuelles
    const chk = document.getElementById('setting-screensaver-enabled');
    const slider = document.getElementById('setting-screensaver-delay');
    const label  = document.getElementById('setting-delay-label');
    const delayRow = document.getElementById('setting-delay-row');
    if (chk)    chk.checked = _settings.get('screensaverEnabled');
    if (slider) slider.value = _settings.get('screensaverDelay');
    if (label)  label.textContent = _fmtDelay(_settings.get('screensaverDelay'));
    if (delayRow) delayRow.style.opacity = _settings.get('screensaverEnabled') ? '1' : '.4';
    // ── Éditeur de recadrage hero ──
    const heroCropEditor = document.getElementById('hero-crop-editor');
    if (heroCropEditor) {
      const featured = getFeaturedResolved ? getFeaturedResolved() : [];
      if (!featured.length) {
        heroCropEditor.innerHTML = '<div style="color:var(--text-3);font-size:12px;font-family:var(--font-b)">Aucun film en vedette.</div>';
      } else {
        heroCropEditor.innerHTML = '';
        featured.forEach(f => {
          const m = f.obj;
          const src = imgUrl(m.backdrop || m.poster);
          if (!src) return;
          const crop = _settings.get('heroCrop_' + m.id) || null;

          // Calculer le style de background avec le crop actuel
          const getBgStyle = (c) => {
            if (!c || c.bgX === undefined) return 'center 25%';
            const dx = 100-c.bgW, dy = 100-c.bgH;
            return (dx>0?c.bgX/dx*100:50)+'% '+(dy>0?c.bgY/dy*100:50)+'%';
          };
          const getBgSize = (c) => !c||c.bgX===undefined ? 'cover' : (100/c.bgW*100)+'%';

          const item = document.createElement('div');
          item.style.cssText = 'margin-bottom:1rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden';
          item.innerHTML =
            '<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;border-bottom:1px solid rgba(255,255,255,.06)">'
            +'<div style="width:32px;height:32px;border-radius:6px;background-image:url('+esc(src)+');background-size:cover;background-position:center;flex-shrink:0"></div>'
            +'<span style="font-family:var(--font-b);font-size:12px;color:#fff;flex:1">'+esc(m.title)+'</span>'
            +'<button class="hce-edit-btn" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:var(--text-2);border-radius:6px;padding:.3rem .7rem;font-family:var(--font-b);font-size:11px;cursor:pointer">✂ Recadrer</button>'
            +'</div>'
            +'<div class="hce-preview" style="height:80px;background-image:url('+esc(src)+');background-size:'+getBgSize(crop)+';background-position:'+getBgStyle(crop)+';position:relative">'
            +'<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.4),transparent)"></div>'
            +'</div>';

          const editBtn = item.querySelector('.hce-edit-btn');
          editBtn.addEventListener('click', () => {
            // Ouvrir le cropRatio avec ratio hero (le ratio réel de la carte)
            const heroEl = document.getElementById('hero');
            const heroRatio = heroEl ? heroEl.offsetWidth / heroEl.offsetHeight : 16/9;
            openPhotoCropRatio(m.backdrop || m.poster, crop, heroRatio, newCrop => {
              _settings.set('heroCrop_' + m.id, newCrop);
              // Mettre à jour le preview
              const dx=100-newCrop.bgW, dy=100-newCrop.bgH;
              const px=(dx>0?newCrop.bgX/dx*100:50)+'%', py=(dy>0?newCrop.bgY/dy*100:50)+'%';
              const preview = item.querySelector('.hce-preview');
              if (preview) {
                preview.style.backgroundPosition = px+' '+py;
                preview.style.backgroundSize = (100/newCrop.bgW*100)+'%';
              }
              toast('Recadrage de "'+m.title+'" sauvegardé ✓', 'success');
            });
          });

          heroCropEditor.appendChild(item);
        });
      }
    }

    // ── Swatches de couleur ──
    const swatches = document.querySelectorAll('.theme-swatch');
    const customPicker = document.getElementById('theme-custom-picker');
    const colorInput   = document.getElementById('theme-color-input');
    const currentHex   = _settings.get('accentColor') || '#e50914';
    if (colorInput) colorInput.value = currentHex;

    // Marquer le swatch actif
    swatches.forEach(s => {
      s.classList.toggle('active', s.dataset.color === currentHex);
    });

    const applyColor = (hex, r, g, b) => {
      _applyAccent(hex, r, g, b); // sauvegarde + apply en une fois
      swatches.forEach(s => s.classList.toggle('active', s.dataset.color === hex));
    };

    swatches.forEach(s => {
      s.addEventListener('click', () => {
        if (s.id === 'theme-swatch-custom') {
          if (customPicker) { const isOpen = customPicker.style.display !== 'none'; customPicker.style.display = isOpen ? 'none' : 'block'; if (!isOpen && window._syncPickerToCurrentColor) window._syncPickerToCurrentColor(); }
          return;
        }
        if (customPicker) customPicker.style.display = 'none';
        const hex = s.dataset.color;
        const r = parseInt(s.dataset.r), g = parseInt(s.dataset.g), b = parseInt(s.dataset.b);
        applyColor(hex, r, g, b);
      });
    });

    if (colorInput) {
      colorInput.addEventListener('input', () => {
        const hex = colorInput.value;
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        swatches.forEach(s => { if(s.id !== 'theme-swatch-custom') s.classList.remove('active'); });
        document.getElementById('theme-swatch-custom')?.classList.add('active');
        applyColor(hex, r, g, b);
      });
    }
    if (!window._pickerInitialized) { _initCustomColorPicker(applyColor, swatches); window._pickerInitialized = true; }

    const gridChk = document.getElementById('setting-grid-enabled');
    if (gridChk) {
      gridChk.checked = _settings.get('gridEnabled');
      gridChk.onchange = () => {
        _settings.set('gridEnabled', gridChk.checked);
        if (gridChk.checked) _grid.enable(); else _grid.disable();
        const burstRow = document.getElementById('setting-burst-row');
        if (burstRow) burstRow.style.opacity = gridChk.checked ? '1' : '.4';
      };
      // Afficher/masquer la ligne burst selon l'état actuel
      const burstRow = document.getElementById('setting-burst-row');
      if (burstRow) burstRow.style.opacity = _settings.get('gridEnabled') ? '1' : '.4';
    }
    // Burst radius slider
    const burstSlider = document.getElementById('setting-burst-radius');
    const burstLabel  = document.getElementById('setting-burst-label');
    const _burstLabel = (v) => {
      if (v <= 0.5) return 'Très condensé';
      if (v <= 1.5) return 'Condensé';
      if (v <= 2.5) return 'Moyen';
      if (v <= 3.5) return 'Large';
      return 'Très large';
    };
    if (burstSlider) {
      burstSlider.value = _settings.get('gridBurstRadius') ?? 1.5;
      if (burstLabel) burstLabel.textContent = _burstLabel(parseFloat(burstSlider.value));
      burstSlider.oninput = () => {
        const v = parseFloat(burstSlider.value);
        _settings.set('gridBurstRadius', v);
        if (burstLabel) burstLabel.textContent = _burstLabel(v);
      };
    }

    const haloChk = document.getElementById('setting-halo-enabled');
    if (haloChk) {
      haloChk.checked = _settings.get('haloEnabled');
      haloChk.onchange = () => { _settings.set('haloEnabled', haloChk.checked); if (haloChk.checked) _grid.enableHalo(); else _grid.disableHalo(); };
    }
    const lqChk = document.getElementById('setting-low-quality');
    if (lqChk) {
      lqChk.checked = _settings.get('lowQuality');
      lqChk.onchange = () => {
        _settings.set('lowQuality', lqChk.checked); _applyLowQuality(lqChk.checked);
        const rows = document.querySelectorAll('#setting-grid-enabled, #setting-halo-enabled, #setting-burst-radius, #setting-burst-row');
        rows.forEach(el => { const r=el.closest('.settings-row')||el; r.style.opacity=lqChk.checked?'.35':'1'; r.style.pointerEvents=lqChk.checked?'none':''; });
      };
      const isLQ = _settings.get('lowQuality');
      const rows = document.querySelectorAll('#setting-grid-enabled, #setting-halo-enabled, #setting-burst-radius, #setting-burst-row');
      rows.forEach(el => { const r=el.closest('.settings-row')||el; r.style.opacity=isLQ?'.35':'1'; r.style.pointerEvents=isLQ?'none':''; });
    }

    // Scroll fluide
    const scrollSlider = document.getElementById('setting-scroll-smooth');
    if (chk) {
      chk.onchange = () => {
        _settings.set('screensaverEnabled', chk.checked);
        if (delayRow) delayRow.style.opacity = chk.checked ? '1' : '.4';
        if (chk.checked) _ss.start(); else _ss.stop();
      };
    }
    if (slider) {
      slider.oninput = () => {
        _settings.set('screensaverDelay', parseInt(slider.value));
        if (label) label.textContent = _fmtDelay(parseInt(slider.value));
        _ss.resetTimer();
      };
    }
    openModal('modal-settings');
  };

  const closeSettings = () => closeModal('modal-settings');

  // ── Système de thème ──────────────────────────────────
  const _applyAccent = (hex, r, g, b) => {
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', r+','+g+','+b);
    root.style.setProperty('--accent-glow', 'rgba('+r+','+g+','+b+',.3)');
    root.style.setProperty('--border-red', 'rgba('+r+','+g+','+b+',.35)');
    // Mettre à jour le halo DOM
    const hEl = document.getElementById('cursor-halo');
    if (hEl) hEl.style.background = 'radial-gradient(circle, rgba('+r+','+g+','+b+',0.13) 0%, rgba('+r+','+g+','+b+',0.04) 45%, transparent 70%)';
    // Mettre à jour la grille canvas
    if (window._gridSetColor) window._gridSetColor(r, g, b);
    // Sauvegarder
    _settings.set('accentColor', hex);
    _settings.set('accentR', r); _settings.set('accentG', g); _settings.set('accentB', b);
  };

  const _initTheme = () => {
    const hex = _settings.get('accentColor') || '#e50914';
    const r   = parseInt(_settings.get('accentR')) || 229;
    const g   = parseInt(_settings.get('accentG')) || 9;
    const b   = parseInt(_settings.get('accentB')) || 20;
    // Appliquer directement sans re-sauvegarder (déjà en mémoire)
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', r+','+g+','+b);
    root.style.setProperty('--accent-glow', 'rgba('+r+','+g+','+b+',.3)');
    root.style.setProperty('--border-red', 'rgba('+r+','+g+','+b+',.35)');
    // Grille
    if (window._gridSetColor) window._gridSetColor(r, g, b);
    // Halo (créé après init, donc via MutationObserver ou timeout)
    setTimeout(() => {
      const hEl = document.getElementById('cursor-halo');
      if (hEl) hEl.style.background = 'radial-gradient(circle, rgba('+r+','+g+','+b+',0.13) 0%, rgba('+r+','+g+','+b+',0.04) 45%, transparent 70%)';
    }, 100);
  };

  const _fmtDelay = (s) => s < 60 ? s + ' secondes' : Math.floor(s/60) + ' minute' + (s>=120?'s':'') + (s%60?' '+s%60+'s':'');

  // ══════════════════════════════════════════════════════
  // ── ÉCRAN DE VEILLE ───────────────────────────────────
  // ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // ── GRILLE INTERACTIVE ───────────────────────────────
  // ══════════════════════════════════════════════════════
  const _grid = (() => {
    let canvas, ctx, cols, rows, animFrame;
    let active = false;
    let mouseX = -9999, mouseY = -9999;
    let lastCellC = -1, lastCellR = -1;
    let isScrolling = false, scrollTimer = null;
    let haloActive = true;
    let haloEl = null;

    const CELL = 48;
    let R = 229, G = 9, B = 20;
    const DECAY = 0.018, CURSOR_MIN = 0.45;
    const HALO_RADIUS = 160;
    let cells = null;

    const initHalo = () => {
      haloEl = document.createElement('div');
      haloEl.id = 'cursor-halo';
      haloEl.style.cssText = [
        'position:fixed','top:0','left:0',
        'width:'+(HALO_RADIUS*2)+'px','height:'+(HALO_RADIUS*2)+'px',
        'border-radius:50%','pointer-events:none','z-index:0',
        'transform:translate(-50%,-50%)',
        'background:radial-gradient(circle, rgba('+R+','+G+','+B+',0.13) 0%, rgba('+R+','+G+','+B+',0.04) 45%, transparent 70%)',
        'display:none','will-change:transform',
      ].join(';');
      document.body.appendChild(haloEl);
    };

    const init = () => {
      canvas = document.getElementById('grid-bg');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      initHalo();
      resize();
      window.addEventListener('resize', resize);
      document.addEventListener('mousemove', (e) => {
        // Coordonnées dans le document (pas la fenêtre)
        mouseX = e.clientX;
        // Pas de scrollY ici car le canvas position:absolute est dans le flux
        // et clientY correspond déjà à la bonne case visible
        mouseY = e.clientY;
        isScrolling = false;
        if (haloActive && haloEl) {
          haloEl.style.display = 'block';
          haloEl.style.left = e.clientX + 'px';
          haloEl.style.top  = e.clientY + 'px';
        }
      });
      window.addEventListener('scroll', () => {
        isScrolling = true;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => { isScrolling = false; }, 150);
      }, { passive: true });
    };

    const resize = () => {
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.ceil(canvas.width  / CELL) + 2;
      rows = Math.ceil(canvas.height / CELL) + 2;
      cells = new Float32Array(cols * rows);
      lastCellC = -1; lastCellR = -1;
    };

    const triggerBurst = (cc, cr) => {
      const burstR = _settings.get('gridBurstRadius') ?? 1.5;
      const burstRInt = Math.ceil(burstR);
      const candidates = [];
      for (let dr = -burstRInt; dr <= burstRInt; dr++) {
        for (let dc = -burstRInt; dc <= burstRInt; dc++) {
          if (dc === 0 && dr === 0) continue;
          if (Math.sqrt(dc*dc + dr*dr) > burstR) continue;
          const c = cc+dc, r = cr+dr;
          if (c >= 0 && c < cols && r >= 0 && r < rows) candidates.push({ c, r });
        }
      }
      for (let i = candidates.length-1; i > 0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [candidates[i],candidates[j]] = [candidates[j],candidates[i]];
      }
      candidates.slice(0, 3 + Math.floor(Math.random()*3)).forEach(({c,r}) => {
        const idx = r*cols+c;
        cells[idx] = Math.max(cells[idx], 0.25 + Math.random()*0.35);
      });
    };

    const draw = () => {
      animFrame = requestAnimationFrame(draw);
      if (!active || !ctx) return;

      // Case persistante seulement si curseur actif ET pas en train de scroller
      const cursorActive = mouseX > 0 && !isScrolling;
      const cc = cursorActive ? Math.floor(mouseX / CELL) : -1;
      const cr = cursorActive ? Math.floor(mouseY / CELL) : -1;

      if (cursorActive && (cc !== lastCellC || cr !== lastCellR)) {
        triggerBurst(cc, cr);
        lastCellC = cc; lastCellR = cr;
      }
      if (isScrolling) { lastCellC = -1; lastCellR = -1; }

      // Toujours maintenir la case sous le curseur à l'intensité max
      if (cursorActive && cc >= 0 && cr >= 0 && cc < cols && cr < rows) {
        cells[cr * cols + cc] = CURSOR_MIN;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 0.85;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r*cols+c;
          let alpha = cells[idx];
          const isCursor = (c === cc && r === cr && cursorActive);

          if (isCursor) {
            cells[idx] = Math.max(alpha, CURSOR_MIN);
            alpha = cells[idx];
          } else {
            cells[idx] = Math.max(0, alpha - DECAY);
            if (cells[idx] < 0.005) { cells[idx] = 0; continue; }
            alpha = cells[idx];
          }

          ctx.strokeStyle = 'rgba('+R+','+G+','+B+','+alpha.toFixed(3)+')';
          ctx.strokeRect(c*CELL+1, r*CELL+1, CELL-2, CELL-2);
        }
      }
    };

    const enable = () => {
      if (active) return; active = true;
      if (canvas) canvas.style.opacity = '1';
      if (!animFrame) draw();
    };

    const disable = () => {
      active = false; mouseX = -9999; mouseY = -9999;
      lastCellC = -1; lastCellR = -1;
      if (cells) cells.fill(0);
      if (canvas) canvas.style.opacity = '0';
      if (haloEl) haloEl.style.display = 'none';
      if (ctx && canvas) ctx.clearRect(0,0,canvas.width,canvas.height);
    };

    const enableHalo = () => {
      haloActive = true;
      if (haloEl) haloEl.style.display = mouseX > 0 ? 'block' : 'none';
    };

    const disableHalo = () => {
      haloActive = false;
      if (haloEl) haloEl.style.display = 'none';
    };

    const setColor = (r, g, b) => {
      R = r; G = g; B = b;
      if (haloEl) haloEl.style.background = 'radial-gradient(circle, rgba('+R+','+G+','+B+',0.13) 0%, rgba('+R+','+G+','+B+',0.04) 45%, transparent 70%)';
    };
    window._gridSetColor = setColor;
    return { init, enable, disable, enableHalo, disableHalo };
  })();




  const _ss = (() => {
    const el     = () => document.getElementById('screensaver');
    const bgA    = () => document.getElementById('ss-bg-a');
    const bgB    = () => document.getElementById('ss-bg-b');
    const titleEl= () => document.getElementById('ss-title');
    const metaEl = () => document.getElementById('ss-meta');
    const dotsEl = () => document.getElementById('ss-dots');
    const clockEl= () => document.getElementById('ss-clock');

    let timer = null, imgIdx = 0, imgTimer = null, clockTimer = null;
    let slides = [];  // { url, title, meta }
    let active = false, currentBg = 'a'; // which bg is on top

    const _buildSlides = () => {
      const resolved = getFeaturedResolved ? getFeaturedResolved() : [];
      slides = resolved
        .map(f => {
          const obj = f.obj;
          const url = backdropSrc(obj) || posterSrc(obj);
          if (!url) return null;
          const title = obj.title || '';
          const parts = [];
          if (obj.year) parts.push(obj.year);
          if (obj.rating) parts.push('★ ' + obj.rating);
          return { url, title, meta: parts.join('  ·  ') };
        })
        .filter(Boolean);

      // Compléter avec les films qui ont un backdrop si pas assez
      if (slides.length < 3) {
        movies.filter(m => m.backdrop).forEach(m => {
          if (slides.find(s => s.url === imgUrl(m.backdrop))) return;
          const parts = [];
          if (m.year) parts.push(m.year);
          if (m.rating) parts.push('★ ' + m.rating);
          slides.push({ url: imgUrl(m.backdrop), title: m.title, meta: parts.join('  ·  ') });
        });
      }
    };

    const _updateClock = () => {
      const c = clockEl(); if (!c) return;
      const now = new Date();
      const h = String(now.getHours()).padStart(2,'0');
      const m = String(now.getMinutes()).padStart(2,'0');
      const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
      const months = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
      const dateStr = days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()];
      c.innerHTML = '<div class="ss-clock-time">' + h + ':' + m + '</div><div class="ss-clock-date">' + dateStr + '</div>';
    };

    const _showSlide = (idx) => {
      if (!slides.length) return;
      idx = ((idx % slides.length) + slides.length) % slides.length;
      imgIdx = idx;
      const slide = slides[idx];

      // Dots
      const d = dotsEl();
      if (d) {
        d.innerHTML = slides.map((_, i) =>
          '<div class="ss-dot' + (i===idx?' active':'') + '"></div>'
        ).join('');
      }

      // Titre et meta
      const t = titleEl(); if (t) t.textContent = slide.title;
      const me = metaEl(); if (me) me.textContent = slide.meta;

      // Transition de fond
      const a = bgA(), b = bgB();
      if (!a || !b) return;
      // Relancer l'animation Ken Burns en retirant/remettant la classe
      const resetAnim = (el, animName) => {
        el.style.animation = 'none';
        el.offsetHeight; // reflow
        el.style.animation = animName + ' 9s ease-in-out forwards';
      };
      if (currentBg === 'a') {
        b.style.backgroundImage = 'url(' + slide.url + ')';
        resetAnim(b, 'ss-ken-burns-b');
        b.style.opacity = '1';
        a.style.opacity = '0';
        currentBg = 'b';
      } else {
        a.style.backgroundImage = 'url(' + slide.url + ')';
        resetAnim(a, 'ss-ken-burns-a');
        a.style.opacity = '1';
        b.style.opacity = '0';
        currentBg = 'a';
      }
    };

    const show = () => {
      if (active) return;
      // Ne pas démarrer si le player vidéo est ouvert
      if (document.getElementById('player-wrap')?.classList.contains('open')) {
        resetTimer(); return;
      }
      active = true;
      _buildSlides();
      if (!slides.length) { active = false; return; }
      const s = el(); if (!s) return;
      s.style.display = 'block';
      s.style.opacity = '0';
      s.style.transition = 'opacity .8s ease';
      document.body.style.overflow = 'hidden';
      imgIdx = Math.floor(Math.random() * slides.length);
      _showSlide(imgIdx);
      _updateClock();
      // Fade in
      requestAnimationFrame(() => requestAnimationFrame(() => { s.style.opacity = '1'; }));
      imgTimer   = setInterval(() => _showSlide(imgIdx + 1), 8000);
      clockTimer = setInterval(_updateClock, 1000);
    };

    const hide = () => {
      if (!active) return;
      active = false;
      clearInterval(imgTimer); clearInterval(clockTimer);
      const s = el(); if (!s) return;
      s.style.transition = 'opacity .6s ease';
      s.style.opacity = '0';
      setTimeout(() => {
        s.style.display = 'none';
        s.style.transition = '';
        document.body.style.overflow = '';
      }, 620);
      resetTimer();
    };

    const resetTimer = () => {
      clearTimeout(timer);
      if (!_settings.get('screensaverEnabled')) return;
      const delay = (_settings.get('screensaverDelay') || 30) * 1000;
      timer = setTimeout(show, delay);
    };

    const start = () => resetTimer();
    const stop  = () => { clearTimeout(timer); hide(); };

    // Écouter l'activité utilisateur
    const _onActivity = () => { if (active) hide(); else resetTimer(); };

    const init = () => {
      ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(ev =>
        document.addEventListener(ev, _onActivity, { passive: true })
      );
      // Clic sur l'écran de veille → fermer
      document.getElementById('screensaver')?.addEventListener('click', hide);
      document.addEventListener('keydown', e => { if (active) { e.preventDefault(); hide(); } });
      if (_settings.get('screensaverEnabled')) resetTimer();
    };

    return { start, stop, resetTimer, init };
  })();

  // ── COMPTE & ACCÈS ──────────────────────────────────────────────────────────
  const _refreshPendingBadge = async () => {
    const d = await apiGet('/api/auth/me'); if (!d?.user) return;
    const access = d.pendingCount || 0;
    const reqs   = (isAdmin() ? d.requestsCount : d.requestUpdates) || 0;
    const badge = $('nav-account-badge'); if (badge) { badge.hidden = !(access + reqs); badge.textContent = access + reqs; }
    const count = $('nav-account-count'); if (count) count.textContent = access || '';
    const rc = $('nav-requests-count'); if (rc) rc.textContent = reqs || '';
  };

  const _initAccountMenu = () => {
    const menu = $('nav-account-menu');
    $('nav-account-initial').textContent = currentUser.username.charAt(0).toUpperCase();
    $('nav-account-name').textContent = currentUser.username;
    $('nav-requests-label').textContent = isAdmin() ? 'Demandes de films' : 'Demander un film';
    $('nav-account-btn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', e => { if (!e.target.closest('#nav-account')) menu.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
  };

  const logout = async () => {
    await fetch(`${API}/api/auth/logout`, { method:'POST' }).catch(()=>{});
    location.href = '/login';
  };

  const _fmtDate = t => t ? new Date(t).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' }) : '';

  // Panneau admin : valider / refuser les demandes, retirer un accès
  const openAccessPanel = () => {
    $('nav-account-menu').hidden = true;
    if (!$('modal-access')) {
      const overlay = document.createElement('div');
      overlay.id = 'modal-access'; overlay.className = 'm-overlay open'; overlay.style.zIndex = '500';
      overlay.innerHTML = `
        <div class="m-box" style="max-width:560px">
          <div class="m-head">
            <h2>ACCÈS AU SITE</h2>
            <div class="m-close" id="access-close"><svg><use href="#ic-x"/></svg></div>
          </div>
          <div class="m-body" id="access-body"><div class="access-empty">Chargement…</div></div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#access-close').addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }
    _renderAccessPanel();
  };

  const _renderAccessPanel = async () => {
    const body = $('access-body'); if (!body) return;
    const d = await apiGet('/api/admin/users');
    if (!d?.users) { body.innerHTML = '<div class="access-empty">Impossible de charger les comptes</div>'; return; }
    const others = d.users.filter(u => u.role !== 'admin');
    const groups = [
      { status:'pending',  label:'En attente', since:u => 'Demande du ' + _fmtDate(u.createdAt),
        actions:[['approve','Accepter','primary'], ['reject','Refuser','']] },
      { status:'approved', label:'Membres',    since:u => 'Membre depuis le ' + _fmtDate(u.decidedAt) + (u.lastLoginAt ? ' · vu le ' + _fmtDate(u.lastLoginAt) : ''),
        actions:[['reject','Retirer l\'accès','']] },
      { status:'rejected', label:'Refusés',    since:u => 'Refusé le ' + _fmtDate(u.decidedAt),
        actions:[['approve','Accepter',''], ['delete','Supprimer','danger']] },
    ];
    body.innerHTML = groups.map(g => {
      const list = others.filter(u => u.status === g.status);
      if (g.status !== 'pending' && !list.length) return '';
      const rows = list.map(u => `
        <div class="access-row">
          <div class="access-avatar">${esc(u.username.charAt(0).toUpperCase())}</div>
          <div class="access-info">
            <div class="access-name">${esc(u.username)}</div>
            <div class="access-meta">${g.since(u)}</div>
            ${u.message ? `<div class="access-msg">« ${esc(u.message)} »</div>` : ''}
          </div>
          <div class="access-actions">${g.actions.map(([a,l,cls]) => `<button class="access-btn ${cls}" data-id="${esc(u.id)}" data-action="${a}">${l}</button>`).join('')}</div>
        </div>`).join('');
      return `<div class="access-group"><div class="access-group-title">${g.label} <span class="section-count">${list.length}</span></div>`
        + (rows || '<div class="access-empty">Aucune demande en attente</div>') + '</div>';
    }).join('');
    body.querySelectorAll('.access-btn').forEach(b => b.addEventListener('click', async () => {
      const { id, action } = b.dataset;
      const u = others.find(x => x.id === id); if (!u) return;
      if (action === 'delete' && !confirm(`Supprimer définitivement le compte « ${u.username} » ?`)) return;
      if (action === 'reject' && u.status === 'approved' && !confirm(`Retirer l'accès à « ${u.username} » ? Cette personne sera déconnectée immédiatement.`)) return;
      b.disabled = true;
      const r = await apiPost('/api/admin/users/decide', { id, action });
      if (!r?.ok) { toast(esc(r?.error || 'Action impossible'), 'error'); b.disabled = false; return; }
      toast(action === 'approve' ? `${esc(u.username)} a maintenant accès au site` : action === 'delete' ? 'Compte supprimé' : 'Accès retiré', 'success');
      _renderAccessPanel(); _refreshPendingBadge();
    }));
  };

  // ── DEMANDES DE FILMS ───────────────────────────────────────────────────────
  const _normTitle = t => String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const _reqKind   = k => k === 'serie' ? 'Série' : 'Film';
  const _reqTitle  = r => esc(r.title) + (r.year ? ` <span class="req-year">${r.year}</span>` : '');
  const _reqStatus = { pending:['En attente',''], added:['Ajouté','ok'], refused:['Refusé','no'] };
  const _reqChip   = r => `<span class="req-chip ${_reqStatus[r.status][1]}">${_reqStatus[r.status][0]}</span>`;

  // Titre déjà au catalogue ? → { title, open }
  const _inCatalog = (title, kind) => {
    const key = _normTitle(title); if (key.length < 2) return null;
    if (kind !== 'serie') { const m = movies.find(x => _normTitle(x.title) === key); if (m) return { title:m.title, open:() => showDetail(m.id) }; }
    if (kind !== 'film')  { const s = SeriesManager.getAll().find(x => _normTitle(x.title) === key); if (s) return { title:s.title, open:() => showSeriesDetail(s.id) }; }
    return null;
  };

  const openRequestsPanel = (prefill = '') => {
    $('nav-account-menu').hidden = true;
    $('modal-requests')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-requests'; overlay.className = 'm-overlay open'; overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="m-box" style="max-width:560px">
        <div class="m-head">
          <h2>${isAdmin() ? 'DEMANDES DE FILMS' : 'DEMANDER UN FILM'}</h2>
          <div class="m-close" id="requests-close"><svg><use href="#ic-x"/></svg></div>
        </div>
        <div class="m-body">
          ${isAdmin() ? '' : `
          <form class="req-form" id="req-form" autocomplete="off">
            <div class="req-kind" role="radiogroup" aria-label="Type">
              <label><input type="radio" name="kind" value="film" checked><span>Film</span></label>
              <label><input type="radio" name="kind" value="serie"><span>Série</span></label>
            </div>
            <div class="req-row">
              <div class="fg req-title-field"><label for="req-title">Titre</label><input id="req-title" name="title" maxlength="120" required placeholder="Ex. : Le Voyage de Chihiro"></div>
              <div class="fg req-year-field"><label for="req-year">Année <span class="req-opt">(facultatif)</span></label><input id="req-year" name="year" inputmode="numeric" maxlength="4" placeholder="2001"></div>
            </div>
            <div class="req-hint" id="req-hint" hidden></div>
            <div class="fg"><label for="req-note">Un mot <span class="req-opt">(facultatif)</span></label><input id="req-note" name="note" maxlength="300" placeholder="Version originale, réalisateur, pourquoi tu le veux…"></div>
            <button class="btn-submit" type="submit">Envoyer la demande</button>
          </form>`}
          <div id="requests-body"><div class="access-empty">Chargement…</div></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#requests-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const form = $('req-form');
    if (form) {
      const title = $('req-title'), hint = $('req-hint');
      const kind = () => form.querySelector('input[name=kind]:checked').value;
      // Prévenir quand le titre est déjà sur MyFlix
      const check = () => {
        const found = _inCatalog(title.value, kind());
        hint.hidden = !found; if (!found) return;
        hint.innerHTML = `<b>${esc(found.title)}</b> est déjà sur MyFlix. <a href="#" id="req-hint-open">Voir</a>`;
        $('req-hint-open').addEventListener('click', e => { e.preventDefault(); close(); found.open(); });
      };
      title.addEventListener('input', check);
      form.querySelectorAll('input[name=kind]').forEach(r => r.addEventListener('change', check));
      if (prefill) { title.value = prefill; check(); }
      setTimeout(() => (prefill ? $('req-year') : title).focus(), 50);

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        const r = await apiPost('/api/requests', { title:title.value, kind:kind(), year:$('req-year').value, note:$('req-note').value });
        btn.disabled = false;
        if (!r?.ok) { toast(esc(r?.error || 'Envoi impossible'), 'error'); return; }
        toast(r.joined ? 'Ce titre était déjà demandé : ta voix a été ajoutée' : 'Demande envoyée !', 'success');
        form.reset(); hint.hidden = true; title.focus();
        _renderRequests();
      });
    }
    _renderRequests(true);
  };

  const _renderRequests = async (markSeen = false) => {
    const body = $('requests-body'); if (!body) return;
    const d = await apiGet(isAdmin() ? '/api/admin/requests' : '/api/requests');
    if (!d?.requests) { body.innerHTML = '<div class="access-empty">Impossible de charger les demandes</div>'; return; }
    const list = d.requests;

    const row = (r, meta, actions) => `
      <div class="access-row req-row-item${r.unseen ? ' unseen' : ''}">
        <div class="access-avatar req-kind-badge" title="${_reqKind(r.kind)}">${r.kind === 'serie' ? 'S' : 'F'}</div>
        <div class="access-info">
          <div class="access-name">${_reqTitle(r)} ${r.status !== 'pending' || !isAdmin() ? _reqChip(r) : ''}${r.unseen ? ' <span class="req-new">Nouveau</span>' : ''}</div>
          <div class="access-meta">${meta}</div>
          ${r.note ? `<div class="access-msg">« ${esc(r.note)} »</div>` : ''}
          ${r.reply ? `<div class="req-reply"><b>${isAdmin() ? 'Ta réponse' : 'Réponse'} :</b> ${esc(r.reply)}</div>` : ''}
        </div>
        <div class="access-actions">${actions.map(([a,l,cls]) => `<button class="access-btn ${cls}" data-id="${esc(r.id)}" data-action="${a}">${l}</button>`).join('')}</div>
      </div>`;
    const group = (label, rows, empty) => (rows.length || empty)
      ? `<div class="access-group"><div class="access-group-title">${label} <span class="section-count">${rows.length}</span></div>${rows.join('') || `<div class="access-empty">${empty}</div>`}</div>`
      : '';
    const votes = r => r.votes > 1 ? ` · ${r.votes} personnes` : '';

    if (isAdmin()) {
      const pending = list.filter(r => r.status === 'pending').sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
      const done    = list.filter(r => r.status !== 'pending');
      body.innerHTML =
        group('À traiter', pending.map(r => row(r,
          `${_reqKind(r.kind)} · ${esc(r.requesters.join(', '))} · ${_fmtDate(r.createdAt)}`,
          [['added','Ajouté','primary'], ['refused','Refuser','']])), 'Aucune demande en attente')
        + group('Traitées', done.map(r => row(r,
          `${_reqKind(r.kind)} · ${esc(r.requesters.join(', '))} · ${_fmtDate(r.decidedAt)}`,
          [['pending','Remettre en attente',''], ['delete','Supprimer','danger']])));
    } else {
      const mine   = list.filter(r => r.mine);
      const others = list.filter(r => !r.mine);
      body.innerHTML =
        group('Mes demandes', mine.map(r => row(r,
          `${_reqKind(r.kind)} · ${r.status === 'pending' ? 'demandé le ' + _fmtDate(r.createdAt) : (r.status === 'added' ? 'ajouté' : 'refusé') + ' le ' + _fmtDate(r.decidedAt)}${votes(r)}`,
          r.status === 'pending' ? [['withdraw','Retirer','']] : r.status === 'added' && _inCatalog(r.title, r.kind) ? [['watch','Voir','primary']] : [])),
          'Aucune demande pour l\'instant')
        + group('Demandés par les autres', others.map(r => row(r,
          `${_reqKind(r.kind)} · ${r.votes} personne${r.votes > 1 ? 's' : ''}`,
          [['vote','Moi aussi','']])));
      if (markSeen && list.some(r => r.unseen)) apiPost('/api/requests/seen', {}).then(_refreshPendingBadge);
    }

    body.querySelectorAll('.access-btn').forEach(b => b.addEventListener('click', async () => {
      const { id, action } = b.dataset;
      const r = list.find(x => x.id === id); if (!r) return;
      if (action === 'watch') { $('modal-requests')?.remove(); _inCatalog(r.title, r.kind)?.open(); return; }
      let reply = '';
      if (action === 'refused' || action === 'added') {
        reply = prompt(action === 'refused'
          ? `Refuser « ${r.title} ». Un mot pour expliquer ? (facultatif)`
          : `« ${r.title} » est ajouté. Un mot pour ${r.votes > 1 ? 'les personnes qui l\'ont demandé' : 'la personne qui l\'a demandé'} ? (facultatif)`, '');
        if (reply === null) return;
      }
      if (action === 'delete' && !confirm(`Supprimer la demande « ${r.title} » ?`)) return;
      if (action === 'withdraw' && !confirm(`Retirer ta demande « ${r.title} » ?`)) return;
      b.disabled = true;
      const res = isAdmin()
        ? await apiPost('/api/admin/requests/decide', { id, action, reply })
        : await apiPost('/api/requests/' + action, { id });
      if (!res?.ok) { toast(esc(res?.error || 'Action impossible'), 'error'); b.disabled = false; return; }
      if (action === 'vote') toast('Ta voix a été ajoutée', 'success');
      _renderRequests(); _refreshPendingBadge();
    }));
  };

  // ── INIT ──
  const init=async ()=>{
    // Compte connecté — sinon retour à la page de connexion
    const me = await apiGet('/api/auth/me');
    if (!me?.user) { location.href = '/login'; return; }
    currentUser = me.user;
    document.body.classList.toggle('is-admin', isAdmin());
    _initAccountMenu();

    window.addEventListener('scroll',()=>$('navbar').classList.toggle('solid',window.scrollY>40),{passive:true});
    initPlayerControls();

    // Onglets
    $$('.nav-tab').forEach(tab=>{ tab.addEventListener('click',()=>{ window.scrollTo({ top:0, behavior:'instant' }); const s=tab.dataset.section; if(s==='home') goHome(); else if(s==='search-page') goSearchPage(); else goSection(s); if(window._syncMobileTab) window._syncMobileTab(s); }); });

    // Logo
    $('nav-logo').addEventListener('click',goHome);

    // Recherche (barre compacte navbar → va sur la page recherche et tape dedans)
    let st;
    $('nav-search-input').addEventListener('input',e=>{
      clearTimeout(st);
      const q=e.target.value;
      $('nav-search-clear').style.display=q?'flex':'none';
      st=setTimeout(()=>{
        if(!q){ return; }
        // Aller sur la page de recherche et y injecter la requête
        goSearchPage();
        setTimeout(()=>{
          const inp=$('search-dedicated-input');
          if(inp){ inp.value=q; inp.dispatchEvent(new Event('input')); }
        },120);
      },280);
    });
    $('nav-search-input').addEventListener('keydown',e=>{
      if(e.key==='Escape'){ $('nav-search-input').value=''; $('nav-search-clear').style.display='none'; renderPage(); }
      if(e.key==='Enter'){
        const q=$('nav-search-input').value.trim();
        if(q){ goSearchPage(); setTimeout(()=>{ const inp=$('search-dedicated-input'); if(inp){ inp.value=q; inp.dispatchEvent(new Event('input')); } },120); }
      }
    });
    $('nav-search-clear').addEventListener('click',()=>{ $('nav-search-input').value=''; $('nav-search-clear').style.display='none'; renderPage(); });

    // ── Export / Import ─────────────────────────────────────────────────────
    $('btn-transfer').addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'm-overlay open';
      overlay.style.zIndex = '500';
      overlay.innerHTML = `
        <div class="m-box" style="max-width:420px">
          <div class="m-head">
            <h2>DONNÉES MYFLIX</h2>
            <div class="m-close" id="transfer-close"><svg><use href="#ic-x"/></svg></div>
          </div>
          <div class="m-body" style="display:flex;flex-direction:column;gap:1rem">
            <p style="color:var(--text-3);font-size:12px;line-height:1.6">
              Exporte tes données depuis Chrome et importe-les dans Safari (ou l'inverse).
            </p>

            <!-- EXPORT -->
            <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:var(--r);padding:1rem">
              <div style="font-family:var(--font-b);font-size:12px;color:#fff;margin-bottom:.5rem">📤 Exporter</div>
              <p style="color:var(--text-3);font-size:11px;margin-bottom:.7rem">Génère un fichier de sauvegarde de tous tes films, séries et réglages.</p>
              <button id="btn-export" class="btn-submit" style="margin:0;width:100%">Télécharger la sauvegarde</button>
            </div>

            <!-- IMPORT -->
            <div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:var(--r);padding:1rem">
              <div style="font-family:var(--font-b);font-size:12px;color:#fff;margin-bottom:.5rem">📥 Importer</div>
              <p style="color:var(--text-3);font-size:11px;margin-bottom:.7rem">Charge un fichier de sauvegarde. <strong style="color:var(--accent)">Remplace toutes les données actuelles.</strong></p>
              <label style="display:block;width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:var(--r);padding:.65rem 1rem;font-family:var(--font-b);font-size:12px;color:var(--text-2);cursor:pointer;text-align:center;box-sizing:border-box">
                Choisir un fichier .json
                <input type="file" id="import-file" accept=".json" style="display:none">
              </label>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('#transfer-close').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

      // Export
      overlay.querySelector('#btn-export').addEventListener('click', () => {
        const data = {
          myflix_movies   : localStorage.getItem('myflix_movies'),
          myflix_series   : localStorage.getItem('myflix_series'),
          myflix_episodes : localStorage.getItem('myflix_episodes'),
          myflix_cats     : localStorage.getItem('myflix_cats'),
          myflix_featured : localStorage.getItem('myflix_featured'),
          myflix_sub_style: localStorage.getItem('myflix_sub_style'),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `myflix-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Sauvegarde téléchargée !', 'success');
      });

      // Import
      overlay.querySelector('#import-file').addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const data = JSON.parse(ev.target.result);
            if (!confirm('Importer cette sauvegarde ? Toutes les données actuelles seront remplacées.')) return;
            Object.entries(data).forEach(([k, v]) => {
              if (v !== null && v !== undefined) localStorage.setItem(k, v);
            });
            // Sauvegarder aussi sur le serveur
            fetch(`${API}/api/save`, {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify(data)
            }).catch(()=>{});
            overlay.remove();
            toast('Import réussi — rechargement…', 'success');
            setTimeout(() => location.reload(), 800);
          } catch(err) {
            toast('Fichier invalide', 'error');
          }
        };
        reader.readAsText(file);
      });
    });
    $('btn-add').addEventListener('click', () => {
      if (!serverOnline) {
        toast('Lance le serveur LANCER_MYFLIX.command d\'abord', 'error');
        return;
      }
      openFilePicker('film');
    });

    // File Picker modal
    $('modal-filepicker-close').addEventListener('click', () => closeModal('modal-filepicker'));
    $('modal-filepicker').addEventListener('click', e => { if (e.target === $('modal-filepicker')) closeModal('modal-filepicker'); });
    $('fp-search').addEventListener('input', e => {
      renderFilePickerList(_fpFiles, e.target.value);
    });

    // Modal add
    $('modal-add-close').addEventListener('click',closeAdd);
    $('modal-add').addEventListener('click',e=>{if(e.target===$('modal-add'))closeAdd();});
    $('submit-btn').addEventListener('click',submitForm);
    $('f-section').addEventListener('change',()=>{ renderGenrePicker($('f-section').value); renderCustomCatPicker(); });

    // Champs image — simple: nom du fichier dans images/
    const watchImgInput = (inputId, previewId, wrapId, field, onSet) => {
      const inp = $(inputId); if (!inp) return;
      inp.addEventListener('input', () => {
        const name = inp.value.trim();
        window[field] = name || null;
        const prev = $(previewId);
        if (prev && name) {
          prev.src = imgUrl(name); prev.style.display='block';
          if(wrapId&&$(wrapId)) $(wrapId).style.display='block';
          if(onSet) onSet(true);
        } else if (prev) {
          prev.style.display='none';
          if(onSet) onSet(false);
        }
      });
    };
    watchImgInput('f-poster-name', 'poster-img', null, '_poster', show => {
      const svgEl = $('poster-thumb')?.querySelector('svg');
      if (svgEl) svgEl.style.display = show ? 'none' : '';
    });
    watchImgInput('f-backdrop-name', 'backdrop-img',  'backdrop-preview-wrap', '_backdrop');
    watchImgInput('f-logo-name',     'logo-preview',  'logo-preview-wrap',     '_logo');

    // Rating
    $('f-rating').addEventListener('input',e=>{if(+e.target.value>10)e.target.value=10;if(+e.target.value<0)e.target.value=0;});

    // Nouvelle catégorie
    $('btn-create-cat').addEventListener('click',openNewCat);
    $('modal-newcat-close').addEventListener('click',closeNewCat);
    $('modal-newcat').addEventListener('click',e=>{if(e.target===$('modal-newcat'))closeNewCat();});
    $('newcat-confirm').addEventListener('click',confirmNewCat);

    // Disk
    $('modal-disk-close').addEventListener('click',closeDisk);
    $('modal-disk').addEventListener('click',e=>{if(e.target===$('modal-disk'))closeDisk();});
    $('disk-confirm-btn').addEventListener('click',confirmDisk);

    // Scan
    $('modal-scan-close').addEventListener('click',()=>closeModal('modal-scan'));
    $('modal-scan').addEventListener('click',e=>{if(e.target===$('modal-scan'))closeModal('modal-scan');});

    // Detail
    $('modal-detail').addEventListener('click',e=>{if(e.target===$('modal-detail'))closeDetail();});

    // Player
    $('player-close').addEventListener('click',closePlayer);

    // Series modal
    $('modal-series-close').addEventListener('click', ()=>closeModal('modal-series'));
    $('modal-series').addEventListener('click', e=>{ if(e.target===$('modal-series')) closeModal('modal-series'); });
    $('sf-section').addEventListener('change', ()=>renderSFGenrePicker($('sf-section').value));
    $('sf-submit').addEventListener('click', submitSeries);

    // SF poster/backdrop
    // Champs image série — nom de fichier dans images/
    const watchSfImg = (inputId, previewId, wrapId, onSet) => {
      const inp = $(inputId); if (!inp) return;
      inp.addEventListener('input', () => {
        const name = inp.value.trim();
        const prev = $(previewId);
        if (prev && name) {
          prev.src = imgUrl(name); prev.style.display = 'block';
          if (wrapId && $(wrapId)) $(wrapId).style.display = 'block';
          if (onSet) onSet(true);
        } else if (prev) {
          prev.style.display = 'none';
          if (onSet) onSet(false);
        }
      });
    };
    watchSfImg('sf-poster-name', 'sf-poster-img', null, show => {
      const svgEl = $('sf-poster-thumb')?.querySelector('svg');
      if (svgEl) svgEl.style.display = show ? 'none' : '';
    });
    watchSfImg('sf-backdrop-name', 'sf-backdrop-img', 'sf-backdrop-wrap');
    watchSfImg('sf-logo-name', 'sf-logo-img', 'sf-logo-wrap');

    // Episode modal
    $('modal-ep-close').addEventListener('click', ()=>closeModal('modal-episode'));
    $('modal-episode').addEventListener('click', e=>{ if(e.target===$('modal-episode')) closeModal('modal-episode'); });
    $('ep-submit').addEventListener('click', submitEpisode);
    $('ep-series-change').addEventListener('click', ()=>{
      epCurrentSeriesId=null;
      $('ep-series-selected').style.display='none';
      $('ep-series-search').style.display='';
      $('ep-series-search').value=''; $('ep-series-search').focus();
    });

    // Series search dropdown in episode modal
    $('ep-series-search').addEventListener('input', e=>{
      const q=e.target.value.trim().toLowerCase();
      const dropdown=$('ep-series-dropdown');
      const allSeries=SeriesManager.getAll();
      const filtered=q ? allSeries.filter(s=>s.title.toLowerCase().includes(q)) : allSeries;
      dropdown.innerHTML='';
      filtered.forEach(s=>{
        const ps=s.poster?(s.poster.startsWith('data:')||s.poster.startsWith('http')?s.poster:`${API}/media/${encodeURIComponent(s.poster)}`):null;
        const item=document.createElement('div'); item.className='ep-series-dropdown-item';
        item.innerHTML=`<div class="item-poster">${ps?`<img src="${esc(ps)}" alt="">`:''}</div><div class="item-info"><div class="item-title">${esc(s.title)}</div><div class="item-meta">${s.section==='anime'?'Anime':'Série'}${s.year?' · '+s.year:''}</div></div>`;
        item.addEventListener('click',()=>selectEpisodeSeries(s));
        dropdown.appendChild(item);
      });
      // Créer une nouvelle série
      const createItem=document.createElement('div'); createItem.className='ep-series-dropdown-create';
      createItem.innerHTML=`${svg('ic-plus')} Créer "${esc(e.target.value||'nouvelle série')}"`;
      createItem.addEventListener('click',()=>{
        dropdown.style.display='none';
        // Fermer le modal épisode avant d'ouvrir la création de série
        closeModal('modal-episode');
        setTimeout(()=>{
          openNewSeries({title:e.target.value, section:'series'});
        }, 200);
        window._pendingEpisodeFile=epCurrentFile;
        window._pendingEpisodeFileName=epCurrentFile?.name;
      });
      dropdown.appendChild(createItem);
      dropdown.style.display=filtered.length||e.target.value?'':'none';
      if(e.target.value||filtered.length) dropdown.style.display='';
    });
    $('ep-series-search').addEventListener('focus', e=>{
      e.target.dispatchEvent(new Event('input'));
    });
    document.addEventListener('click', e=>{
      if(!e.target.closest('#ep-series-pick-group')) $('ep-series-dropdown').style.display='none';
    });

    // Collections
    const mcClose = $('modal-collection-close');
    if (mcClose) mcClose.addEventListener('click', ()=>closeModal('modal-collection'));
    const mc = $('modal-collection');
    if (mc) mc.addEventListener('click', e=>{ if(e.target===mc) closeModal('modal-collection'); });
    const mcs = $('col-submit');
    if (mcs) mcs.addEventListener('click', submitCollection);
    const mcd = $('modal-collection-detail');
    if (mcd) mcd.addEventListener('click', e=>{ if(e.target===mcd) closeCollectionDetail(); });
    const watchImg = (inputId, imgId, wrapId) => {
      const inp=$(inputId); if(!inp) return;
      inp.addEventListener('input', ()=>{
        const v=inp.value.trim(); const img=$(imgId); const wrap=$(wrapId);
        if(img&&v){img.src=imgUrl(v);img.style.display='block';if(wrap)wrap.style.display='block';}
        else{if(img)img.style.display='none';if(wrap)wrap.style.display='none';}
      });
    };
    watchImg('col-logo-name','col-logo-img','col-logo-wrap');
    watchImg('col-backdrop-name','col-backdrop-img','col-backdrop-wrap');
    _initColFilmSearch();

    // Series detail
    $('modal-series-detail').addEventListener('click', e=>{ if(e.target===$('modal-series-detail')) closeSeriesDetail(); });

    // Escape
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape') return;
      if($('player-wrap').classList.contains('open')) closePlayer();
      else if($('modal-detail').classList.contains('open')) closeDetail();
      else if($('modal-add').classList.contains('open')) closeAdd();
      else if($('modal-disk').classList.contains('open')) closeDisk();
      else if($('modal-scan').classList.contains('open')) closeModal('modal-scan');
      else if($('modal-newcat').classList.contains('open')) closeNewCat();
      else if($('modal-series').classList.contains('open')) closeModal('modal-series');
      else if($('modal-episode').classList.contains('open')) closeModal('modal-episode');
      else if($('modal-filepicker').classList.contains('open')) closeModal('modal-filepicker');
      else if($('modal-series-flow').classList.contains('open')) closeSeriesFlow();
      else if($('modal-collection')?.classList.contains('open')) closeModal('modal-collection');
      else if($('modal-collection-detail')?.classList.contains('open')) closeCollectionDetail();
      else if(document.getElementById('modal-type-choice')) document.getElementById('modal-type-choice').remove();
    });

    // Barre de navigation mobile flottante
    const mobileBar = document.getElementById('mobile-tab-bar');
    const isMobile = () => window.innerWidth <= 500;
    const showMobileBar = () => { if (mobileBar) mobileBar.style.display = isMobile() ? 'flex' : 'none'; };
    showMobileBar();
    window.addEventListener('resize', showMobileBar);

    document.querySelectorAll('.mob-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const sec = tab.dataset.section;
        document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (sec === 'home') goHome();
        else goSection(sec);
      });
    });

    // Sync barre mobile avec la navigation principale
    const _syncMobileTab = (sec) => {
      document.querySelectorAll('.mob-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.section === sec)
      );
    };
    window._syncMobileTab = _syncMobileTab;

    // Charger les données (serveur → localStorage fallback) puis afficher
    await _loadData();
    checkServer(); setInterval(checkServer, 15000);
    _initTheme();
    _ss.init();
    _grid.init();

    // ── Halo de bordure hero ──────────────────────────────
    const heroEl    = document.getElementById('hero');
    const heroBorderGlow = document.getElementById('hero-border-glow');
    if (heroEl && heroBorderGlow) {
      // Approche canvas : dessiner la bordure lumineuse directement sur un canvas overlay
      heroBorderGlow.style.cssText = 'position:absolute;inset:0;border-radius:20px;pointer-events:none;z-index:10;';
      const heroBorderCanvas = document.createElement('canvas');
      heroBorderCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:20px;pointer-events:none;z-index:10;';
      heroEl.appendChild(heroBorderCanvas);

      const drawBorder = (mx, my) => {
        const rect = heroEl.getBoundingClientRect();
        heroBorderCanvas.width  = rect.width;
        heroBorderCanvas.height = rect.height;
        const ctx = heroBorderCanvas.getContext('2d');
        const W = rect.width, H = rect.height, r = 20;
        const rgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '229,9,20';

        ctx.clearRect(0, 0, W, H);

        // Tracer le contour arrondi de la carte
        const path = new Path2D();
        const R2 = Math.min(40, heroEl.offsetWidth * 0.05);
        path.moveTo(R2, 0);
        path.lineTo(W-R2, 0);
        path.arcTo(W, 0, W, R2, R2);
        path.lineTo(W, H-R2);
        path.arcTo(W, H, W-R2, H, R2);
        path.lineTo(R2, H);
        path.arcTo(0, H, 0, H-R2, R2);
        path.lineTo(0, R2);
        path.arcTo(0, 0, R2, 0, R2);
        path.closePath();

        // Gradient radial centré sur la souris pour colorer le trait
        const x = mx - rect.left, y = my - rect.top;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, 220);
        grad.addColorStop(0,   'rgba(' + rgb + ',.75)');
        grad.addColorStop(0.5, 'rgba(' + rgb + ',.2)');
        grad.addColorStop(1,   'rgba(255,255,255,.06)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke(path);
      };

      heroEl.addEventListener('mousemove', (e) => drawBorder(e.clientX, e.clientY));
      heroEl.addEventListener('mouseleave', () => {
        const ctx = heroBorderCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, heroBorderCanvas.width, heroBorderCanvas.height);
        // Dessiner la bordure grise au repos
        const rect = heroEl.getBoundingClientRect();
        heroBorderCanvas.width  = rect.width;
        heroBorderCanvas.height = rect.height;
        const W = rect.width, H = rect.height, rv = 20;
        const path = new Path2D();
        path.moveTo(rv,0); path.lineTo(W-rv,0); path.arcTo(W,0,W,rv,rv);
        path.lineTo(W,H-rv); path.arcTo(W,H,W-rv,H,rv);
        path.lineTo(rv,H); path.arcTo(0,H,0,H-rv,rv);
        path.lineTo(0,rv); path.arcTo(0,0,rv,0,rv); path.closePath();
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.lineWidth = 1;
        ctx.stroke(path);
      });
    }
    if (_settings.get('lowQuality')) {
      _applyLowQuality(true);
    } else {
      if (_settings.get('gridEnabled')) _grid.enable();
      if (_settings.get('haloEnabled')) _grid.enableHalo(); else _grid.disableHalo();
    }
    goHome();
  };

  return { init, goHome, goSection, goGenre, goCustomCat, goSearchPage, doSearch,
    _setSort, _flushSaveNow,
    setAudioTrack: ()=>{}, // géré nativement via audioTracks dans loadTracks
    loadSubtitle, clearSubtitles,
    openSubStyle, _subStyleColor, _subStyleToggle, _subStyleReset,
    openAdd, openEdit, closeAdd, openDisk, closeDisk, pickVol, confirmDisk, scanDisk, fromScan,
    toggleAnimeField, toggleAnimationField,
    openFilePicker, pickFile, fpSwitchDisk,
    openTypeChoice, openAddEpisodeFlow, closeSeriesFlow,
    _flowTabSwitch, _flowSelectSeries, _flowStep1Next, _flowRefreshGenres,
    _flowBackToStep1, _flowSaveEpisode,
    openFeaturedEditor, _fePickSlot, _feRemove,
    deleteCustomCat, toggleFav,
    showSeriesDetail, closeSeriesDetail, toggleSeriesFav, deleteSeries, deleteEpisode, deleteSeasonEpisodes, editEpisode, _epEditChooseFile,
    openAddEpisodeForSeries, openBulkImport, openNewSeries, openEditSeries, toggleSeason, playEpisode,
    _getAdjacentEpisode, _updateEpNavButtons,
    play, closePlayer, _playFromStart, showDetail, closeDetail, confirmDelete, hideEndScreen,
    openSettings, closeSettings, openAccessPanel, openRequestsPanel, logout,
    openNewCollection, openEditCollection, submitCollection, deleteCollection,
    showCollectionDetail, closeCollectionDetail, _colRemoveFilm };
})();

window.addEventListener('DOMContentLoaded', App.init);

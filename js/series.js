// ─── MYFLIX SÉRIES ────────────────────────────────────────────────────────────
const SeriesManager = (() => {

  let series   = JSON.parse(localStorage.getItem('myflix_series')   || '[]');
  let episodes = JSON.parse(localStorage.getItem('myflix_episodes') || '[]');

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

  // Même origine que la page — même logique que app.js
  const _api = '';

  // Sauvegarde complète immédiate sur le serveur
  const _saveToServer = () => {
    // Mettre à jour localStorage en premier pour que les autres modules lisent à jour
    localStorage.setItem('myflix_series',   JSON.stringify(series));
    localStorage.setItem('myflix_episodes', JSON.stringify(episodes));
    const payload = {
      myflix_movies      : localStorage.getItem('myflix_movies')       || '[]',
      myflix_series      : JSON.stringify(series),
      myflix_episodes    : JSON.stringify(episodes),
      myflix_cats        : localStorage.getItem('myflix_cats')         || '[]',
      myflix_collections : localStorage.getItem('myflix_collections')  || '[]',
      myflix_directors   : localStorage.getItem('myflix_directors')    || '{}',
      myflix_featured    : localStorage.getItem('myflix_featured')     || '[]',
      myflix_progress    : localStorage.getItem('myflix_progress')     || '{}',
      myflix_sub_style   : localStorage.getItem('myflix_sub_style')    || '{}',
    };
    // Envoyer au serveur (sans attendre)
    fetch(`${_api}/api/save`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload),
    }).catch(() => {});
  };

  // Recharger depuis localStorage (appelé par _loadData après hydratation)
  const loadFromStorage = () => {
    series   = JSON.parse(localStorage.getItem('myflix_series')   || '[]');
    episodes = JSON.parse(localStorage.getItem('myflix_episodes') || '[]');
  };

  // ── GETTERS ──────────────────────────────────────────────────────────────────
  const getAll        = ()    => series;
  const getById       = id    => series.find(s => s.id === id);
  const getEpisodes   = sid   => episodes.filter(e => e.seriesId === sid)
                                          .sort((a,b) => a.season - b.season || a.episode - b.episode);
  const getBySeason   = (sid) => {
    const seasons = {};
    getEpisodes(sid).forEach(e => {
      if (!seasons[e.season]) seasons[e.season] = [];
      seasons[e.season].push(e);
    });
    return seasons;
  };
  const getBySection  = sec   => series.filter(s => s.section === sec);
  const countEpisodes = sid   => episodes.filter(e => e.seriesId === sid).length;

  // ── SÉRIES ────────────────────────────────────────────────────────────────────
  const createSeries = (data) => {
    const s = {
      id         : uid(),
      title      : data.title       || 'Sans titre',
      section    : data.section     || 'series',
      isAnime    : data.isAnime     || false,
      genres     : data.genres      || [],
      description: data.description || '',
      poster     : data.poster      || null,
      backdrop   : data.backdrop    || null,
      logo       : data.logo        || null,
      rating     : data.rating      || '',
      year       : data.year        || '',
      noSeason   : data.noSeason    || false,
      favorite   : false,
      addedAt    : Date.now(),
      updatedAt  : Date.now(),
    };
    series.unshift(s);
    _saveToServer();
    return s;
  };

  const updateSeries = (id, data) => {
    const idx = series.findIndex(s => s.id === id);
    if (idx === -1) return null;
    series[idx] = { ...series[idx], ...data, updatedAt: Date.now() };
    _saveToServer();
    return series[idx];
  };

  const deleteSeries = (id) => {
    series   = series.filter(s => s.id !== id);
    episodes = episodes.filter(e => e.seriesId !== id);
    _saveToServer();
  };

  const toggleFav = (id) => {
    const s = series.find(s => s.id === id);
    if (!s) return;
    s.favorite = !s.favorite;
    _saveToServer();
    return s.favorite;
  };

  // ── ÉPISODES ──────────────────────────────────────────────────────────────────
  const addEpisode = (data) => {
    const ep = {
      id          : uid(),
      seriesId    : data.seriesId,
      season      : parseInt(data.season)  || 1,
      episode     : parseInt(data.episode) || 1,
      title       : data.title       || `Épisode ${data.episode}`,
      videoRef    : data.videoRef    || null,
      thumb       : data.thumb       || null,
      description : data.description || '',
      duration    : data.duration    || '',
      addedAt     : Date.now(),
    };
    episodes.push(ep);
    _saveToServer();
    return ep;
  };

  const updateEpisode = (id, data) => {
    const idx = episodes.findIndex(e => e.id === id);
    if (idx === -1) return null;
    episodes[idx] = { ...episodes[idx], ...data };
    _saveToServer();
    return episodes[idx];
  };

  const deleteEpisode = (id) => {
    episodes = episodes.filter(e => e.id !== id);
    _saveToServer();
  };

  const episodeExists = (sid, season, episode) =>
    episodes.some(e => e.seriesId === sid && e.season === season && e.episode === episode);

  return {
    getAll, getById, getEpisodes, getBySeason, getBySection, countEpisodes,
    loadFromStorage,
    createSeries, updateSeries, deleteSeries, toggleFav,
    addEpisode, updateEpisode, deleteEpisode, episodeExists,
    get series()   { return series;   },
    get episodes() { return episodes; },
  };
})();

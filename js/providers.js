/*
  providers.js — external games providers for sienna (gn-math, Lumin).

  gn-math's games are raw .html files on jsDelivr. Browsers render those as plain
  text instead of running them, so night.js asks this module for the game's HTML
  and opens it from a blob URL (same trick gn-math itself uses). Everything else —
  grid, search, favorites, game window — is night.'s own.

  Loaded before js/sienna.js; siennaSettings.applyGamesProvider() calls apply().
*/
(function () {
  'use strict';

  // freebuisness is the primary source, gn-math is the mirror.
  const MIRRORS = [
    {
      zones: 'https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json',
      covers: 'https://cdn.jsdelivr.net/gh/freebuisness/covers@main',
      html: 'https://cdn.jsdelivr.net/gh/freebuisness/html@main',
    },
    {
      zones: 'https://cdn.jsdelivr.net/gh/gn-math/assets@main/zones.json',
      covers: 'https://cdn.jsdelivr.net/gh/gn-math/covers@main',
      html: 'https://cdn.jsdelivr.net/gh/gn-math/html@main',
    },
  ];

  const LUMIN = {
    sectionId: 'lumin-section',
    mountId: 'games',
    script: 'https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js',
  };

  let activeProvider = 'night.';
  let library = null; // mapped gn-math games
  const htmlCache = new Map();

  // '{HTML_URL}/game/index.html' → '<mirror>/game/index.html'
  function assetUrl(path, base) {
    const value = String(path || '').trim();
    if (!value) return '';
    const resolved = value.replace('{COVER_URL}', base).replace('{HTML_URL}', base);
    return /^[a-z][a-z\d+.-]*:/i.test(resolved)
      ? resolved
      : `${base.replace(/\/+$/, '')}/${resolved.replace(/^\/+/, '')}`;
  }

  // Try each source until one answers.
  async function fetchFirst(urls, type) {
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const value = await (type === 'json' ? response.json() : response.text());
        if (!value) continue;
        if (type === 'text' && /Couldn't find/i.test(value.slice(0, 200))) continue;
        return value;
      } catch (error) {
        // Mirror is unreachable, try the next one.
      }
    }
    return null;
  }

  async function loadGames() {
    if (library) return library;
    const zones = await fetchFirst(MIRRORS.map((mirror) => mirror.zones), 'json');
    if (!Array.isArray(zones)) throw new Error('gn-math library unavailable');
    const seen = new Set();
    library = zones
      .map((game, index) => {
        const url = assetUrl(game?.url, MIRRORS[0].html);
        if (!url || seen.has(url)) return null;
        seen.add(url);
        return {
          name: String(game.name || `gn-math ${index + 1}`).trim(),
          image: assetUrl(game.cover, MIRRORS[0].covers),
          url,
          section: game.special?.[0] || 'gn-math',
          author: game.author || '',
          _provider: 'gn-math',
        };
      })
      .filter(Boolean);
    return library;
  }

  // Game HTML, primary mirror first. night.js turns this into a blob URL.
  async function gameHtml(game) {
    if (!game?._provider || !game.url) return '';
    if (htmlCache.has(game.url)) return htmlCache.get(game.url);
    const mirrorUrl = game.url.replace(MIRRORS[0].html, MIRRORS[1].html);
    const html = await fetchFirst([game.url, mirrorUrl], 'text');
    if (html) htmlCache.set(game.url, html);
    return html || '';
  }

  async function download(game) {
    const html = game?.html || (await gameHtml(game));
    if (!html) return false;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    link.download = `${String(game.name || 'game').replace(/[^\w-]+/g, '_')}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }

  // ── night. view helpers ──
  function setNightVisible(visible) {
    const display = visible ? '' : 'none';
    ['browseGrid', 'favoritesSection', 'featured', 'featuredDots'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = display;
    });
    document.querySelectorAll('.browse-top, .grid-section-label').forEach((el) => {
      el.style.display = display;
    });
  }

  // night.'s "Viewing [All Games / All Apps]" picker only applies to its own
  // library, so it is hidden while a provider's games are loaded.
  function setCategoryPickerVisible(visible) {
    const heading = document.querySelector('.browse-heading');
    if (heading) heading.style.display = visible ? '' : 'none';
  }

  // Status line in the grid; also works before night.js has booted.
  function showGridMessage(text) {
    if (window.nightLibrary) {
      window.nightLibrary.showMessage(text);
      return;
    }
    const grid = document.getElementById('browseGrid');
    if (grid) grid.innerHTML = `<p class="browse-empty">${text}</p>`;
    const label = document.getElementById('titlesCount');
    if (label) label.textContent = text;
  }

  function waitForNight(callback) {
    if (window.nightLibrary) {
      callback();
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      if (window.nightLibrary) {
        clearInterval(timer);
        callback();
      } else if (++tries > 120) {
        clearInterval(timer);
      }
    }, 50);
  }

  // Lumin still renders with its own SDK. Moving it onto the night. grid later
  // only needs a load()/map() pair like gn-math has.
  function mountLumin(host) {
    let section = document.getElementById(LUMIN.sectionId);
    if (!section) {
      section = document.createElement('section');
      section.id = LUMIN.sectionId;
      section.style.cssText = 'position:absolute;inset:0;z-index:10;background:#000;margin:24px;border-radius:18px;overflow:hidden;';
      section.innerHTML = `<div id="${LUMIN.mountId}" class="lumin-games" style="width:100%;height:100%;min-height:680px;"></div>`;
      host.appendChild(section);
    }
    const init = () => window.Lumin?.init?.({ container: `#${LUMIN.mountId}`, theme: 'dark', columns: 12, gamesPerPage: 60 });
    if (window.Lumin) {
      init();
      return;
    }
    if (document.querySelector('script[data-sienna-provider="lumin"]')) return;
    const script = document.createElement('script');
    script.src = LUMIN.script;
    script.async = true;
    script.dataset.siennaProvider = 'lumin';
    script.addEventListener('load', init);
    document.head.appendChild(script);
  }

  function apply(provider, options = {}) {
    activeProvider = provider === 'gn-math' || provider === 'Lumin' ? provider : 'night.';
    const request = activeProvider;
    const host = options.host || document.getElementById('page-browse') || document.body;

    // Legacy provider containers from older builds.
    document.getElementById('gnmath-section')?.remove();

    if (request === 'Lumin') {
      setNightVisible(false);
      mountLumin(host);
      return;
    }

    document.getElementById(LUMIN.sectionId)?.remove();
    setNightVisible(true);
    setCategoryPickerVisible(request === 'night.');

    if (request === 'night.') {
      waitForNight(() => window.nightLibrary.restore());
      return;
    }

    showGridMessage('Loading gn-math games…');
    waitForNight(() => {
      if (activeProvider !== request) return; // switched away while waiting
      loadGames()
        .then((games) => {
          if (activeProvider === request) window.nightLibrary.setGames(games, { label: 'gn-math' });
        })
        .catch((error) => {
          console.error('providers: failed to load gn-math games', error);
          if (activeProvider === request) {
            window.nightLibrary.showMessage('gn-math games failed to load. Pick another provider in Settings.');
          }
        });
    });
  }

  window.siennaProviders = {
    apply,
    // Game HTML to run from a blob URL (empty string when not a provider game).
    gameHtml,
    supportsDownload: (game) => Boolean(game?._provider) || typeof game?.html === 'string',
    download,
  };
})();

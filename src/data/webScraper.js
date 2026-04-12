const axios   = require('axios');
const cheerio = require('cheerio');
const { scrapingSources } = require('../../config/config');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

function getSource(name) {
  return scrapingSources.find((s) => s.name === name);
}

// "Rafael Nadal" → "RafaelNadal"
function toTennisAbstractSlug(name) {
  return name.replace(/\s+/g, '');
}

// "Rafael Nadal" → "rafael-nadal"
function toSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// "Rafael Nadal" → "Rafael%20Nadal"
function toUrlEncoded(name) {
  return encodeURIComponent(name);
}

/**
 * Récupère le HTML d'une URL et retourne un objet cheerio.
 * Retourne null sans lever d'exception si la requête échoue.
 */
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: HTTP_HEADERS,
      timeout: 12000,
    });
    return cheerio.load(response.data);
  } catch (err) {
    return null;
  }
}

// ─── Tables de normalisation ───────────────────────────────────────────────────

const GS_NAMES = new Set([
  'australian open', 'roland garros', 'french open',
  'wimbledon', 'us open',
]);

const MASTERS_NAMES = new Set([
  'indian wells', 'miami', 'monte-carlo', 'monte carlo', 'madrid',
  'rome', 'canada', 'montreal', 'toronto', 'cincinnati', 'shanghai', 'paris',
  'bnp paribas open', 'miami open', 'rolex monte-carlo masters',
  'mutua madrid open', 'internazionali bnl d\'italia', 'western & southern open',
  'canadian open', 'rolex paris masters',
]);

const ATP500_NAMES = new Set([
  'rotterdam', 'dubai', 'acapulco', 'barcelona', 'hamburg', 'washington',
  'beijing', 'tokyo', 'vienna', 'basel', 'halle', "queen's club", "queen's",
]);

/** Déduit le niveau ATP à partir du nom du tournoi. */
function normalizeLevel(tournamentName) {
  const t = (tournamentName ?? '').toLowerCase().trim();
  if (GS_NAMES.has(t))      return 'GS';
  if (MASTERS_NAMES.has(t)) return 'Masters';
  if (ATP500_NAMES.has(t))  return 'ATP500';
  return 'ATP250'; // défaut si inconnu
}

/** Normalise le nom de surface vers nos valeurs standards. */
function normalizeSurface(raw) {
  const s = (raw ?? '').toLowerCase().trim();
  if (s.includes('clay'))             return 'clay';
  if (s.includes('indoor') && s.includes('hard')) return 'indoor_hard';
  if (s.includes('hard'))             return 'hard';
  if (s.includes('grass'))            return 'grass';
  if (s.includes('carpet'))           return 'indoor_hard'; // carpet → indoor_hard
  return null;
}

/** Extrait le nombre de sets joués à partir du score textuel. */
function nbSetsFromScore(score) {
  if (!score) return null;
  const sets = score.trim().split(/\s+/);
  return sets.length >= 2 ? sets.length : null;
}

// ─── Scrapers source-spécifiques (privés) ─────────────────────────────────────

/**
 * TennisAbstract : historique de matchs d'un joueur.
 * URL : https://www.tennisabstract.com/cgi-bin/player.cgi?p=RafaelNadal
 *
 * Structure HTML attendue :
 *   <table id="matches"> ou <table class="matches">
 *   Colonnes (ordre typique) :
 *     0=Date, 1=Tournoi, 2=Surface, 3=Tour, 4=Adversaire,
 *     5=Classement adv, 6=Score, 7=Résultat (W/L)
 */
async function scrapeFromTennisAbstract(playerName) {
  const src  = getSource('TennisAbstract');
  const url  = `${src.baseUrl}${toTennisAbstractSlug(playerName)}`;
  console.log(`[Scraper] TennisAbstract → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  const matches = [];

  // TennisAbstract génère un tableau JS interne — on cherche les lignes <tr>
  // avec les classes "win" ou "loss" (structure observée sur le site)
  $('tr.win, tr.loss').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const rawDate    = $(cells[0]).text().trim();
    const rawTournoi = $(cells[1]).text().trim();
    const rawSurface = $(cells[2]).text().trim();
    const rawTour    = $(cells[3]).text().trim();
    const rawAdv     = $(cells[4]).text().trim();
    const rawRang    = $(cells[5]).text().trim();
    const rawScore   = $(cells[6]).text().trim();
    const isWin      = $(row).hasClass('win');

    if (!rawDate || !rawAdv) return;

    matches.push({
      date:           rawDate.substring(0, 10),   // YYYY-MM-DD
      tournoi:        rawTournoi,
      niveau:         normalizeLevel(rawTournoi),
      surface:        normalizeSurface(rawSurface),
      tour:           rawTour.toUpperCase(),
      adversaire:     rawAdv,
      rangAdversaire: parseInt(rawRang, 10) || null,
      resultat:       isWin ? 'V' : 'D',
      score:          rawScore,
      nbSets:         nbSetsFromScore(rawScore),
    });
  });

  if (matches.length === 0) {
    console.log('[Scraper] TennisAbstract — aucune ligne extraite (structure HTML peut-être modifiée)');
    return null;
  }

  return matches;
}

/**
 * TennisRatio : historique de matchs d'un joueur.
 * URL : https://www.tennisratio.com/players/rafael-nadal
 *
 * Structure HTML attendue :
 *   <table class="table"> ou <table id="matchHistory">
 *   Colonnes typiques : Date, Tournoi, Surface, Round, Adversaire, Score, Résultat
 */
async function scrapeFromTennisRatio(playerName) {
  const src = getSource('TennisRatio');
  const url = `${src.baseUrl}${toSlug(playerName)}`;
  console.log(`[Scraper] TennisRatio → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  const matches = [];

  // TODO: ajuster les sélecteurs selon la structure réelle du site
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return;

    const rawDate    = $(cells[0]).text().trim();
    const rawTournoi = $(cells[1]).text().trim();
    const rawSurface = $(cells[2]).text().trim();
    const rawTour    = $(cells[3]).text().trim();
    const rawAdv     = $(cells[4]).text().trim();
    const rawScore   = $(cells[5]).text().trim();
    const rawResult  = $(cells[6])?.text().trim() ?? '';

    if (!rawDate || !rawAdv) return;

    matches.push({
      date:           rawDate.substring(0, 10),
      tournoi:        rawTournoi,
      niveau:         normalizeLevel(rawTournoi),
      surface:        normalizeSurface(rawSurface),
      tour:           rawTour.toUpperCase(),
      adversaire:     rawAdv,
      rangAdversaire: null,
      resultat:       rawResult.toUpperCase().startsWith('W') ? 'V' : 'D',
      score:          rawScore,
      nbSets:         nbSetsFromScore(rawScore),
    });
  });

  if (matches.length === 0) return null;
  return matches;
}

/**
 * ATPTour : historique de matchs d'un joueur.
 * URL : https://www.atptour.com/en/players/rafael-nadal/n409/match-results
 *
 * ATTENTION : le site charge via JavaScript (Backbone.js).
 * Le HTML initial contient parfois un tableau <table id="player-match-results-ajax">.
 * Si vide → retourne null (pas de puppeteer disponible ici).
 */
async function scrapeFromATPTour(playerName) {
  const src  = getSource('ATPTour');
  const slug = toSlug(playerName);
  // L'ID ATP n'est pas connu → on tente un slug générique
  const url  = `${src.baseUrl}${slug}/0000/match-results`;
  console.log(`[Scraper] ATPTour → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  const matches = [];

  // Tableau rendu côté serveur (quand disponible)
  $('#player-match-results-ajax tbody tr, .match-results tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const rawDate    = $(cells[0]).text().trim();
    const rawTournoi = $(cells[1]).text().trim();
    const rawTour    = $(cells[2]).text().trim();
    const rawAdv     = $(cells[3]).text().trim();
    const rawScore   = $(cells[4]).text().trim();

    if (!rawDate || !rawAdv) return;

    const isWin = rawScore && !rawScore.toLowerCase().includes('ret') &&
                  !rawScore.toLowerCase().includes('walkover');

    matches.push({
      date:           rawDate.substring(0, 10),
      tournoi:        rawTournoi,
      niveau:         normalizeLevel(rawTournoi),
      surface:        null, // non disponible dans ce tableau
      tour:           rawTour.toUpperCase(),
      adversaire:     rawAdv,
      rangAdversaire: null,
      resultat:       isWin ? 'V' : 'D',
      score:          rawScore,
      nbSets:         nbSetsFromScore(rawScore),
    });
  });

  if (matches.length === 0) return null;
  return matches;
}

/**
 * TennisRatio : stats sur une surface pour un joueur.
 * URL : https://www.tennisratio.com/players/rafael-nadal
 *
 * Structure HTML attendue :
 *   Section ou tableau avec stats par surface : V/D, %, titres, finales
 *
 * TODO: ajuster les sélecteurs selon la structure réelle du site
 */
async function scrapeSurfaceFromTennisRatio(playerName, surface) {
  const src = getSource('TennisRatio');
  const url = `${src.baseUrl}${toSlug(playerName)}`;
  console.log(`[Scraper] TennisRatio surface stats → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  let targetRow = null;
  const surfaceLabel = surface.replace('_', ' '); // indoor_hard → "indoor hard"

  // Cherche la ligne du tableau correspondant à la surface
  $('table tr').each((_, row) => {
    const cells = $(row).find('td, th');
    const label = $(cells[0]).text().trim().toLowerCase();
    if (label.includes(surfaceLabel) || normalizeSurface(label) === surface) {
      targetRow = cells;
    }
  });

  if (!targetRow) {
    console.log(`[Scraper] TennisRatio — surface "${surface}" non trouvée`);
    return null;
  }

  const getText = (i) => $(targetRow[i])?.text().trim() ?? null;
  const victories = parseInt(getText(1), 10);
  const defeats   = parseInt(getText(2), 10);
  const total     = victories + defeats;

  return {
    victoires: isNaN(victories) ? null : victories,
    defaites:  isNaN(defeats)   ? null : defeats,
    pct:       total > 0 ? Math.round((victories / total) * 100) : null,
    titres:    parseInt(getText(3), 10) || null,
    finales:   parseInt(getText(4), 10) || null,
  };
}

/**
 * UltimateTennisStatistics : % tie-breaks gagnés.
 * URL : https://www.ultimatetennisstatistics.com/playerProfile?name=Rafael%20Nadal
 *
 * Le site charge ses statistiques via AJAX (/playerStatisticsTable).
 * On tente de lire le HTML statique de la page de profil si des données
 * sont intégrées dans le rendu initial.
 *
 * TODO: si le site est full-AJAX, remplacer par un appel direct à l'API interne :
 *   GET /playerStatisticsTable?playerId=...&tab=statistics
 */
async function scrapeTiebreaksFromUTS(playerName) {
  const src = getSource('UltimateTennisStatistics');
  const url = `${src.baseUrl}${toUrlEncoded(playerName)}`;
  console.log(`[Scraper] UltimateTennisStatistics tiebreaks → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  let pct = null;

  // Cherche un élément contenant "tie-break" + un pourcentage
  $('*').each((_, el) => {
    const text = $(el).text().toLowerCase();
    if (text.includes('tie-break') || text.includes('tiebreak')) {
      const match = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
      if (match) {
        pct = parseFloat(match[1].replace(',', '.'));
        return false; // stop iteration
      }
    }
  });

  if (pct === null) {
    console.log('[Scraper] UltimateTennisStatistics — % tie-breaks non trouvé dans le HTML statique');
    return null;
  }

  return { pctTiebreaks: pct };
}

/**
 * UltimateTennisStatistics : % 3e sets gagnés (deciding sets).
 * Même URL que tiebreaks — on extrait depuis la même page.
 *
 * TODO: ajuster le sélecteur si la donnée est chargée en AJAX.
 */
async function scrapeDecidingSetsFromUTS(playerName) {
  const src = getSource('UltimateTennisStatistics');
  const url = `${src.baseUrl}${toUrlEncoded(playerName)}`;
  console.log(`[Scraper] UltimateTennisStatistics deciding sets → ${url}`);

  const $ = await fetchHtml(url);
  if (!$) return null;

  let pct = null;

  $('*').each((_, el) => {
    const text = $(el).text().toLowerCase();
    if (
      text.includes('deciding set') ||
      text.includes('3rd set') ||
      text.includes('troisième set') ||
      text.includes('5th set') // pour GS
    ) {
      const match = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
      if (match) {
        pct = parseFloat(match[1].replace(',', '.'));
        return false;
      }
    }
  });

  if (pct === null) {
    console.log('[Scraper] UltimateTennisStatistics — % deciding sets non trouvé dans le HTML statique');
    return null;
  }

  return { pctDecidingSets: pct };
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * 1. Historique de matchs — fallback TennisAbstract → TennisRatio → ATPTour.
 * Retourne null si toutes les sources échouent.
 */
async function scrapePlayerHistory(playerName) {
  const sources = [
    { label: 'TennisAbstract', fn: () => scrapeFromTennisAbstract(playerName) },
    { label: 'TennisRatio',    fn: () => scrapeFromTennisRatio(playerName) },
    { label: 'ATPTour',        fn: () => scrapeFromATPTour(playerName) },
  ];

  for (const { label, fn } of sources) {
    let result = null;
    try {
      result = await fn();
    } catch (err) {
      console.error(`[Scraper] ${label} — erreur inattendue : ${err.message}`);
    }

    if (result && result.length > 0) {
      console.log(`[Scraper] Historique "${playerName}" obtenu via ${label} (${result.length} match(s))`);
      return result;
    }

    console.log(`[Scraper] ${label} — échec ou données vides, passage à la source suivante`);
  }

  console.error(`[Scraper] Toutes les sources ont échoué pour "${playerName}"`);
  return null;
}

/**
 * 2. Stats surface carrière — TennisRatio uniquement.
 * Retourne null si la source échoue.
 */
async function scrapePlayerSurfaceStats(playerName, surface) {
  let result = null;
  try {
    result = await scrapeSurfaceFromTennisRatio(playerName, surface);
  } catch (err) {
    console.error(`[Scraper] TennisRatio surface — erreur inattendue : ${err.message}`);
  }

  if (!result) {
    console.error(`[Scraper] Stats surface "${surface}" non disponibles pour "${playerName}"`);
    return null;
  }

  console.log(`[Scraper] Stats surface "${surface}" de "${playerName}" obtenues via TennisRatio`);
  return result;
}

/**
 * 3. % tie-breaks gagnés — UltimateTennisStatistics.
 * Retourne null si la source échoue.
 */
async function scrapePlayerTiebreakStats(playerName) {
  let result = null;
  try {
    result = await scrapeTiebreaksFromUTS(playerName);
  } catch (err) {
    console.error(`[Scraper] UltimateTennisStatistics tiebreaks — erreur inattendue : ${err.message}`);
  }

  if (!result) {
    console.error(`[Scraper] % tie-breaks non disponible pour "${playerName}"`);
    return null;
  }

  console.log(`[Scraper] % tie-breaks de "${playerName}" obtenu via UltimateTennisStatistics`);
  return result;
}

/**
 * 4. % 3e sets gagnés — UltimateTennisStatistics.
 * Retourne null si la source échoue.
 */
async function scrapePlayerDecidingSetStats(playerName) {
  let result = null;
  try {
    result = await scrapeDecidingSetsFromUTS(playerName);
  } catch (err) {
    console.error(`[Scraper] UltimateTennisStatistics deciding sets — erreur inattendue : ${err.message}`);
  }

  if (!result) {
    console.error(`[Scraper] % deciding sets non disponible pour "${playerName}"`);
    return null;
  }

  console.log(`[Scraper] % deciding sets de "${playerName}" obtenu via UltimateTennisStatistics`);
  return result;
}

module.exports = {
  scrapePlayerHistory,
  scrapePlayerSurfaceStats,
  scrapePlayerTiebreakStats,
  scrapePlayerDecidingSetStats,
};

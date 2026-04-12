'use strict';

/**
 * dataFetcher.js — Couche d'accès aux données unifiée
 *
 * Fournit :
 *   safeValue(value, fieldName)              → null-safe helper
 *   fetchPlayerDataFromSheet(name, surface)  → données Google Sheets
 *   fetchPlayerDataOnline(name, surface)     → données web scraping
 *   mergePlayerData(sheetData, onlineData, surface) → fusion avec priorité Sheet
 *   fetchCompletePlayerData(name, surface)   → orchestrateur avec cache 5 min
 *
 * RÈGLE : Sheets est TOUJOURS prioritaire sur les données en ligne.
 * Si une donnée est absente partout → null (jamais d'erreur levée).
 */

const {
  getPlayerMatches,
  getPlayerStats,
  getPlayerStats1Y,
  getPlayerStatsTop50,
} = require('./googleSheets');
const {
  scrapePlayerHistory,
  scrapePlayerSurfaceStats,
  scrapePlayerTiebreakStats,
  scrapePlayerDecidingSetStats,
} = require('./webScraper');

// ─── Cache TTL 5 minutes ──────────────────────────────────────────────────────

const _cache  = new Map();
const TTL_MS  = 5 * 60 * 1000;

function _getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < TTL_MS) return entry.data;
  return null;
}

function _setCached(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

function norm(str) {
  return (str ?? '').trim().toLowerCase();
}

/**
 * Fusionne deux listes de matchs : les matchs Sheets sont prioritaires.
 * Un match web est ignoré s'il existe déjà (même date + même adversaire).
 */
function _mergeMatches(sheetsMatches, webMatches) {
  const sheets = sheetsMatches ?? [];
  const web    = webMatches    ?? [];
  if (web.length === 0) return sheets;
  if (sheets.length === 0) return web;

  const keys    = new Set(sheets.map((m) => `${m.date}|${norm(m.adversaire)}`));
  const webOnly = web.filter((m) => !keys.has(`${m.date}|${norm(m.adversaire)}`));

  console.log(
    `[DataFetcher] Merge matchs : ${sheets.length} Sheets + ${webOnly.length} web ajoutés`
    + ` (${web.length - webOnly.length} doublon(s) ignoré(s))`
  );

  return [...sheets, ...webOnly].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
}

// ─── safeValue ────────────────────────────────────────────────────────────────

/**
 * Retourne 0 si la valeur est null/undefined, la valeur sinon.
 * Log un avertissement si la valeur est manquante et qu'un nom de champ est fourni.
 *
 * @param {*}      value     - Valeur à sécuriser
 * @param {string} [fieldName] - Nom du champ (pour le log)
 * @returns {number|*} 0 si null/undefined, valeur sinon
 */
function safeValue(value, fieldName) {
  if (value === null || value === undefined) {
    if (fieldName) {
      console.log(`[DataFetcher] Donnée manquante : "${fieldName}" → 0`);
    }
    return 0;
  }
  return value;
}

// ─── fetchPlayerDataFromSheet ─────────────────────────────────────────────────

/**
 * Récupère les données d'un joueur depuis Google Sheets uniquement.
 *
 * Données disponibles depuis les Sheets :
 *   ✓ Historique de matchs (onglet 2025-atp-season)
 *   ✓ Stats long terme (STATS), récentes (STATS_1Y), vs top 50 (STATS_TOP50)
 *   ✗ tiebreakPct / decidingSetPct / firstServePct / winnersAvg → null (non présents)
 *
 * @param {string} playerName
 * @param {string} surface - clay | hard | indoor_hard | grass
 * @returns {Promise<Object>}
 */
async function fetchPlayerDataFromSheet(playerName, surface) {
  console.log(`[DataFetcher] Sheets → "${playerName}" (surface: ${surface})`);

  const safe = (p, label) => p.catch((err) => {
    console.error(`[DataFetcher] Sheets ${label} erreur : ${err.message}`);
    return null;
  });

  const [matches, stats, stats1y, statsTop50] = await Promise.all([
    safe(getPlayerMatches(playerName),    'matchs'),
    safe(getPlayerStats(playerName),      'STATS'),
    safe(getPlayerStats1Y(playerName),    'STATS_1Y'),
    safe(getPlayerStatsTop50(playerName), 'STATS_TOP50'),
  ]);

  return {
    matches:        matches    ?? [],
    stats:          stats      ?? null,   // STATS  — long terme
    stats1y:        stats1y    ?? null,   // STATS_1Y — 12 mois
    statsTop50:     statsTop50 ?? null,   // STATS_TOP50 — vs top 50
    tiebreakPct:    null,   // non disponible dans les Sheets actuellement
    decidingSetPct: null,   // non disponible dans les Sheets actuellement
    firstServePct:  null,   // non disponible dans les Sheets actuellement
    winnersAvg:     null,   // non disponible dans les Sheets actuellement
  };
}

// ─── fetchPlayerDataOnline ────────────────────────────────────────────────────

/**
 * Récupère les données d'un joueur depuis les sources web.
 * Toutes les requêtes sont lancées en parallèle — échec partiel toléré.
 *
 * Données récupérées :
 *   ✓ Historique de matchs (TennisAbstract → TennisRatio → ATPTour)
 *   ✓ Stats surface (TennisRatio)
 *   ✓ % tie-breaks (UltimateTennisStatistics)
 *   ✓ % 3e sets (UltimateTennisStatistics)
 *
 * @param {string} playerName
 * @param {string} surface
 * @returns {Promise<Object>}
 */
async function fetchPlayerDataOnline(playerName, surface) {
  console.log(`[DataFetcher] Online → "${playerName}" (surface: ${surface})`);

  const [matchesR, surfaceR, tiebreakR, decidingR] = await Promise.allSettled([
    scrapePlayerHistory(playerName),
    scrapePlayerSurfaceStats(playerName, surface),
    scrapePlayerTiebreakStats(playerName),
    scrapePlayerDecidingSetStats(playerName),
  ]);

  const val = (r) => (r.status === 'fulfilled' ? r.value : null);

  const tiebreak  = val(tiebreakR);
  const deciding  = val(decidingR);

  return {
    matches:       val(matchesR)  ?? [],
    surfaceStats:  val(surfaceR)  ?? null,
    tiebreakPct:   tiebreak?.pctTiebreaks    ?? null,
    decidingSetPct: deciding?.pctDecidingSets ?? null,
    firstServePct: null,  // non scrapé actuellement
    winnersAvg:    null,  // non scrapé actuellement
  };
}

// ─── mergePlayerData ──────────────────────────────────────────────────────────

/**
 * Fusionne les données Sheets et web en appliquant la priorité Sheets.
 *
 * Pour chaque champ :
 *   → si valeur présente dans sheetData : utiliser celle-ci (source = "sheet")
 *   → sinon si valeur présente dans onlineData : utiliser celle-ci (source = "online")
 *   → sinon : null (source = "absent")
 *
 * @param {Object} sheetData   - Résultat de fetchPlayerDataFromSheet
 * @param {Object} onlineData  - Résultat de fetchPlayerDataOnline
 * @param {string} surface     - Surface pour filtrer surfaceMatches
 * @returns {Object}           - Données fusionnées + dataSource par champ
 */
function mergePlayerData(sheetData, onlineData, surface) {
  /**
   * Sélectionne la valeur avec priorité Sheets, retourne { value, source }.
   */
  function pick(sheetVal, onlineVal) {
    if (sheetVal !== null && sheetVal !== undefined) return { value: sheetVal, source: 'sheet' };
    if (onlineVal !== null && onlineVal !== undefined) return { value: onlineVal, source: 'online' };
    return { value: null, source: 'absent' };
  }

  const tiebreakPct    = pick(sheetData.tiebreakPct,    onlineData.tiebreakPct);
  const decidingSetPct = pick(sheetData.decidingSetPct, onlineData.decidingSetPct);
  const firstServePct  = pick(sheetData.firstServePct,  onlineData.firstServePct);
  const winnersAvg     = pick(sheetData.winnersAvg,     onlineData.winnersAvg);

  // Données stats Sheets uniquement (pas de source web équivalente)
  const stats      = sheetData.stats     ?? null;
  const stats1y    = sheetData.stats1y   ?? null;
  const statsTop50 = sheetData.statsTop50 ?? null;

  // Fusion des matchs (Sheets prioritaire, doublons ignorés)
  const allMatches = _mergeMatches(sheetData.matches, onlineData.matches);

  const atpMatches     = allMatches.filter((m) => m.niveau !== 'Challenger');
  const last10ATP      = atpMatches.slice(0, 10);
  const last5ATP       = atpMatches.slice(0, 5);
  const surfaceMatches = allMatches.filter((m) => m.surface === surface);

  const matchesSource =
    sheetData.matches.length > 0  ? 'sheet'  :
    onlineData.matches.length > 0 ? 'online' : 'absent';

  return {
    // Données matchs
    allMatches,
    last10ATP,
    last5ATP,
    surfaceMatches,

    // Données stats
    tiebreakPct:    tiebreakPct.value,
    decidingSetPct: decidingSetPct.value,
    firstServePct:  firstServePct.value,
    winnersAvg:     winnersAvg.value,

    // Données stats Sheets enrichies
    stats,
    stats1y,
    statsTop50,

    // Provenance par champ (pour le rapport)
    dataSource: {
      matches:       matchesSource,
      tiebreakPct:   tiebreakPct.source,
      decidingSetPct: decidingSetPct.source,
      firstServePct: firstServePct.source,
      winnersAvg:    winnersAvg.source,
      stats:         stats     ? 'sheet' : 'absent',
      stats1y:       stats1y   ? 'sheet' : 'absent',
      statsTop50:    statsTop50 ? 'sheet' : 'absent',
    },

    // Statistiques sources (pour les logs)
    source: {
      sheets: sheetData.matches.length,
      web:    onlineData.matches.length,
      total:  allMatches.length,
    },
  };
}

// ─── fetchCompletePlayerData ──────────────────────────────────────────────────

/**
 * Orchestrateur principal — avec cache TTL 5 min.
 *
 * Stratégie :
 *   1. Toujours charger les données Sheets
 *   2. Charger les données web UNIQUEMENT si Sheets insuffisant :
 *      - Moins de 5 matchs ATP, OU
 *      - Aucun match sur la surface demandée, OU
 *      - tiebreakPct/decidingSetPct manquants (toujours le cas actuellement)
 *   3. Fusionner avec priorité Sheets
 *
 * @param {string} playerName
 * @param {string} surface
 * @returns {Promise<Object>}
 */
async function fetchCompletePlayerData(playerName, surface) {
  const cacheKey = `${playerName}:${surface}`;
  const cached   = _getCached(cacheKey);
  if (cached) {
    console.log(`[DataFetcher] Cache hit → "${playerName}" (${surface})`);
    return cached;
  }

  console.log(`\n[DataFetcher] ── fetchCompletePlayerData("${playerName}", "${surface}") ──`);

  // ÉTAPE 1 : Sheets (toujours)
  const sheetData = await fetchPlayerDataFromSheet(playerName, surface);
  console.log(`[DataFetcher] Sheets : ${sheetData.matches.length} match(s) chargé(s)`);

  // ÉTAPE 2 : Online (si nécessaire)
  const atpCount = sheetData.matches.filter((m) => m.niveau !== 'Challenger').length;
  const surfCount = sheetData.matches.filter((m) => m.surface === surface).length;
  const needsOnline = atpCount < 5 || surfCount === 0 || sheetData.tiebreakPct === null;

  let onlineData = {
    matches: [], surfaceStats: null,
    tiebreakPct: null, decidingSetPct: null,
    firstServePct: null, winnersAvg: null,
  };

  if (needsOnline) {
    console.log(
      `[DataFetcher] Scraping web nécessaire`
      + ` (ATP=${atpCount}, surface=${surfCount}, tiebreak=${sheetData.tiebreakPct})`
    );
    onlineData = await fetchPlayerDataOnline(playerName, surface);
    console.log(`[DataFetcher] Online : ${onlineData.matches.length} match(s) scrapé(s)`);
  } else {
    console.log('[DataFetcher] Scraping web ignoré (Sheets suffisant)');
  }

  // ÉTAPE 3 : Fusion
  const merged = mergePlayerData(sheetData, onlineData, surface);

  console.log(
    `[DataFetcher] ── Terminé : ${merged.allMatches.length} match(s) total`
    + ` | ATP: ${merged.last10ATP.length} | Surface: ${merged.surfaceMatches.length}`
    + ` | tiebreak: ${merged.tiebreakPct ?? 'N/D'}`
    + ` | decidingSet: ${merged.decidingSetPct ?? 'N/D'} ──\n`
  );

  _setCached(cacheKey, merged);
  return merged;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  safeValue,
  fetchPlayerDataFromSheet,
  fetchPlayerDataOnline,
  mergePlayerData,
  fetchCompletePlayerData,
};

const { google } = require('googleapis');
const { googleSheets: cfg } = require('../../config/config');
const { scrapePlayerHistory } = require('./webScraper');

// ─── Structure colonnes feuille "Tournois" ────────────────────────────────────
// (non définie dans config car non demandée dans les specs initiales)
const TOURNOIS_COLUMNS = {
  A: 'joueur',
  B: 'tournoi',
  C: 'annee',
  D: 'points',       // points gagnés (= points à défendre l'année suivante)
  E: 'tourAtteint',  // ex: F, SF, QF, R1…
};

// ─── Helpers internes ─────────────────────────────────────────────────────────

function norm(str) {
  return (str ?? '').trim().toLowerCase();
}

// ─── Matching robuste des noms de joueurs ─────────────────────────────────────

/** Normalisation forte : minuscules, sans points, espaces uniques. */
function normName(str) {
  return (str ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrait nom de famille + première initiale depuis un nom normalisé.
 * Deux formats acceptés :
 *   Abrégé  : "Lastname F."  / "Lastname F. M."  / "Last Name F."
 *   Complet : "Carlos Alcaraz" / "Alex de Minaur" / "Tomas Martin Etcheverry"
 *
 * Exemples :
 *   "Etcheverry T. M." → { lastName: "etcheverry",    firstInitial: "t" }
 *   "De Minaur A."    → { lastName: "de minaur",      firstInitial: "a" }
 *   "Carlos Alcaraz"  → { lastName: "alcaraz",         firstInitial: "c" }
 *   "Alex de Minaur"  → { lastName: "de minaur",      firstInitial: "a" }
 *   "Tomas Martin Etcheverry" → { lastName: "martin etcheverry", firstInitial: "t" }
 */
function parseName(str) {
  const tokens = normName(str).split(' ');
  const firstInitialIdx = tokens.findIndex((t) => /^[a-z]$/.test(t));

  if (firstInitialIdx === -1) {
    // Format complet (aucune initiale abrégée) : "Carlos Alcaraz", "Alex de Minaur"
    // firstInitial = premier caractère du premier token ; lastName = le reste
    return tokens.length >= 2
      ? { lastName: tokens.slice(1).join(' '), firstInitial: tokens[0][0] ?? '' }
      : { lastName: tokens[0] ?? '',           firstInitial: '' };
  }

  if (firstInitialIdx === 0) {
    // Initiale en tête (cas rare), ancien comportement conservé
    return { lastName: tokens.join(' '), firstInitial: tokens[tokens.length - 1] ?? '' };
  }

  return {
    lastName:     tokens.slice(0, firstInitialIdx).join(' '),
    firstInitial: tokens[firstInitialIdx],
  };
}

/**
 * Retourne true si deux noms désignent le même joueur.
 * Étape 1 — correspondance exacte (après normName).
 * Étape 2 — même initiale + même nom de famille (exact).
 * Étape 3 — même initiale + dernier mot du lastName identique
 *            (gère "martin etcheverry" vs "etcheverry", "de minaur" vs "minaur").
 */
function samePlayer(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  const pa = parseName(a);
  const pb = parseName(b);
  if (!pa.firstInitial || !pb.firstInitial || pa.firstInitial !== pb.firstInitial) return false;
  if (pa.lastName === pb.lastName) return true;
  // Fallback : noms composés — le dernier mot suffit
  const lastA = pa.lastName.split(' ').pop();
  const lastB = pb.lastName.split(' ').pop();
  return lastA === lastB && lastA.length >= 3; // ≥ 3 lettres pour éviter faux positifs
}

/**
 * Convertit une lettre de colonne Sheets (ex: "A", "Z", "AA", "AP") en index 0-based.
 * Nécessaire pour supporter les colonnes multi-lettres (AA, AB, … AP).
 */
function colLetterToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** Retourne la lettre de colonne la plus haute du columnMap (ex: "AP"). */
function lastColLetter(columnMap) {
  return Object.keys(columnMap).reduce((max, col) =>
    colLetterToIndex(col) > colLetterToIndex(max) ? col : max
  );
}

/** "02 Jan 2026" → "2026-01-02" (ou retourne la valeur brute si non parsable) */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().split('T')[0];
}

/** Déduit le niveau ATP depuis le nom du tournoi. */
const GS_NAMES      = ['australian open','roland garros','french open','wimbledon','us open'];
const MASTERS_NAMES = ['indian wells','miami','monte-carlo','monte carlo','madrid','rome',
                       'canada','montreal','toronto','cincinnati','shanghai','paris masters'];
const ATP500_NAMES  = ['rotterdam','dubai','acapulco','barcelona','hamburg','washington',
                       'beijing','tokyo','vienna','basel','halle',"queen's club","queen's"];

function inferNiveau(tournamentName) {
  const t = norm(tournamentName);
  if (GS_NAMES.some((n) => t.includes(n)))      return 'GS';
  if (MASTERS_NAMES.some((n) => t.includes(n))) return 'Masters';
  if (ATP500_NAMES.some((n) => t.includes(n)))  return 'ATP500';
  if (t.includes('challenger'))                 return 'Challenger';
  return 'ATP250';
}

/** Reconstruit le score textuel depuis les colonnes jeux (ex: "6-4 3-6 6-2"). */
function buildScore(row) {
  const pairs = [
    [row.games_set1_player1, row.games_set1_player2],
    [row.games_set2_player1, row.games_set2_player2],
    [row.games_set3_player1, row.games_set3_player2],
    [row.games_set4_player1, row.games_set4_player2],
    [row.games_set5_player1, row.games_set5_player2],
  ];
  const sets = pairs
    .filter(([j1, j2]) => j1 !== null && j1 !== '' && j2 !== null && j2 !== '')
    .map(([j1, j2]) => `${j1}-${j2}`);
  return sets.length > 0 ? sets.join(' ') : null;
}

/**
 * Déduit le résultat (V/D).
 * Utilise win_player1/win_player2 si disponibles, sinon déduit depuis sets_won.
 * @param {Object}  row   - Ligne brute de la feuille
 * @param {boolean} isP1  - true si le joueur cible est player1
 */
function deduceResult(row, isP1) {
  // Priorité : colonne win_player explicite
  const w1 = row.win_player1;
  const w2 = row.win_player2;
  if (w1 !== null && w1 !== undefined) {
    const won = isP1
      ? (w1 === '1' || w1 === 'TRUE' || w1 === 'true' || w1 === 'Yes')
      : (w2 === '1' || w2 === 'TRUE' || w2 === 'true' || w2 === 'Yes');
    return won ? 'V' : 'D';
  }
  // Fallback : comparer les sets gagnés
  const sP1 = parseInt(row.sets_won_player1, 10);
  const sP2 = parseInt(row.sets_won_player2, 10);
  if (isNaN(sP1) || isNaN(sP2)) return null;
  return isP1 ? (sP1 > sP2 ? 'V' : 'D') : (sP2 > sP1 ? 'V' : 'D');
}

/**
 * Lit une feuille Google Sheets et retourne un tableau d'objets.
 * Utilise l'API key (feuille doit être en lecture publique).
 * @param {string} sheetName  - Nom de l'onglet
 * @param {Object} columnMap  - { A: 'field', B: 'field', … }
 * @returns {Array|null}      - Tableau de lignes ou null si erreur
 */
async function readSheet(sheetName, columnMap) {
  const source = `Google Sheets → "${sheetName}"`;
  try {
    const sheets = google.sheets({ version: 'v4' });
    const range = `${sheetName}!A:${lastColLetter(columnMap)}`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.sheetId,
      range,
      key: cfg.apiKey,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      console.log(`[Sheets] ${source} — feuille vide ou inaccessible.`);
      return [];
    }

    // La ligne 0 = en-têtes Google Sheets (ignorée, on utilise notre mapping)
    const [, ...dataRows] = rows;

    return dataRows
      .filter((row) => row.some((cell) => cell?.trim())) // ignore lignes vides
      .map((row) => {
        const obj = {};
        for (const [col, field] of Object.entries(columnMap)) {
          const idx = colLetterToIndex(col); // A→0, Z→25, AA→26, AP→41…
          obj[field] = row[idx]?.trim() ?? null;
        }
        return obj;
      });
  } catch (err) {
    console.error(`[Sheets] Erreur lecture ${source} : ${err.message}`);
    return null;
  }
}

// ─── Fonctions publiques ──────────────────────────────────────────────────────

/**
 * 1. Retourne tous les matchs d'un joueur, triés par date décroissante.
 *    Un match est inclus si le joueur apparaît en player1 (col E) OU player2 (col F).
 *    Le résultat (V/D) est lu depuis win_player1/win_player2 ou déduit des sets.
 */
async function getPlayerMatches(playerName) {
  const source = `Google Sheets → "${cfg.sheets.matches}"`;
  console.log(`[Sheets] Lecture matchs de "${playerName}" — source : ${source}`);

  const rows = await readSheet(cfg.sheets.matches, cfg.matchsColumns);
  if (rows === null) return null;

  const matches = [];
  let _loggedMatch = false;

  for (const r of rows) {
    const isP1 = samePlayer(r.player1, playerName);
    const isP2 = samePlayer(r.player2, playerName);
    if (!isP1 && !isP2) continue;

    if (!_loggedMatch) {
      const matched = isP1 ? r.player1 : r.player2;
      console.log('[MATCH DEBUG]', { input: playerName, matched });
      _loggedMatch = true;
    }

    const adversaire     = isP1 ? r.player2 : r.player1;
    const rangAdversaire = isP1
      ? (r.rank_player2 ? Number(r.rank_player2) : null)
      : (r.rank_player1 ? Number(r.rank_player1) : null);
    const rankJoueur     = isP1
      ? (r.rank_player1 ? Number(r.rank_player1) : null)
      : (r.rank_player2 ? Number(r.rank_player2) : null);

    const sP1 = parseInt(r.sets_won_player1, 10) || 0;
    const sP2 = parseInt(r.sets_won_player2, 10) || 0;

    const toNum = (v) => (v !== null && v !== '' ? Number(v) : null);

    matches.push({
      // Champs de base (utilisés par le pipeline de scoring)
      date:            normalizeDate(r.date),
      tournoi:         r.tournament,
      niveau:          inferNiveau(r.tournament),
      surface:         r.surface?.toLowerCase() ?? null,
      tour:            r.round,
      adversaire,
      rangAdversaire,
      rankJoueur,
      resultat:        deduceResult(r, isP1),
      score:           buildScore(r),
      nbSets:          sP1 + sP2,
      acesJoueur:      isP1 ? toNum(r.aces_player1)          : toNum(r.aces_player2),
      // Nouvelles stats disponibles dans le sheet
      doubleFautes:    isP1 ? toNum(r.double_faults_player1)      : toNum(r.double_faults_player2),
      servicePtsWon:   isP1 ? toNum(r.service_points_won_player1) : toNum(r.service_points_won_player2),
      returnPtsWon:    isP1 ? toNum(r.return_points_won_player1)  : toNum(r.return_points_won_player2),
      breaksConverted: isP1 ? toNum(r.breaks_converted_player1)   : toNum(r.breaks_converted_player2),
      breaksSaved:     isP1 ? toNum(r.breaks_saved_player1)       : toNum(r.breaks_saved_player2),
      totalGames:      isP1 ? toNum(r.total_games_player1)        : toNum(r.total_games_player2),
      // Différentiel de jeux (du point de vue du joueur ciblé)
      gameDiff: (() => {
        const gP = toNum(isP1 ? r.total_games_player1 : r.total_games_player2);
        const gO = toNum(isP1 ? r.total_games_player2 : r.total_games_player1);
        return (gP !== null && gO !== null) ? gP - gO : null;
      })(),
      // Flags de qualité
      matchValid:      r.match_valid,
      surfaceValid:    r.surface_valid,
      statsComplete:   r.stats_complete,
      last12Months:    r.last_12_months,
    });
  }

  matches.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  console.log(`[Sheets] ${matches.length} match(s) trouvé(s) pour "${playerName}"`);
  return matches;
}

/**
 * 2. Retourne les 10 derniers matchs ATP du joueur (hors Challengers).
 */
async function getPlayerLast10ATP(playerName) {
  console.log(`[Sheets] Derniers 10 matchs ATP de "${playerName}" (source : Google Sheets → "${cfg.sheets.matches}")`);

  const matches = await getPlayerMatches(playerName);
  if (matches === null) return null;

  const atpOnly = matches.filter((m) => m.niveau !== 'Challenger');
  const last10  = atpOnly.slice(0, 10);

  console.log(`[Sheets] ${last10.length} match(s) ATP récent(s) retourné(s) pour "${playerName}"`);
  return last10;
}

/**
 * 4. Retourne les points à défendre par un joueur dans un tournoi donné.
 */
async function getPointsToDefend(playerName, tournoi) {
  const source = `Google Sheets → "${cfg.sheets.tournois}"`;
  console.log(`[Sheets] Points à défendre — "${playerName}" à "${tournoi}" — source : ${source}`);

  const rows = await readSheet(cfg.sheets.tournois, TOURNOIS_COLUMNS);
  if (rows === null) return null;

  const row = rows.find(
    (r) => samePlayer(r.joueur, playerName) && norm(r.tournoi) === norm(tournoi)
  );

  if (!row) {
    console.log(`[Sheets] Aucun point à défendre trouvé pour "${playerName}" à "${tournoi}"`);
    return null;
  }

  return {
    joueur:      row.joueur,
    tournoi:     row.tournoi,
    annee:       row.annee,
    points:      Number(row.points) || 0,
    tourAtteint: row.tourAtteint,
  };
}

/**
 * 5. Retourne le bilan head-to-head entre deux joueurs.
 *    Chaque ligne du Sheet contient les deux joueurs — une seule passe suffit.
 */
async function getH2H(player1, player2) {
  const source = `Google Sheets → "${cfg.sheets.matches}"`;
  console.log(`[Sheets] H2H "${player1}" vs "${player2}" — source : ${source}`);

  const rows = await readSheet(cfg.sheets.matches, cfg.matchsColumns);
  if (rows === null) return null;

  let victoiresJ1 = 0;
  let victoiresJ2 = 0;

  for (const r of rows) {
    // La ligne concerne ce H2H si les deux joueurs y apparaissent (peu importe l'ordre)
    const p1estP1 = samePlayer(r.player1, player1) && samePlayer(r.player2, player2);
    const p1estP2 = samePlayer(r.player1, player2) && samePlayer(r.player2, player1);
    if (!p1estP1 && !p1estP2) continue;

    // Résultat via win_player ou sets gagnés
    const resultat = deduceResult(r, p1estP1);
    if (!resultat) continue;

    if (resultat === 'V') victoiresJ1++; else victoiresJ2++;
  }

  const totalRencontres = victoiresJ1 + victoiresJ2;
  const result = {
    totalRencontres,
    victoiresJ1,
    victoiresJ2,
    pctJ1: totalRencontres > 0 ? Math.round((victoiresJ1 / totalRencontres) * 100) : 0,
    pctJ2: totalRencontres > 0 ? Math.round((victoiresJ2 / totalRencontres) * 100) : 0,
  };

  console.log(`[Sheets] H2H : ${totalRencontres} rencontre(s) | ${player1} ${victoiresJ1}–${victoiresJ2} ${player2}`);
  return result;
}

// ─── Fusion des sources ───────────────────────────────────────────────────────

/**
 * Vérifie si les données Sheets sont insuffisantes et nécessitent un complément web.
 * Retourne true si au moins l'une des 3 conditions est vraie :
 *   - Moins de 5 matchs ATP (hors Challenger)
 *   - Aucun match sur la surface demandée
 *   - Moins de 3 adversaires distincts (H2H inutilisable)
 */
function checkMissingData(sheetsMatches, surface) {
  if (!sheetsMatches || sheetsMatches.length === 0) {
    console.log('[Sheets] checkMissingData → données Sheets absentes, scraping nécessaire');
    return true;
  }

  const atpCount = sheetsMatches.filter((m) => m.niveau !== 'Challenger').length;
  if (atpCount < 5) {
    console.log(`[Sheets] checkMissingData → seulement ${atpCount} match(s) ATP (< 5), scraping nécessaire`);
    return true;
  }

  const surfaceCount = sheetsMatches.filter((m) => m.surface === surface).length;
  if (surfaceCount === 0) {
    console.log(`[Sheets] checkMissingData → aucun match sur surface "${surface}", scraping nécessaire`);
    return true;
  }

  const uniqueOpponents = new Set(
    sheetsMatches.map((m) => norm(m.adversaire)).filter(Boolean)
  );
  if (uniqueOpponents.size < 3) {
    console.log(`[Sheets] checkMissingData → seulement ${uniqueOpponents.size} adversaire(s) distinct(s) (H2H insuffisant), scraping nécessaire`);
    return true;
  }

  console.log('[Sheets] checkMissingData → données Sheets suffisantes, pas de scraping');
  return false;
}

/**
 * Fusionne les matchs Sheets et web.
 * Sheets est prioritaire : un match web est ignoré si un match Sheets
 * existe avec la même date et le même adversaire.
 * Le résultat est trié par date décroissante.
 */
function mergeSources(sheetsMatches, webMatches) {
  const sheets = sheetsMatches ?? [];
  const web    = webMatches    ?? [];

  if (web.length === 0) return sheets;
  if (sheets.length === 0) return web;

  const sheetsKeys = new Set(
    sheets.map((m) => `${m.date}|${norm(m.adversaire)}`)
  );

  let addedFromWeb = 0;
  const webOnly = web.filter((m) => {
    const key = `${m.date}|${norm(m.adversaire)}`;
    if (sheetsKeys.has(key)) return false;
    addedFromWeb++;
    return true;
  });

  console.log(
    `[Merge] ${sheets.length} Sheets + ${addedFromWeb} web ajoutés (${web.length - addedFromWeb} doublon(s) ignoré(s))`
  );

  return [...sheets, ...webOnly].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
}

// ─── Feuilles STATS / STATS_1Y / STATS_TOP50 ─────────────────────────────────

/**
 * Lit une feuille dont la première ligne contient les en-têtes,
 * et retourne un tableau d'objets clé→valeur sans mapping prédéfini.
 * Utile pour les feuilles STATS, STATS_1Y et STATS_TOP50 dont la structure
 * peut évoluer sans nécessiter de modification du code.
 *
 * @param {string} sheetName - Nom de l'onglet Google Sheets
 * @returns {Promise<Array|null>} - Tableau de lignes ou null si erreur
 */
async function getSheetData(sheetName) {
  const source = `Google Sheets → "${sheetName}"`;
  try {
    const sheets = google.sheets({ version: 'v4' });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.sheetId,
      range:         `${sheetName}!A:AZ`,
      key:           cfg.apiKey,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      console.log(`[Sheets] ${source} — feuille vide ou inaccessible.`);
      return [];
    }

    const headers  = rows[0].map((h) => (h ?? '').trim());
    const dataRows = rows.slice(1);

    return dataRows
      .filter((row) => row.some((cell) => cell?.trim()))
      .map((row) => {
        const obj = {};
        headers.forEach((header, idx) => {
          if (header) obj[header] = row[idx]?.trim() ?? null;
        });
        return obj;
      });
  } catch (err) {
    console.error(`[Sheets] Erreur lecture ${source} : ${err.message}`);
    return null;
  }
}

/**
 * Trouve la valeur d'un joueur dans un tableau de lignes.
 * Cherche un champ dont le nom normalisé contient "joueur" ou "player",
 * en fallback utilise le premier champ de la ligne.
 * @param {Array}  rows        - Lignes retournées par getSheetData
 * @param {string} playerName  - Nom du joueur à rechercher
 * @returns {Object|null}      - Première ligne correspondante ou null
 */
function findPlayerRow(rows, playerName) {
  if (!rows || rows.length === 0) return null;

  // Détecte la clé "joueur" / "player" dans les en-têtes
  const sample   = rows[0];
  const nameKey  = Object.keys(sample).find(
    (k) => norm(k).includes('joueur') || norm(k).includes('player') || norm(k) === 'nom'
  ) ?? Object.keys(sample)[0]; // fallback : première colonne

  const found = rows.find((r) => samePlayer(r[nameKey], playerName)) ?? null;
  if (found) console.log('[MATCH DEBUG]', { input: playerName, matched: found[nameKey] });
  return found;
}

/**
 * Retourne toutes les lignes d'un joueur dans une feuille STATS.
 * (certaines feuilles ont une ligne par surface ou par période)
 * @param {Array}  rows        - Lignes retournées par getSheetData
 * @param {string} playerName  - Nom du joueur
 * @returns {Array}            - Toutes les lignes correspondantes
 */
function findPlayerRows(rows, playerName) {
  if (!rows || rows.length === 0) return [];
  const sample  = rows[0];
  const nameKey = Object.keys(sample).find(
    (k) => norm(k).includes('joueur') || norm(k).includes('player') || norm(k) === 'nom'
  ) ?? Object.keys(sample)[0];

  return rows.filter((r) => samePlayer(r[nameKey], playerName));
}

/**
 * 6. Stats long terme du joueur (feuille STATS).
 * @param {string} playerName
 * @returns {Promise<Array|null>} - Tableau de lignes (peut contenir plusieurs entrées par surface/période)
 */
async function getPlayerStats(playerName) {
  console.log(`[Sheets] Stats long terme de "${playerName}" (STATS)`);
  const rows = await getSheetData(cfg.sheets.stats);
  if (rows === null) return null;
  const found = findPlayerRow(rows, playerName);
  if (!found) console.log(`[Sheets] STATS : aucune ligne pour "${playerName}"`);
  return found;
}

/**
 * 7. Stats des 12 derniers mois du joueur (feuille STATS_1Y).
 * @param {string} playerName
 * @returns {Promise<Object|null>}
 */
async function getPlayerStats1Y(playerName) {
  console.log(`[Sheets] Stats 1 an de "${playerName}" (STATS_1Y)`);
  const rows = await getSheetData(cfg.sheets.stats1y);
  if (rows === null) return null;
  const found = findPlayerRow(rows, playerName);
  if (!found) console.log(`[Sheets] STATS_1Y : aucune ligne pour "${playerName}"`);
  return found;
}

/**
 * 8. Stats vs top 50 du joueur (feuille STATS_TOP50).
 * @param {string} playerName
 * @returns {Promise<Object|null>} - Ligne unique ou null
 */
async function getPlayerStatsTop50(playerName) {
  console.log(`[Sheets] Stats top 50 de "${playerName}" (STATS_TOP50)`);
  const rows = await getSheetData(cfg.sheets.statsTop50);
  if (rows === null) return null;
  const found = findPlayerRow(rows, playerName);
  if (!found) {
    console.log(`[Sheets] STATS_TOP50 : aucune ligne pour "${playerName}"`);
    return null;
  }
  // ── DEBUG TOP50 RAW ──────────────────────────────────────────────────────────
  console.log(`[TOP50 RAW] "${playerName}" →`, JSON.stringify({
    matches_vs_top50:       found.matches_vs_top50,
    wins_vs_top50:          found.wins_vs_top50,
    win_rate_vs_top50:      found.win_rate_vs_top50,
    matches_clay_vs_top50:  found.matches_clay_vs_top50,
    wins_clay_vs_top50:     found.wins_clay_vs_top50,
    win_rate_clay_vs_top50: found.win_rate_clay_vs_top50,
    matches_hard_vs_top50:  found.matches_hard_vs_top50,
    wins_hard_vs_top50:     found.wins_hard_vs_top50,
    win_rate_hard_vs_top50: found.win_rate_hard_vs_top50,
  }));
  // ────────────────────────────────────────────────────────────────────────────
  return found;
}

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Retourne les données complètes d'un joueur pour une surface donnée.
 * Combine Google Sheets (prioritaire) et web scraping (complément).
 *
 * @param {string} playerName
 * @param {string} surface  - clay | hard | indoor_hard | grass
 * @returns {{
 *   last10ATP:      Array,
 *   last5ATP:       Array,
 *   surfaceMatches: Array,
 *   allMatches:     Array,
 *   source:         { sheets: number, web: number, total: number }
 * }}
 */
async function getCompletePlayerData(playerName, surface) {
  console.log(`\n[Data] ── getCompletePlayerData("${playerName}", "${surface}") ──`);

  // ÉTAPE 1 : Google Sheets (source prioritaire)
  const sheetsMatches = (await getPlayerMatches(playerName)) ?? [];
  console.log(`[Data] Étape 1 — Sheets : ${sheetsMatches.length} match(s) chargé(s)`);

  // ÉTAPE 2 : Web scraping (complément si données insuffisantes)
  let webMatches = [];
  if (checkMissingData(sheetsMatches, surface)) {
    console.log('[Data] Étape 2 — Lancement du scraping web…');
    const scraped = await scrapePlayerHistory(playerName);
    webMatches = scraped ?? [];
    console.log(`[Data] Étape 2 — Web : ${webMatches.length} match(s) scrapé(s)`);
  } else {
    console.log('[Data] Étape 2 — Scraping web ignoré (Sheets suffisant)');
  }

  // ÉTAPE 3 : Fusion — Sheets prime sur web en cas de doublon
  console.log('[Data] Étape 3 — Fusion des sources…');
  const allMatches = mergeSources(sheetsMatches, webMatches);

  // ÉTAPE 4 : Filtres par usage
  const atpMatches = allMatches.filter((m) => m.niveau !== 'Challenger');
  const last10ATP  = atpMatches.slice(0, 10);
  const last5ATP   = atpMatches.slice(0, 5);
  const surfaceMatches = allMatches.filter((m) => m.surface === surface);

  const sourceStats = {
    sheets: sheetsMatches.length,
    web:    webMatches.length,
    total:  allMatches.length,
  };

  console.log(
    `[Data] ── Terminé : ${allMatches.length} match(s) total` +
    ` | ${last10ATP.length} ATP récents | ${surfaceMatches.length} sur ${surface} ──\n`
  );

  return { last10ATP, last5ATP, surfaceMatches, allMatches, source: sourceStats };
}

module.exports = {
  readSheet,
  getSheetData,
  getPlayerMatches,
  getPlayerLast10ATP,
  getPointsToDefend,
  getH2H,
  getPlayerStats,
  getPlayerStats1Y,
  getPlayerStatsTop50,
  getCompletePlayerData,
};

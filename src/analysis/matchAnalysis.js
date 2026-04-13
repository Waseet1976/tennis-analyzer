const { getPointsToDefend, getH2H } = require('../data/googleSheets');
const { comparePlayers }            = require('../scoring/comparePlayers');
const { fetchCompletePlayerData }                          = require('../data/dataFetcher');
const { calculateScoreA }                                                          = require('../scoring/scoreA');
const {
  calculateScoreB, calculateScoreC, calculateScoreD, calculateScoreE,
  calculateScoreF, calculateScoreG, calculateScoreH, calculateScoreI,
  calculateScoreJ, calculateScoreK, calculateScoreL, calculateScoreM,
  calculateScoreN, calculateScoreO,
}                                                                                  = require('../scoring/scoreB_O');
const { applyAllRules, applyRule6 }                                                = require('../scoring/rules');
const { generateReport }                                                           = require('../output/report');
console.log('🔥 MATCH ANALYSIS FILE LOADED:', __filename);
// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Construit un objet surfaceStats compatible avec Score O,
 * à partir des données STATS (long terme) ou STATS_1Y (récent).
 * Retourne null si aucune donnée disponible.
 *
 * @param {Object|null} stats    - Ligne STATS du joueur
 * @param {Object|null} stats1y  - Ligne STATS_1Y du joueur
 * @param {string}      surface  - clay | hard | indoor_hard | grass
 */
function deriveSurfaceStats(stats, stats1y, surface) {
  // Préférer STATS_1Y (plus récent) puis STATS comme fallback
  const row = stats1y ?? stats;
  if (!row) return null;

  const surfKey1y = surface === 'clay'
    ? 'win_rate_clay_1y'
    : (surface === 'hard' || surface === 'indoor_hard') ? 'win_rate_hard_1y' : null;
  const surfKeyLt = surface === 'clay'
    ? 'win_rate_clay'
    : (surface === 'hard' || surface === 'indoor_hard') ? 'win_rate_hard' : null;

  // Chercher le taux de victoire : STATS_1Y d'abord, STATS ensuite
  let raw = (stats1y && surfKey1y) ? stats1y[surfKey1y] : null;
  if (raw === null && stats && surfKeyLt) raw = stats[surfKeyLt];
  if (raw === null && row.win_rate_total_1y) raw = row.win_rate_total_1y;
  if (raw === null && stats?.win_rate_total) raw = stats.win_rate_total;

  if (raw === null || raw === undefined || raw === '') return null;

  let pct = parseFloat(String(raw).replace('%', ''));
  if (isNaN(pct)) return null;
  // Normaliser en 0–100 si la valeur est en 0–1
  if (pct > 0 && pct <= 1) pct = Math.round(pct * 100);

  return {
    pct,
    titres:  0,  // non disponible dans STATS
    finales: 0,  // non disponible dans STATS
  };
}

/**
 * Calcule les statistiques dérivées à partir de l'historique de matchs.
 * Complète les données retournées par getCompletePlayerData.
 */
function computeMatchStats(data, surface) {
  const now          = new Date();
  const MS_PER_HOUR  = 1000 * 60 * 60;
  const cutoff14     = new Date(now - 14 * 24 * MS_PER_HOUR);
  const currentYear  = now.getFullYear().toString();

  // Matchs dans les 14 derniers jours
  const recent        = data.allMatches.filter((m) => m.date && new Date(m.date) >= cutoff14);
  const matchesLast14 = recent.length;
  const setsLast14    = recent.filter((m) => m.nbSets === 3).length;

  // Heures depuis le dernier match (999 = très reposé par défaut)
  const lastMatch     = data.allMatches[0];
  const lastMatchHours = lastMatch?.date
    ? Math.floor((now - new Date(lastMatch.date)) / MS_PER_HOUR)
    : 999;

  // Classement moyen des adversaires récents (last10ATP)
  const rankedMatches    = data.last10ATP.filter((m) => m.rangAdversaire);
  const avgOpponentRank  = rankedMatches.length > 0
    ? Math.round(rankedMatches.reduce((s, m) => s + m.rangAdversaire, 0) / rankedMatches.length)
    : 50; // neutre si inconnu

  // Bilan saison en cours (ATP uniquement)
  const seasonATP   = data.allMatches.filter(
    (m) => m.date?.startsWith(currentYear) && m.niveau !== 'Challenger'
  );
  const seasonWins  = seasonATP.filter((m) => m.resultat === 'V').length;
  const seasonRecord = {
    matches: seasonATP.length,
    pct:     seasonATP.length > 0 ? Math.round((seasonWins / seasonATP.length) * 100) : 0,
  };

  // Victoires notables sur la surface cette saison
  const notableWinsOnSurface = data.allMatches
    .filter((m) =>
      m.date?.startsWith(currentYear) &&
      m.surface === surface &&
      m.resultat === 'V' &&
      m.rangAdversaire !== null
    )
    .map((m) => ({ rank: m.rangAdversaire, date: m.date }));

  // H2H sur même surface (vérifié depuis l'historique du joueur)
  // → calculé dynamiquement dans buildScores via checkH2HOnSurface()

  return {
    matchesLast14,
    setsLast14,
    lastMatchHours,
    avgOpponentRank,
    seasonRecord,
    notableWinsOnSurface,
    consecutiveOutsiderWins: 0, // nécessiterait le classement ATP historique du joueur
  };
}

/**
 * Vérifie si le H2H entre deux joueurs s'est déroulé (au moins une fois)
 * sur la surface analysée, en s'appuyant sur l'historique connu du joueur.
 */
function checkH2HOnSurface(allMatches, opponentName, surface) {
  const n = (opponentName ?? '').trim().toLowerCase();
  return allMatches.some(
    (m) => m.adversaire?.trim().toLowerCase() === n && m.surface === surface
  );
}

/**
 * Enrichit les données de base avec les stats scrapées et les stats calculées.
 */
async function buildPlayerData(playerName, surface, baseData) {
  const computed = computeMatchStats(baseData, surface);

  return {
    ...baseData,
    ...computed,
    // tiebreakPct et decidingSetPct proviennent désormais de dataFetcher (baseData)
    tiebrakPct:    baseData.tiebreakPct    ?? null,
    decidingSetPct: baseData.decidingSetPct ?? null,
    // Données profil — non disponibles sans source dédiée, null → fallbacks actifs
    ranking:       null,
    currentPoints: null,
    age:           null,
    style:         null,
    winnersAvg:    baseData.winnersAvg    ?? null,
    firstServePct: baseData.firstServePct ?? null,
    // Conditions météo — valeurs neutres (peuvent être surchargées via options)
    wind:          0,
    temp:          20,
    humidity:      50,
  };
}

/**
 * Construit l'objet scores A→O pour un joueur.
 * @param {Object} pd            - playerData enrichi
 * @param {Object} od            - opponentData enrichi (pour rankDiff)
 * @param {Object} scoreAResult  - résultat calculateScoreA(last10ATP)
 * @param {Object|null} surfaceStats - stats surface depuis Sheets (ou null)
 * @param {Object|null} h2h      - résultat getH2H
 * @param {number} h2hPct        - pctJ1 ou pctJ2 selon le joueur
 * @param {boolean} h2hSurface   - H2H sur même surface ?
 * @param {number} ptsToDefend   - points ATP à défendre
 * @param {string} surface       - surface cible
 */
function buildScores(pd, od, scoreAResult, surfaceStats, h2hPct, h2hSurface, ptsToDefend, surface) {
  const rank1    = pd.ranking ?? 100;
  const rank2    = od.ranking ?? 100;
  const rankDiff = rank2 - rank1;
  const pts      = ptsToDefend ?? 0;
  const currPts  = pd.currentPoints ?? Math.max(pts * 10, 1000); // estimation si inconnu
  const age      = pd.age  ?? 25; // neutre si inconnu

  // Score A sur les 5 derniers matchs ATP (pour Score G)
  const scoreA5Result = calculateScoreA(pd.last5ATP, surface);
  const scoreA5val    = scoreA5Result.score ?? scoreAResult.score; // fallback sur A10

  const safeSurfaceStats = surfaceStats ?? { pct: 50, titres: 0, finales: 0 };

  return {
    A: scoreAResult.score,
    B: calculateScoreB(pd.winnersAvg,     pd.style).score,
    C: calculateScoreC(pd.firstServePct).score,
    D: calculateScoreD(pts, currPts, rankDiff).score,
    E: calculateScoreE(pd.tiebrakPct).score,
    F: calculateScoreF(pd.decidingSetPct).score,
    G: calculateScoreG(scoreAResult.score, scoreA5val).score,
    H: calculateScoreH(pd.matchesLast14, pd.setsLast14, pd.lastMatchHours).score,
    I: calculateScoreI(h2hPct, h2hSurface).score,
    J: calculateScoreJ(scoreAResult.score, pd.avgOpponentRank).score,
    K: calculateScoreK(age).score,
    L: calculateScoreL(pd.wind, pd.temp, pd.humidity, pd.style, age, surface).score,
    M: calculateScoreM(scoreAResult.score).score,
    N: calculateScoreN(pd.consecutiveOutsiderWins).score,
    O: calculateScoreO(safeSurfaceStats, pd.notableWinsOnSurface, pd.seasonRecord).score,
    notes: [],
  };
}
function normalizeMainScores(total1, total2) {
  const diff = total1 - total2;

  const score1 = 1 / (1 + Math.exp(-diff / 4));
  const score2 = 1 - score1;

  return { score1, score2 };
}

function buildHybridConfidence(gap, aligned) {
  if (gap >= 0.10 && aligned) return { label: 'Élevée', level: 3 };
  if (gap >= 0.05 && aligned) return { label: 'Modérée', level: 2 };
  if (gap >= 0.02 && aligned) return { label: 'Légère', level: 1 };
  if (gap >= 0.05 && !aligned) return { label: 'Conflit modéré', level: 1 };
  return { label: 'Conflit / Match piégeux', level: 0 };
}
function clampValue(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function getTournamentWeight(niveau, tournament = '') {
  const n = String(niveau || '').toLowerCase();
  const t = String(tournament || '').toLowerCase();

  if (t.includes('grand slam') || n === 'gs') return 1.40;
  if (t.includes('masters') || t.includes('atp1000') || n === 'masters' || n === 'atp1000') return 1.25;
  if (t.includes('atp 500') || t.includes('atp500') || n === 'atp500') return 1.15;
  if (t.includes('atp 250') || t.includes('atp250') || n === 'atp250') return 1.00;
  if (t.includes('challenger') || n === 'challenger') return 0.65;

  return 1.00;
}

function getOpponentRankWeight(rank) {
  const r = Number(rank);

  if (!r || isNaN(r)) return 1.00;
  if (r <= 10) return 1.40;
  if (r <= 20) return 1.30;
  if (r <= 50) return 1.15;
  if (r <= 100) return 1.00;

  return 0.85;
}

function getSurfaceWeight(matchSurface, targetSurface) {
  const ms = String(matchSurface || '').toLowerCase();
  const ts = String(targetSurface || '').toLowerCase();

  if (!ms || !ts) return 1.00;
  if (ms === ts) return 1.20;

  return 0.90;
}

function getMatchWeight(match, targetSurface) {
  const tournoiWeight = getTournamentWeight(match.niveau, match.tournament);
  const rankWeight = getOpponentRankWeight(match.rangAdversaire);
  const surfaceWeight = getSurfaceWeight(match.surface, targetSurface);

  return tournoiWeight * rankWeight * surfaceWeight;
}


function calculateScoreAFromDataModel(allMatches, targetSurface = 'clay') {

  if (!allMatches || allMatches.length === 0) {
    return {
      score: 0,
      details: [
        {
          source: 'comparison_recent_form',
          last5Wins: 0,
          last5Total: 0,
          last10Wins: 0,
          last10Total: 0,
          avgDiff: 0,
          recentFormBlock: 0.5
        }
      ]
    };
  }

  const recentMatches = allMatches.slice(0, 10);
const last5 = recentMatches.slice(0, 5);
const last10 = recentMatches;

console.log('DEBUG SCORE A MATCHES =', last10.map(m => ({
  adversaire: m.adversaire,
  niveau: m.niveau,
  tournament: m.tournament,
  rangAdversaire: m.rangAdversaire,
  surface: m.surface,
  resultat: m.resultat,
  date: m.date
})));


const weightedWins5 = last5.reduce((sum, m) => {
  const w = getMatchWeight(m, targetSurface);
  return sum + (m.resultat === 'V' ? w : 0);
}, 0);

const weightedTotal5 = last5.reduce((sum, m) => {
  return sum + getMatchWeight(m, targetSurface);
}, 0);

const weightedWins10 = last10.reduce((sum, m) => {
  const w = getMatchWeight(m, targetSurface);
  return sum + (m.resultat === 'V' ? w : 0);
}, 0);

const weightedTotal10 = last10.reduce((sum, m) => {
  return sum + getMatchWeight(m, targetSurface);
}, 0);

const last5Wins = last5.filter(m => m.resultat === 'V').length;
const last10Wins = last10.filter(m => m.resultat === 'V').length;

const last5Rate = weightedTotal5 > 0 ? weightedWins5 / weightedTotal5 : 0.5;
const last10Rate = weightedTotal10 > 0 ? weightedWins10 / weightedTotal10 : 0.5;


  const withDiff = last10.filter(m => m.gameDiff !== null && m.gameDiff !== undefined);
  const avgDiff = withDiff.length > 0
    ? withDiff.reduce((sum, m) => sum + m.gameDiff, 0) / withDiff.length
    : 0;

  const normDiff = clampValue((avgDiff + 5) / 10, 0, 1);

  const recentFormBlock =
    (last5Rate * 0.50) +
    (last10Rate * 0.30) +
    (normDiff * 0.20);

  const rawScore = (recentFormBlock - 0.5) * 8;
  const score = clampValue(rawScore, -2, 2);

  return {
    score: parseFloat(score.toFixed(2)),
    details: [
      {
        source: 'comparison_recent_form',
        last5Wins,
        last5Total: last5.length,
        last10Wins,
        last10Total: last10.length,
        avgDiff: parseFloat(avgDiff.toFixed(2)),
        recentFormBlock: parseFloat(recentFormBlock.toFixed(4))
      }
    ]
  };
}
// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Analyse complète d'un match de tennis entre deux joueurs.
 *
 * @param {string} player1Name
 * @param {string} player2Name
 * @param {string} surface     - clay | hard | indoor_hard | grass
 * @param {string} tournament  - Nom du tournoi (doit correspondre à la feuille "Tournois")
 * @returns {Object|null}      - Rapport complet ou null si données insuffisantes
 */
async function analyzeMatch(player1Name, player2Name, surface, tournament) {
  console.log(`\n ANALYSE : ${player1Name} vs ${player2Name}`);
  console.log(` Surface : ${surface} | Tournoi : ${tournament}\n`);
  console.log('🚀 analyzeMatch appelée');

  // ─── ÉTAPE 1 : RÉCUPÉRATION DES DONNÉES ────────────────────────────────────
  console.log(' Lecture des données...');

  const [baseData1, baseData2] = await Promise.all([
    fetchCompletePlayerData(player1Name, surface),
    fetchCompletePlayerData(player2Name, surface),
  ]);

const player1HasMinimumData =
  (baseData1?.allMatches?.length ?? 0) > 0 ||
  !!baseData1?.stats ||
  !!baseData1?.stats1y;

const player2HasMinimumData =
  (baseData2?.allMatches?.length ?? 0) > 0 ||
  !!baseData2?.stats ||
  !!baseData2?.stats1y;

if (!player1HasMinimumData || !player2HasMinimumData) {
  throw new Error(
    `Données insuffisantes pour l'analyse : ${
      !player1HasMinimumData ? player1Name : player2Name
    }`
  );
}


console.log('DEBUG PLAYER 1', {
  name: player1Name,
  allMatches: baseData1?.allMatches?.length,
  last10ATP: baseData1?.last10ATP?.length,
  stats: !!baseData1?.stats,
  stats1y: !!baseData1?.stats1y,
  statsTop50: !!baseData1?.statsTop50,
  source: baseData1?.source
});

console.log('DEBUG PLAYER 2', {
  name: player2Name,
  allMatches: baseData2?.allMatches?.length,
  last10ATP: baseData2?.last10ATP?.length,
  stats: !!baseData2?.stats,
  stats1y: !!baseData2?.stats1y,
  statsTop50: !!baseData2?.statsTop50,
  source: baseData2?.source
});


  console.log(` ${player1Name} : ${baseData1.source.sheets} matchs Sheets + ${baseData1.source.web} matchs web`);
  console.log(` ${player2Name} : ${baseData2.source.sheets} matchs Sheets + ${baseData2.source.web} matchs web`);

 // ─── ÉTAPE 2 : ENRICHISSEMENT DES DONNÉES ─────────────────────────────────
  const data1 = await buildPlayerData(player1Name, surface, baseData1);
  const data2 = await buildPlayerData(player2Name, surface, baseData2);

  // Score A pondéré par niveau tournoi + classement adverse + surface
 const scoreA1 = calculateScoreAFromDataModel(data1.allMatches ?? [], surface);
const scoreA2 = calculateScoreAFromDataModel(data2.allMatches ?? [], surface);


  // Points à défendre
  const pts1ToDefend = await getPointsToDefend(player1Name, tournament);
  const pts2ToDefend = await getPointsToDefend(player2Name, tournament);

  // H2H
  const h2h = await getH2H(player1Name, player2Name);

  const h2hOnSurface1 = checkH2HOnSurface(data1.allMatches, player2Name, surface);
  const h2hOnSurface2 = checkH2HOnSurface(data2.allMatches, player1Name, surface);

  // Stats surface pour Score O
  const surfaceStats1 = deriveSurfaceStats(baseData1.stats, baseData1.stats1y, surface);
  const surfaceStats2 = deriveSurfaceStats(baseData2.stats, baseData2.stats1y, surface);


  const scores1 = buildScores(
    data1, data2,
    scoreA1, surfaceStats1,
    h2h?.pctJ1 ?? null, h2hOnSurface1,
    pts1ToDefend?.points ?? 0,
    surface
  );

  const scores2 = buildScores(
    data2, data1,
    scoreA2, surfaceStats2,
    h2h?.pctJ2 ?? null, h2hOnSurface2,
    pts2ToDefend?.points ?? 0,
    surface
  );

  // ─── ÉTAPE 4 : APPLICATION DES RÈGLES ──────────────────────────────────────
  const playerMeta1 = { ptsToDefend: pts1ToDefend?.points ?? 0, ranking: data1.ranking ?? 100 };
  const playerMeta2 = { ptsToDefend: pts2ToDefend?.points ?? 0, ranking: data2.ranking ?? 100 };

  const { player1Scores: finalScores1, player2Scores: finalScores2 } = applyRule6(
    applyAllRules(scores1, playerMeta1, playerMeta2),
    applyAllRules(scores2, playerMeta2, playerMeta1)
  );

  // ─── ÉTAPE 5 : RAPPORT FINAL ────────────────────────────────────────────────
  const rapport = generateReport(
    player1Name, player2Name,
    finalScores1, finalScores2,
    scoreA1.details, scoreA2.details,
    surface, tournament,
    data1.dataSource, data2.dataSource
  );
  console.log('[DEBUG] typeof rapport:', typeof rapport);

  // Injection des stats brutes dans le rapport (STATS / STATS_1Y / STATS_TOP50)
  rapport.playerStats = {
    joueur1: {
      stats:      baseData1.stats      ?? null,
      stats1y:    baseData1.stats1y    ?? null,
      statsTop50: baseData1.statsTop50 ?? null,
    },
    joueur2: {
      stats:      baseData2.stats      ?? null,
      stats1y:    baseData2.stats1y    ?? null,
      statsTop50: baseData2.statsTop50 ?? null,
    },
  };

  // Nouveau modèle de comparaison (STATS + STATS_1Y + STATS_TOP50 + forme récente + H2H)
  rapport.comparison = comparePlayers(baseData1, baseData2, surface, player1Name, player2Name);

  const mainNorm = normalizeMainScores(
    finalScores1.TOTAL ?? 0,
    finalScores2.TOTAL ?? 0
  );

  const dataNorm = normalizeMainScores(
    rapport.comparison.scoreA ?? 0.5,
    rapport.comparison.scoreB ?? 0.5
  );

  const dataScore1 = dataNorm.score1;
  const dataScore2 = dataNorm.score2;

  const hybridScore1 = (mainNorm.score1 * 0.30) + (dataScore1 * 0.70);
  const hybridScore2 = (mainNorm.score2 * 0.30) + (dataScore2 * 0.70);


  const hybridWinner = hybridScore1 >= hybridScore2 ? player1Name : player2Name;
  const modelsAligned = rapport.verdict.favori === rapport.comparison.winner;
  const hybridGap = Math.abs(hybridScore1 - hybridScore2);
  const hybridConfidence = buildHybridConfidence(hybridGap, modelsAligned);

  rapport.hybrid = {
    mainModel: {
      winner: rapport.verdict.favori,
      total1: finalScores1.TOTAL ?? 0,
      total2: finalScores2.TOTAL ?? 0,
      score1: parseFloat(mainNorm.score1.toFixed(4)),
      score2: parseFloat(mainNorm.score2.toFixed(4))
    },
    dataModel: {
      winner: rapport.comparison.winner,
      score1: parseFloat(dataScore1.toFixed(4)),
      score2: parseFloat(dataScore2.toFixed(4))
    },
    merged: {
      winner: hybridWinner,
      score1: parseFloat(hybridScore1.toFixed(4)),
      score2: parseFloat(hybridScore2.toFixed(4)),
      gap: parseFloat(hybridGap.toFixed(4)),
      confidence: hybridConfidence
    },
    agreement: {
      aligned: modelsAligned
    }
  };
rapport.verdict.favori = rapport.hybrid.merged.winner;
  rapport.verdict.ecart = rapport.hybrid.merged.gap;
  rapport.verdict.confiance = rapport.hybrid.merged.confidence.label;
  rapport.verdict.niveauConfiance = rapport.hybrid.merged.confidence.level;
  console.log('✅ HYBRID ACTIVE', rapport.hybrid);
  return rapport;
}

module.exports = { analyzeMatch };

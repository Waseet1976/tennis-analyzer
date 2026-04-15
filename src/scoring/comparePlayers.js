'use strict';

/**
 * comparePlayers.js — Moteur de comparaison joueur vs joueur
 *
 * Utilise exclusivement les données issues des 4 feuilles Google Sheets :
 *   STATS        → performances long terme
 *   STATS_1Y     → performances des 12 derniers mois
 *   STATS_TOP50  → performances vs top 50 (qualitatif)
 *   2025-atp-season → forme récente + H2H
 *
 * RÈGLE : aucune valeur inventée — si une donnée est absente, son bloc
 * est marqué unavailable et son poids est redistribué.
 */

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/** Borne une valeur entre min et max. */
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Parse une valeur de cellule Sheets en float.
 * Gère les formats "0.65", "65", "65%", "65,3", "57,50%".
 * Si la valeur porte un "%" → divise par 100 (stockage pourcentage Google Sheets).
 * Retourne `fallback` si la valeur est absente ou non parsable.
 */
function safeFloat(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const s       = String(v).trim();
  const isPct   = s.endsWith('%');
  const cleaned = s.replace('%', '').replace(',', '.').trim();
  const n       = parseFloat(cleaned);
  if (isNaN(n)) return fallback;
  return isPct ? n / 100 : n;
}

function norm(s) {
  return (s ?? '').trim().toLowerCase();
}

// ─── Bloc 1 : Long terme (STATS) ──────────────────────────────────────────────

/**
 * Calcule le bloc long terme depuis la feuille STATS.
 * score_global, score_surface  → 0..1 directs
 * win_rate_total               → 0..1 direct
 * games_diff_avg               → normalisé avec clamp((x+5)/10, 0, 1)
 * service_points_won_avg       → 0..100, divisé par 100
 * return_points_won_avg        → 0..100, divisé par 100
 *
 * @param {Object|null} stats   - Ligne STATS du joueur
 * @param {string}      surface - clay | hard | indoor_hard | grass
 * @returns {{ score: number, available: boolean, raw: Object }}
 */
function calcLongTermBlock(stats, surface) {
  if (!stats) return { score: 0, available: false, raw: {} };

  const score_global  = safeFloat(stats.score_global);
  const score_surface = safeFloat(stats.score_surface);
  const win_rate      = safeFloat(stats.win_rate_total);
  const games_diff    = safeFloat(stats.games_diff_avg);
  const service       = safeFloat(stats.service_points_won_avg);
  const returnPts     = safeFloat(stats.return_points_won_avg);

  // Si les données essentielles sont toutes absentes, bloc indisponible
  if ([score_global, score_surface, win_rate].every(v => v === null)) {
    return { score: 0, available: false, raw: {} };
  }

  const sg  = score_global  ?? 0.5;
  const ss  = score_surface ?? sg;          // fallback sur score_global
  const wr  = win_rate      ?? 0.5;
  const ngd = games_diff !== null ? clamp((games_diff + 5) / 10, 0, 1) : 0.5;
  const srv = service   !== null ? service   / 100 : 0.5;
  const ret = returnPts !== null ? returnPts / 100 : 0.5;

  const score =
    (sg  * 0.30) +
    (ss  * 0.20) +
    (wr  * 0.10) +
    (ngd * 0.15) +
    (srv * 0.125) +
    (ret * 0.125);

  return {
    score: clamp(score, 0, 1),
    available: true,
    raw: { score_global, score_surface, win_rate, games_diff, service, returnPts },
  };
}

// ─── Bloc 2 : 1 an (STATS_1Y) ─────────────────────────────────────────────────

/**
 * Identique au bloc long terme mais depuis STATS_1Y (champs suffixés _1y).
 */
function calcOneYearBlock(stats1y, surface) {
  if (!stats1y) return { score: 0, available: false, raw: {} };

  const score_global  = safeFloat(stats1y.score_global_1y);
  const score_surface = safeFloat(stats1y.score_surface_1y);
  const win_rate      = safeFloat(stats1y.win_rate_total_1y);
  const games_diff    = safeFloat(stats1y.games_diff_avg_1y);
  const service       = safeFloat(stats1y.service_points_won_avg_1y);
  const returnPts     = safeFloat(stats1y.return_points_won_avg_1y);

  if ([score_global, score_surface, win_rate].every(v => v === null)) {
    return { score: 0, available: false, raw: {} };
  }

  const sg  = score_global  ?? 0.5;
  const ss  = score_surface ?? sg;
  const wr  = win_rate      ?? 0.5;
  const ngd = games_diff !== null ? clamp((games_diff + 5) / 10, 0, 1) : 0.5;
  const srv = service   !== null ? service   / 100 : 0.5;
  const ret = returnPts !== null ? returnPts / 100 : 0.5;

  const score =
    (sg  * 0.30) +
    (ss  * 0.20) +
    (wr  * 0.10) +
    (ngd * 0.15) +
    (srv * 0.125) +
    (ret * 0.125);

  return {
    score: clamp(score, 0, 1),
    available: true,
    raw: { score_global, score_surface, win_rate, games_diff, service, returnPts },
  };
}

// ─── Bloc 3 : Top 50 (STATS_TOP50) ────────────────────────────────────────────

/**
 * Calcule le bloc top 50 depuis l'historique brut (12 derniers mois, adversaires ≤ 50).
 * Ne lit plus win_rate_*_vs_top50 (colonne corrompue dans Google Sheets).
 *
 * @returns {{ score, available, reduced, matchCount }}
 */
/**
 * Parse un entier brut depuis une cellule Sheets (comptage de matchs/victoires).
 * Retourne 0 si absent ou non numérique.
 */
function parseInt50(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = parseInt(String(raw).replace(',', '.').trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Calcule un win rate en 0–1 depuis les colonnes de comptage brutes.
 * Évite le bug où win_rate_vs_top50 = "1" (formule cassée dans la feuille).
 * Retourne null si matches = 0.
 */
function calcRateFromCounts(winsRaw, matchesRaw) {
  const m = parseInt50(matchesRaw);
  const w = parseInt50(winsRaw);
  if (m === 0) return null;
  return clamp(w / m, 0, 1);
}

/**
 * Calcule un score global+surface depuis un ensemble de matchs filtrés.
 * Retourne null si aucun match.
 */
function _calcRateFromMatches(filtered, surface) {
  if (filtered.length === 0) return null;
  const globalWins = filtered.filter(m => m.resultat === 'V').length;
  const globalRate = clamp(globalWins / filtered.length, 0, 1);
  const onSurface  = filtered.filter(m => m.surface === surface);
  const surfaceRate = onSurface.length > 0
    ? clamp(onSurface.filter(m => m.resultat === 'V').length / onSurface.length, 0, 1)
    : globalRate;
  return { globalRate, surfaceRate, matchCount: filtered.length };
}

function calcTop50Block(allMatches, surface) {
  if (!allMatches || allMatches.length === 0) {
    return { score: 0, available: false, reduced: false, matchCount: 0 };
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const inRange = (m) => m.date && new Date(m.date) >= cutoff;
  const hasRank = (m) => m.rangAdversaire !== null && m.rangAdversaire !== undefined;

  // Matchs 12 mois vs Top 50
  const vs50 = allMatches.filter(m => inRange(m) && hasRank(m) && Number(m.rangAdversaire) <= 50);
  // Matchs 12 mois vs Top 51–100 (complément)
  const vs100 = allMatches.filter(m =>
    inRange(m) && hasRank(m) &&
    Number(m.rangAdversaire) > 50 && Number(m.rangAdversaire) <= 100
  );

  const top50Count  = vs50.length;
  const top100Count = vs100.length;

  // Aucune donnée exploitable
  if (top50Count === 0 && top100Count === 0) {
    return { score: 0, available: false, reduced: false, matchCount: 0 };
  }

  const r50  = _calcRateFromMatches(vs50,  surface);
  const r100 = _calcRateFromMatches(vs100, surface);

  let score, sourceUsed;

  // Poids dynamique Top 50 : croît linéairement de 0 à 1 entre 0 et 10 matchs
  const weight50 = Math.min(1, top50Count / 10);

  if (top50Count >= 10) {
    // CAS 1 — données Top 50 suffisantes : Top 50 seul
    const gr = r50.globalRate;
    const sr = r50.surfaceRate;
    score      = clamp((gr * 0.40) + (sr * 0.60), 0, 1);
    sourceUsed = 'top50';

  } else if (top50Count > 0) {
    // CAS 2 — Top 50 partiel : pondération dynamique Top50 + Top100 (×0.30)
    const gr50    = r50.globalRate;
    const sr50    = r50.surfaceRate;
    const score50 = clamp((gr50 * 0.40) + (sr50 * 0.60), 0, 1);

    if (r100) {
      const gr100    = r100.globalRate;
      const sr100    = r100.surfaceRate;
      const score100 = clamp((gr100 * 0.40) + (sr100 * 0.60), 0, 1);
      score = clamp((score50 * weight50 + score100 * 0.30) / (weight50 + 0.30), 0, 1);
      sourceUsed = 'top50+top100';
    } else {
      score = score50;
      sourceUsed = 'top50';
    }

  } else {
    // CAS 3 — 0 match Top 50 : Top 100 comme estimation de secours
    const gr = r100.globalRate;
    const sr = r100.surfaceRate;
    score      = clamp((gr * 0.40) + (sr * 0.60), 0, 1);
    sourceUsed = 'top100_only';
  }

  const matchCount = top50Count + (sourceUsed !== 'top50' ? top100Count : 0);
  const reduced    = top50Count < 5;

  console.log(`[Top50Block-1Y] surface=${surface} | top50=${top50Count} | top100=${top100Count} | source=${sourceUsed} | score=${score.toFixed(3)}`);

  return {
    score,
    available: true,
    reduced,
    matchCount,
    raw: {
      globalRate:     r50?.globalRate  ?? r100?.globalRate  ?? 0,
      surfaceRate:    r50?.surfaceRate ?? r100?.surfaceRate ?? 0,
      top50MatchCount:  top50Count,
      top100MatchCount: top100Count,
      sourceUsed,
    },
  };
}

// ─── Bloc 4 : Forme récente (2025-atp-season) ─────────────────────────────────

/**
 * Calcule le bloc forme récente depuis l'historique de matchs.
 *
 * @param {Array} allMatches - Matchs triés par date décroissante (du joueur)
 * @returns {{ score, available, raw }}
 */
function calcRecentFormBlock(allMatches) {
  if (!allMatches || allMatches.length === 0) {
    return { score: 0.5, available: false, raw: {} };
  }

  const atp   = allMatches.filter(m => m.niveau !== 'Challenger');
  const last5  = atp.slice(0, 5);
  const last10 = atp.slice(0, 10);

  // Taux de victoire
  const last5_wins = last5.filter(m => m.resultat === 'V').length;
  const last5_rate = last5.length > 0 ? last5_wins / last5.length : 0.5;

  const last10_wins = last10.filter(m => m.resultat === 'V').length;
  const last10_rate = last10.length > 0 ? last10_wins / last10.length : 0.5;

  // Différentiel moyen de jeux sur les 10 derniers matchs
  const withDiff = last10.filter(m => m.gameDiff !== null && m.gameDiff !== undefined);
  const avgDiff  = withDiff.length > 0
    ? withDiff.reduce((s, m) => s + m.gameDiff, 0) / withDiff.length
    : 0;
  const normDiff = clamp((avgDiff + 5) / 10, 0, 1);

  const score = clamp(
    (last5_rate * 0.50) +
    (last10_rate * 0.30) +
    (normDiff   * 0.20),
    0, 1
  );

  return {
    score,
    available: last5.length > 0,
    raw: { last5_wins, last5_total: last5.length, last10_wins, last10_total: last10.length, avgDiff },
  };
}

// ─── Ajustement H2H ───────────────────────────────────────────────────────────

/**
 * Calcule l'ajustement H2H depuis la perspective du joueur A.
 *
 * Règles de plafond selon le nombre de matchs :
 *   0 → 0  |  1 → ±0.03  |  2–3 → ±0.06  |  4–6 → ±0.10  |  7+ → ±0.15
 *
 * surface_multiplier : 1.0 si H2H sur même surface, 0.6 sinon
 * recency_multiplier : 1.0 si le match le plus récent < 2 ans, 0.7 sinon
 *
 * @param {Array}  allMatchesA - Matchs du joueur A (adversaire = nom du joueur B)
 * @param {string} nameBNorm   - nom normalisé du joueur B
 * @param {string} surface
 * @returns {{ adjustment: number, total: number, wins: number, onSurface: boolean }}
 */
function calcH2HAdjustment(allMatchesA, nameBNorm, surface) {
  const h2h = allMatchesA.filter(m => norm(m.adversaire) === nameBNorm);
  const total = h2h.length;

  if (total === 0) return { adjustment: 0, total: 0, wins: 0, onSurface: false };

  const wins = h2h.filter(m => m.resultat === 'V').length;
  const ratio    = wins / total;
  const centered = (ratio - 0.5) / 0.5;   // -1..+1

  // Plafond selon nombre de matchs
  const maxBonus = total === 1 ? 0.03
    : total <= 3 ? 0.06
    : total <= 6 ? 0.10
    : 0.15;

  // Surface multiplier : proportion des H2H sur la même surface
  const onSurface = h2h.filter(m => m.surface === surface).length;
  const surfMult  = onSurface > 0 ? 1.0 : 0.6;

  // Recency : le match le plus récent dans les 2 dernières années ?
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const mostRecent = h2h[0]?.date ?? null;
  const isRecent   = mostRecent && new Date(mostRecent) >= twoYearsAgo;
  const recencyMult = isRecent ? 1.0 : 0.7;

  const adjustment = centered * maxBonus * surfMult * recencyMult;

  return {
    adjustment: clamp(adjustment, -maxBonus, maxBonus),
    total,
    wins,
    ratio,
    onSurface: onSurface > 0,
  };
}

// ─── Verdict et confiance ─────────────────────────────────────────────────────

/**
 * Calcule le niveau de confiance en tenant compte :
 *   - de l'écart brut entre les deux scores finaux
 *   - de la proportion de blocs disponibles (data_confidence)
 */
function calcConfidence(scoreA, scoreB, blocksA, blocksB) {
  const gap = Math.abs(scoreA - scoreB);

  const totalBlocks = 4 * 2;
  const availBlocks =
    (blocksA.lt.available ? 1 : 0) +
    (blocksA.oy.available ? 1 : 0) +
    (blocksA.top50.available ? 1 : 0) +
    (blocksA.form.available ? 1 : 0) +
    (blocksB.lt.available ? 1 : 0) +
    (blocksB.oy.available ? 1 : 0) +
    (blocksB.top50.available ? 1 : 0) +
    (blocksB.form.available ? 1 : 0);

  const dataCoverage = availBlocks / totalBlocks;
  const adjustedGap = gap * dataCoverage;

  if (adjustedGap >= 0.08) return { label: 'Élevée', level: 3 };
  if (adjustedGap >= 0.04) return { label: 'Modérée', level: 2 };
  if (adjustedGap >= 0.015) return { label: 'Légère', level: 1 };
  return { label: 'Très serré', level: 0 };
}

// ─── Génération de l'explication ─────────────────────────────────────────────

/**
 * Génère un texte d'explication et une liste d'avantages clés.
 */
function buildExplanation(nameA, nameB, scoreA, scoreB, detailsA, detailsB, h2hA, surface) {
  const winner = scoreA >= scoreB ? nameA : nameB;
  const loser  = scoreA >= scoreB ? nameB : nameA;
  const winnerDetails = scoreA >= scoreB ? detailsA : detailsB;
  const loserDetails  = scoreA >= scoreB ? detailsB : detailsA;

  const gap = Math.abs(scoreA - scoreB);

  const blocks = [
    ['long_term_block', 'Stats long terme'],
    ['one_year_block', 'Forme sur 1 an'],
    ['top50_block', 'Niveau contre top 50'],
    ['recent_form_block', 'Forme récente']
  ];

  const advantages = [];

  for (const [key, label] of blocks) {
    const w = winnerDetails[key];
    const l = loserDetails[key];

    if (w === null || l === null) continue;

    if (w > l) {
      advantages.push(`${winner} › ${label}`);
    } else if (l > w) {
     advantages.push(`${loser} › ${label}`);
    }
  }

  if (Math.abs(h2hA.adjustment) >= 0.015) {
  advantages.push(
    h2hA.adjustment > 0
     ? `${nameA} › Head-to-Head (${h2hA.wins}/${h2hA.total})`
     : `${nameB} › Head-to-Head`
  );
}

  const winnerAdvantages = advantages.filter(a => a.startsWith(winner));
  const loserAdvantages  = advantages.filter(a => a.startsWith(loser));

  let intro;
  if (gap >= 0.08) intro = `${winner} est favori avec un avantage net sur ${surface}`;
  else if (gap >= 0.04) intro = `${winner} est favori avec un avantage assez clair sur ${surface}`;
  else if (gap >= 0.015) intro = `${winner} est légèrement favori sur ${surface}`;
  else intro = `${winner} garde un très léger avantage dans un match extrêmement serré sur ${surface}`;


   let explanation =
    `${intro}, avec un score de ${Math.max(scoreA, scoreB).toFixed(3)} contre ${Math.min(scoreA, scoreB).toFixed(3)} ` +
    `(écart : ${gap.toFixed(3)}).`;

  if (winnerAdvantages.length > 0) {
    explanation += ` Ses principaux atouts sont : ${winnerAdvantages
      .slice(0, 3)
      .map(x => x.split('› ')[1])
      .join(', ')}.`;
  }

  if (loserAdvantages.length > 0 && gap < 0.05) {
    explanation += ` ${loser} conserve néanmoins des arguments solides, notamment : ${loserAdvantages
      .slice(0, 2)
      .map(x => x.split('› ')[1])
      .join(', ')}.`;
  }

  return {
    explanation,
    key_advantages: advantages
  };
}
// ─── Bonus de domination élite ────────────────────────────────────────────────

/**
 * Calcule un bonus d'élite pour le joueur qui domine clairement sur plusieurs blocs.
 * Chaque condition vérifiée ajoute STEP au bonus du joueur dominant.
 * Le bonus est plafonné à MAX_BONUS pour éviter les effets de bord.
 *
 * Conditions (seuils calibrés pour les matchs vraiment déséquilibrés) :
 *   LT   : score ≥ 0.80 vs adversaire ≤ 0.55
 *   1Y   : score ≥ 0.80 vs adversaire ≤ 0.55
 *   Top50: score ≥ 0.70 vs adversaire ≤ 0.45
 *   Forme: score ≥ 0.60 vs adversaire ≤ 0.40
 *
 * 3 conditions réunies → +0.075 (max effectif) ; plafond à +0.08.
 */
function calcDominationBonus(ltA, ltB, oyA, oyB, t50A, t50B, formA, formB) {
  const MAX_BONUS = 0.08;
  const STEP      = 0.025;

  let bonusA = 0;
  let bonusB = 0;

  // Long terme
  if (ltA.available && ltB.available) {
    if (ltA.score >= 0.80 && ltB.score <= 0.55) bonusA += STEP;
    if (ltB.score >= 0.80 && ltA.score <= 0.55) bonusB += STEP;
  }
  // 1 an
  if (oyA.available && oyB.available) {
    if (oyA.score >= 0.80 && oyB.score <= 0.55) bonusA += STEP;
    if (oyB.score >= 0.80 && oyA.score <= 0.55) bonusB += STEP;
  }
  // Top 50
  if (t50A.available && t50B.available) {
    if (t50A.score >= 0.70 && t50B.score <= 0.45) bonusA += STEP;
    if (t50B.score >= 0.70 && t50A.score <= 0.45) bonusB += STEP;
  }
  // Forme récente
  if (formA.available && formB.available) {
    if (formA.score >= 0.60 && formB.score <= 0.40) bonusA += STEP;
    if (formB.score >= 0.60 && formA.score <= 0.40) bonusB += STEP;
  }

  return {
    bonusA: clamp(bonusA, 0, MAX_BONUS),
    bonusB: clamp(bonusB, 0, MAX_BONUS),
  };
}

function comparePlayers(dataA, dataB, surface, nameA, nameB) {
  console.log(`[Compare] ${nameA} vs ${nameB} — surface: ${surface}`);

  const ltA   = calcLongTermBlock(dataA.stats, surface);
  const ltB   = calcLongTermBlock(dataB.stats, surface);
  const oyA   = calcOneYearBlock(dataA.stats1y, surface);
  const oyB   = calcOneYearBlock(dataB.stats1y, surface);
  const t50A  = calcTop50Block(dataA.allMatches ?? [], surface);
  const t50B  = calcTop50Block(dataB.allMatches ?? [], surface);
  const formA = calcRecentFormBlock(dataA.allMatches ?? []);
  const formB = calcRecentFormBlock(dataB.allMatches ?? []);

console.log('[TOP50 1Y]', {
  surface,
  matchCountA: t50A.matchCount,
  matchCountB: t50B.matchCount,
  scoreA: t50A.score,
  scoreB: t50B.score,
  reducedA: t50A.reduced,
  reducedB: t50B.reduced
});


  const nameBNorm = norm(nameB);
  const nameANorm = norm(nameA);
  const h2hA = calcH2HAdjustment(dataA.allMatches ?? [], nameBNorm, surface);
  const h2hB = calcH2HAdjustment(dataB.allMatches ?? [], nameANorm, surface);

  // ─── Poids fixes ─────────────────────────────────────────────────────────────
  // LT(0.20) + 1Y(0.45) + Top50(0.25) + Form(0.10) = 1.00
  const W_LT   = 0.20;
  const W_1Y   = 0.45;
  const W_T50  = 0.25;
  const W_FORM = 0.10;

  console.log(`[Compare] Poids fixes → LT=${W_LT} | 1Y=${W_1Y} | Top50=${W_T50} | Form=${W_FORM}`);

  const calcBaseScore = (lt, oy, top50, form) =>
    (lt.score   * W_LT)   +
    (oy.score   * W_1Y)   +
    (top50.score * W_T50)  +
    (form.score * W_FORM);

  const baseA = calcBaseScore(ltA, oyA, t50A, formA);
  const baseB = calcBaseScore(ltB, oyB, t50B, formB);

  // Score avant bonus (H2H inclus)
  const preA = clamp(baseA + h2hA.adjustment, 0, 1);
  const preB = clamp(baseB + h2hB.adjustment, 0, 1);

  // ─── Bonus de domination élite ────────────────────────────────────────────
  const domBonus = calcDominationBonus(ltA, ltB, oyA, oyB, t50A, t50B, formA, formB);

  console.log(`[Compare] Domination → bonusA=${domBonus.bonusA.toFixed(3)} | bonusB=${domBonus.bonusB.toFixed(3)}`);
  console.log(`[Compare] Scores avant bonus → ${nameA}=${preA.toFixed(3)} | ${nameB}=${preB.toFixed(3)}`);

  let rawA = clamp(preA + domBonus.bonusA, 0, 1);
  let rawB = clamp(preB + domBonus.bonusB, 0, 1);

  // ─── Equilibrium adjustment ───────────────────────────────────────────────
  // Si les blocs long terme et 1 an sont serrés mais qu'un seul bloc (ex. surface)
  // tire le score vers un faux 60/40, on rapproche légèrement les scores finaux.
  const deltaLT   = Math.abs(ltA.score   - ltB.score);
  const delta1Y   = Math.abs(oyA.score   - oyB.score);
  const deltaT50  = Math.abs(t50A.score  - t50B.score);
  const deltaForm = Math.abs(formA.score - formB.score);
  const deltaFinal = Math.abs(rawA - rawB);

  // Top 50 compense en faveur du perdant actuel ?
  const leaderRaw   = rawA >= rawB ? 'A' : 'B';
  const t50Leader   = t50A.score >= t50B.score ? 'A' : 'B';
  const top50Compensates = t50A.available && t50B.available && t50Leader !== leaderRaw;

  const equilibriumDetected =
    deltaLT   <= 0.08 &&
    delta1Y   <= 0.08 &&
    deltaForm <= 0.10 &&
    top50Compensates;

  let adjustmentApplied = 0;
  let finalA = rawA;
  let finalB = rawB;

  if (equilibriumDetected && deltaFinal > 0.04) {
    // Rapprocher les scores de 20%, sans les inverser
    const ratio = 0.20;
    const mid   = (rawA + rawB) / 2;
    finalA = rawA + (mid - rawA) * ratio;
    finalB = rawB + (mid - rawB) * ratio;
    adjustmentApplied = ratio;
  }

  console.log(`[Equilibrium] deltaLT=${deltaLT.toFixed(3)} delta1Y=${delta1Y.toFixed(3)} deltaT50=${deltaT50.toFixed(3)} deltaForm=${deltaForm.toFixed(3)}`);
  console.log(`[Equilibrium] top50Compensates=${top50Compensates} equilibriumDetected=${equilibriumDetected} adjustment=${adjustmentApplied} | ${nameA}: ${rawA.toFixed(3)}→${finalA.toFixed(3)} | ${nameB}: ${rawB.toFixed(3)}→${finalB.toFixed(3)}`);

  const confidence = calcConfidence(
    finalA, finalB,
    { lt: ltA, oy: oyA, top50: t50A, form: formA },
    { lt: ltB, oy: oyB, top50: t50B, form: formB }
  );

  const detailsA = {
    long_term_block: ltA.available ? ltA.score : null,
    one_year_block: oyA.available ? oyA.score : null,
    top50_block: t50A.available ? t50A.score : null,
    recent_form_block: formA.available ? formA.score : null,
    h2h_adjustment: h2hA.adjustment,
    raw: { lt: ltA.raw, oy: oyA.raw, form: formA.raw, top50: t50A.raw ?? null },
  };

  const detailsB = {
    long_term_block: ltB.available ? ltB.score : null,
    one_year_block: oyB.available ? oyB.score : null,
    top50_block: t50B.available ? t50B.score : null,
    recent_form_block: formB.available ? formB.score : null,
    h2h_adjustment: h2hB.adjustment,
    raw: { lt: ltB.raw, oy: oyB.raw, form: formB.raw, top50: t50B.raw ?? null },
  };

  const { explanation, key_advantages } = buildExplanation(
    nameA, nameB, finalA, finalB, detailsA, detailsB, h2hA, surface
  );

  console.log(
    `[Compare] ${nameA}: LT=${ltA.score.toFixed(3)} 1Y=${oyA.score.toFixed(3)}` +
    ` T50=${t50A.score.toFixed(3)} Form=${formA.score.toFixed(3)} bonus=${domBonus.bonusA.toFixed(3)} raw=${rawA.toFixed(3)} Final=${finalA.toFixed(3)}`
  );
  console.log(
    `[Compare] ${nameB}: LT=${ltB.score.toFixed(3)} 1Y=${oyB.score.toFixed(3)}` +
    ` T50=${t50B.score.toFixed(3)} Form=${formB.score.toFixed(3)} bonus=${domBonus.bonusB.toFixed(3)} raw=${rawB.toFixed(3)} Final=${finalB.toFixed(3)}`
  );

  return {
    scoreA: parseFloat(finalA.toFixed(4)),
    scoreB: parseFloat(finalB.toFixed(4)),
    winner: finalA >= finalB ? nameA : nameB,
    confidence,
    details: {
      joueur1: detailsA,
      joueur2: detailsB,
      weights: {
        long_term:   W_LT,
        one_year:    W_1Y,
        top50:       W_T50,
        recent_form: W_FORM,
      },
      h2h: {
        total: h2hA.total,
        winsA: h2hA.wins,
        winsB: h2hA.total - h2hA.wins,
        onSurface: h2hA.onSurface
      },
    },
    explanation,
    key_advantages,
  };
}

module.exports = { comparePlayers };

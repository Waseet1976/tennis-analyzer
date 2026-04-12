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
 * Calcule le bloc top 50.
 * Choisit win_rate_clay_vs_top50 ou win_rate_hard_vs_top50 selon la surface.
 * Réduit automatiquement le poids si moins de 5 matchs vs top 50.
 *
 * @returns {{ score, available, reduced, matchCount }}
 */
function calcTop50Block(statsTop50, surface) {
  if (!statsTop50) return { score: 0, available: false, reduced: false, matchCount: 0 };

  const globalRate = safeFloat(statsTop50.win_rate_vs_top50);
  const matchCount = parseInt(statsTop50.matches_vs_top50 ?? '0', 10) || 0;

  let surfaceRate;
  if (surface === 'clay') {
    surfaceRate = safeFloat(statsTop50.win_rate_clay_vs_top50);
  } else if (surface === 'hard' || surface === 'indoor_hard') {
    surfaceRate = safeFloat(statsTop50.win_rate_hard_vs_top50);
  } else {
    surfaceRate = null;
  }
  // Fallback : si pas de taux surface, utiliser global
  surfaceRate = surfaceRate ?? globalRate;

  if (globalRate === null && surfaceRate === null) {
    return { score: 0, available: false, reduced: false, matchCount };
  }

  const gr = globalRate  ?? 0.5;
  const sr = surfaceRate ?? gr;

  const score = clamp((gr * 0.40) + (sr * 0.60), 0, 1);
  const reduced = matchCount < 5;

  return { score, available: true, reduced, matchCount, raw: { globalRate, surfaceRate } };
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
function comparePlayers(dataA, dataB, surface, nameA, nameB) {
  console.log(`[Compare] ${nameA} vs ${nameB} — surface: ${surface}`);

  const ltA   = calcLongTermBlock(dataA.stats, surface);
  const ltB   = calcLongTermBlock(dataB.stats, surface);
  const oyA   = calcOneYearBlock(dataA.stats1y, surface);
  const oyB   = calcOneYearBlock(dataB.stats1y, surface);
  const t50A  = calcTop50Block(dataA.statsTop50, surface);
  const t50B  = calcTop50Block(dataB.statsTop50, surface);
  const formA = calcRecentFormBlock(dataA.allMatches ?? []);
  const formB = calcRecentFormBlock(dataB.allMatches ?? []);

  const nameBNorm = norm(nameB);
  const nameANorm = norm(nameA);
  const h2hA = calcH2HAdjustment(dataA.allMatches ?? [], nameBNorm, surface);
  const h2hB = calcH2HAdjustment(dataB.allMatches ?? [], nameANorm, surface);

  const w_top50 = (t50A.available && !t50A.reduced && t50B.available && !t50B.reduced) ? 0.15 : 0.05;
  const w_1y    = 0.40 + (0.15 - w_top50);

  const calcBaseScore = (lt, oy, top50, form) =>
    (lt.score * 0.35) +
    (oy.score * w_1y) +
    (top50.score * w_top50) +
    (form.score * 0.10);

  const baseA = calcBaseScore(ltA, oyA, t50A, formA);
  const baseB = calcBaseScore(ltB, oyB, t50B, formB);

  const finalA = clamp(baseA + h2hA.adjustment, 0, 1);
  const finalB = clamp(baseB + h2hB.adjustment, 0, 1);

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
    raw: { lt: ltA.raw, oy: oyA.raw, form: formA.raw },
  };

  const detailsB = {
    long_term_block: ltB.available ? ltB.score : null,
    one_year_block: oyB.available ? oyB.score : null,
    top50_block: t50B.available ? t50B.score : null,
    recent_form_block: formB.available ? formB.score : null,
    h2h_adjustment: h2hB.adjustment,
    raw: { lt: ltB.raw, oy: oyB.raw, form: formB.raw },
  };

  const { explanation, key_advantages } = buildExplanation(
    nameA, nameB, finalA, finalB, detailsA, detailsB, h2hA, surface
  );

  console.log(
    `[Compare] ${nameA}: LT=${ltA.score.toFixed(3)} 1Y=${oyA.score.toFixed(3)}` +
    ` T50=${t50A.score.toFixed(3)} Form=${formA.score.toFixed(3)} Final=${finalA.toFixed(3)}`
  );
  console.log(
    `[Compare] ${nameB}: LT=${ltB.score.toFixed(3)} 1Y=${oyB.score.toFixed(3)}` +
    ` T50=${t50B.score.toFixed(3)} Form=${formB.score.toFixed(3)} Final=${finalB.toFixed(3)}`
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
        long_term: 0.35,
        one_year: w_1y,
        top50: w_top50,
        recent_form: 0.10
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

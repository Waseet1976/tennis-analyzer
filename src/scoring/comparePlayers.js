'use strict';

/**
 * comparePlayers.js — Moteur de comparaison joueur vs joueur
 *
 * Modèle en 4 grands blocs :
 *   1. Surface du match        (win rate spécifique à la surface)
 *   2. Niveau global           (1 an + 6 mois)
 *   3. Qualité d'opposition    (Top 20 / Top 50 / Top 100)
 *   4. Qualité de jeu          (service + retour)
 *
 * Les poids varient selon la surface (hard / clay / grass).
 * RÈGLE : aucune valeur inventée — si une donnée est absente, son poids
 * est redistribué sur les composantes disponibles.
 */

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Parse une valeur de cellule Sheets en float.
 * Gère "0.65", "65", "65%", "65,3", "57,50%".
 * Si "%" → divise par 100. Retourne `fallback` si absent ou non parsable.
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

// ─── Bloc 1 : Surface du match ────────────────────────────────────────────────

/**
 * Calcule le score du joueur sur la surface du match.
 * Combine : win rate surface LT + win rate surface 1 an + historique brut.
 * Fiabilité exponentielle sur l'historique (neutre si peu de matchs).
 *
 * @param {Object} stats     - Ligne STATS
 * @param {Object} stats1y   - Ligne STATS_1Y
 * @param {Array}  allMatches
 * @param {string} surface   - clay | hard | grass
 * @returns {{ score, available, matchCount }}
 */
function calculateSurfaceBlock(stats, stats1y, allMatches, surface) {
  const fieldLT = surface === 'clay'  ? 'win_rate_clay'
    : surface === 'grass' ? 'win_rate_grass'
    : 'win_rate_hard';
  const field1y = surface === 'clay'  ? 'win_rate_clay_1y'
    : surface === 'grass' ? 'win_rate_grass_1y'
    : 'win_rate_hard_1y';

  const rawLT = safeFloat(stats?.[fieldLT])   ?? safeFloat(stats?.score_surface);
  const raw1y = safeFloat(stats1y?.[field1y]) ?? safeFloat(stats1y?.score_surface_1y);

  const wrLT = rawLT !== null ? (rawLT > 1 ? rawLT / 100 : rawLT) : null;
  const wr1y = raw1y !== null ? (raw1y > 1 ? raw1y / 100 : raw1y) : null;

  // Historique brut sur la surface
  const onSurface  = (allMatches ?? []).filter(m => m.surface === surface);
  const matchCount = onSurface.length;
  const wins       = onSurface.filter(m => m.resultat === 'V').length;
  const wrHist     = matchCount > 0 ? wins / matchCount : null;

  // Fiabilité (tend vers neutre si peu de matchs)
  const reliab  = 1 - Math.exp(-matchCount / 20);
  const wrHistW = wrHist !== null ? wrHist * reliab + 0.5 * (1 - reliab) : null;

  // Pondération redistribuée sur les composantes disponibles
  let score = 0;
  let w     = 0;
  if (wr1y    !== null) { score += 0.45 * wr1y;    w += 0.45; }
  if (wrHistW !== null) { score += 0.35 * wrHistW; w += 0.35; }
  if (wrLT    !== null) { score += 0.20 * wrLT;    w += 0.20; }

  if (w < 0.20) return { score: 0.5, available: false, matchCount };

  return {
    score:      clamp(score / w, 0, 1),
    available:  true,
    matchCount,
  };
}

// ─── Bloc 2 : Niveau global (1 an + 6 mois) ──────────────────────────────────

/**
 * Calcule le niveau général sur 1 an (STATS_1Y) et sur 6 mois (allMatches).
 * Les deux sous-scores sont exposés séparément pour une pondération indépendante.
 *
 * @returns {{ score1y, score6m, available1y, available6m }}
 */
function calculateTrendBlock(stats1y, allMatches) {
  // Niveau 1 an — score_global_1y en priorité, win_rate_total_1y en fallback
  const raw1y   = safeFloat(stats1y?.score_global_1y) ?? safeFloat(stats1y?.win_rate_total_1y);
  const score1y = raw1y !== null ? (raw1y > 1 ? raw1y / 100 : raw1y) : null;

  // Niveau 6 mois — calculé depuis l'historique
  const cutoff6m = new Date();
  cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const last6m   = (allMatches ?? []).filter(m => m.date && new Date(m.date) >= cutoff6m);
  const wins6m   = last6m.filter(m => m.resultat === 'V').length;

  // Fiabilité 6 mois (min 3 matchs, tend vers neutre sinon)
  const rawScore6m  = last6m.length >= 3 ? wins6m / last6m.length : null;
  const reliab6m    = last6m.length >= 3 ? 1 - Math.exp(-last6m.length / 8) : 0;
  const score6m     = rawScore6m !== null
    ? rawScore6m * reliab6m + 0.5 * (1 - reliab6m)
    : null;

  return {
    score1y:     score1y  ?? 0.5,
    score6m:     score6m  ?? score1y ?? 0.5,
    available1y: score1y  !== null,
    available6m: last6m.length >= 3,
  };
}

// ─── Bloc 3 : Qualité d'opposition (Top 20 / 50 / 100) ───────────────────────

/**
 * Calcule le score contre les meilleurs adversaires sur 12 mois.
 * Hiérarchie : Top 20 (50%) > Top 50 (35%) > Top 100 (15%).
 * Fiabilité exponentielle par palier (peu de matchs → poids faible).
 * Expose raw.top50.surfaceRate pour la compatibilité avec analyze-daily.js.
 *
 * @returns {{ score, available, raw }}
 */
function calculateOppositionBlock(allMatches, surface) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const recent  = (allMatches ?? []).filter(m => m.date && new Date(m.date) >= cutoff);
  const hasRank = m => m.rangAdversaire != null && m.rangAdversaire !== '';

  const top20  = recent.filter(m => hasRank(m) && Number(m.rangAdversaire) <= 20);
  const top50  = recent.filter(m => hasRank(m) && Number(m.rangAdversaire) <= 50);
  const top100 = recent.filter(m => hasRank(m) && Number(m.rangAdversaire) <= 100);

  const calcWR = ms => ms.length > 0
    ? ms.filter(m => m.resultat === 'V').length / ms.length
    : null;

  const wr20  = calcWR(top20);
  const wr50  = calcWR(top50);
  const wr100 = calcWR(top100);

  // Fiabilité exponentielle (seuils calibrés ATP)
  const rel20  = wr20  !== null ? 1 - Math.exp(-top20.length  /  8) : 0;
  const rel50  = wr50  !== null ? 1 - Math.exp(-top50.length  / 10) : 0;
  const rel100 = wr100 !== null ? 1 - Math.exp(-top100.length / 15) : 0;

  const w20    = rel20  * 0.50;
  const w50    = rel50  * 0.35;
  const w100   = rel100 * 0.15;
  const totalW = w20 + w50 + w100;

  // Taux surface Top 50 pour compatibilité analyze-daily.js (extractVisualStats)
  const top50onSurf = top50.filter(m => m.surface === surface);
  const surfaceRate = top50onSurf.length > 0
    ? top50onSurf.filter(m => m.resultat === 'V').length / top50onSurf.length
    : (wr50 ?? null);

  if (totalW < 0.05) {
    return { score: 0.5, available: false, raw: { top50: { surfaceRate } } };
  }

  const score =
    ((wr20  ?? 0.5) * w20 +
     (wr50  ?? 0.5) * w50 +
     (wr100 ?? 0.5) * w100) / totalW;

  console.log(
    `[Opposition] top20=${top20.length}(${(wr20 ?? 0).toFixed(2)}) ` +
    `top50=${top50.length}(${(wr50 ?? 0).toFixed(2)}) ` +
    `top100=${top100.length}(${(wr100 ?? 0).toFixed(2)}) → ${score.toFixed(3)}`
  );

  return {
    score:     clamp(score, 0, 1),
    available: true,
    raw: {
      top50: { surfaceRate },   // ← lu par extractVisualStats dans analyze-daily.js
    },
  };
}

// ─── Bloc 4 : Qualité de jeu (service + retour) ───────────────────────────────

/**
 * Score basé sur le % de points gagnés au service et en retour.
 * Priorité données 1 an, fallback long terme.
 *
 * @returns {{ score, available }}
 */
function calculateServeReturnBlock(stats, stats1y) {
  const srvRaw = safeFloat(stats1y?.service_points_won_avg_1y) ?? safeFloat(stats?.service_points_won_avg);
  const retRaw = safeFloat(stats1y?.return_points_won_avg_1y)  ?? safeFloat(stats?.return_points_won_avg);

  if (srvRaw === null && retRaw === null) return { score: 0.5, available: false };

  const srv = srvRaw !== null ? (srvRaw > 1 ? srvRaw / 100 : srvRaw) : 0.5;
  const ret = retRaw !== null ? (retRaw > 1 ? retRaw / 100 : retRaw) : 0.5;

  return {
    score:     clamp((srv + ret) / 2, 0, 1),
    available: srvRaw !== null || retRaw !== null,
  };
}

// ─── Ajustement H2H ───────────────────────────────────────────────────────────

/**
 * Calcule l'ajustement H2H depuis la perspective du joueur A.
 *
 * Plafonds selon le nombre de matchs :
 *   0 → 0  |  1 → ±0.03  |  2–3 → ±0.06  |  4–6 → ±0.10  |  7+ → ±0.15
 * surface_multiplier : 1.0 si H2H sur même surface, 0.6 sinon.
 * recency_multiplier : 1.0 si < 2 ans, 0.7 sinon.
 */
function calcH2HAdjustment(allMatchesA, nameBNorm, surface) {
  const h2h   = allMatchesA.filter(m => norm(m.adversaire) === nameBNorm);
  const total = h2h.length;

  if (total === 0) return { adjustment: 0, total: 0, wins: 0, onSurface: false };

  const wins     = h2h.filter(m => m.resultat === 'V').length;
  const ratio    = wins / total;
  const centered = (ratio - 0.5) / 0.5;

  const maxBonus = total === 1 ? 0.03
    : total <= 3  ? 0.06
    : total <= 6  ? 0.10
    : 0.15;

  const onSurface  = h2h.filter(m => m.surface === surface).length;
  const surfMult   = onSurface > 0 ? 1.0 : 0.6;

  const twoYearsAgo  = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const mostRecent   = h2h[0]?.date ?? null;
  const isRecent     = mostRecent && new Date(mostRecent) >= twoYearsAgo;
  const recencyMult  = isRecent ? 1.0 : 0.7;

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
 * Confiance brute (recalibrée dans analyze-daily.js par classifyConfidence).
 */
function calcConfidence(scoreA, scoreB, blocksA, blocksB) {
  const gap = Math.abs(scoreA - scoreB);

  const totalBlocks = 4 * 2;
  const availBlocks =
    (blocksA.lt.available    ? 1 : 0) +
    (blocksA.oy.available    ? 1 : 0) +
    (blocksA.top50.available ? 1 : 0) +
    (blocksA.form.available  ? 1 : 0) +
    (blocksB.lt.available    ? 1 : 0) +
    (blocksB.oy.available    ? 1 : 0) +
    (blocksB.top50.available ? 1 : 0) +
    (blocksB.form.available  ? 1 : 0);

  const dataCoverage = availBlocks / totalBlocks;
  const adjustedGap  = gap * dataCoverage;

  if (adjustedGap >= 0.08)  return { label: 'Élevée',     level: 3 };
  if (adjustedGap >= 0.04)  return { label: 'Modérée',    level: 2 };
  if (adjustedGap >= 0.015) return { label: 'Légère',     level: 1 };
  return                           { label: 'Très serré', level: 0 };
}

// ─── Génération de l'explication ─────────────────────────────────────────────

function buildExplanation(nameA, nameB, scoreA, scoreB, detailsA, detailsB, h2hA, surface) {
  const winner        = scoreA >= scoreB ? nameA : nameB;
  const loser         = scoreA >= scoreB ? nameB : nameA;
  const winnerDetails = scoreA >= scoreB ? detailsA : detailsB;
  const loserDetails  = scoreA >= scoreB ? detailsB : detailsA;
  const gap           = Math.abs(scoreA - scoreB);

  const blocks = [
    ['long_term_block',   'Surface du match'],
    ['one_year_block',    'Niveau sur 1 an'],
    ['top50_block',       'Qualité d\'opposition'],
    ['recent_form_block', 'Forme récente (6 mois)'],
  ];

  const advantages = [];

  for (const [key, label] of blocks) {
    const w = winnerDetails[key];
    const l = loserDetails[key];
    if (w === null || l === null) continue;
    if (w > l)      advantages.push(`${winner} › ${label}`);
    else if (l > w) advantages.push(`${loser} › ${label}`);
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
  if (gap >= 0.08)   intro = `${winner} est favori avec un avantage net sur ${surface}`;
  else if (gap >= 0.04)  intro = `${winner} est favori avec un avantage assez clair sur ${surface}`;
  else if (gap >= 0.015) intro = `${winner} est légèrement favori sur ${surface}`;
  else                   intro = `${winner} garde un très léger avantage dans un match extrêmement serré sur ${surface}`;

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

  return { explanation, key_advantages: advantages };
}

// ─── Comparaison principale ───────────────────────────────────────────────────

function comparePlayers(dataA, dataB, surface, nameA, nameB) {
  console.log(`[Compare] ${nameA} vs ${nameB} — surface: ${surface}`);

  // ─── 4 blocs par joueur ──────────────────────────────────────────────────────
  const surfA  = calculateSurfaceBlock(dataA.stats, dataA.stats1y, dataA.allMatches ?? [], surface);
  const surfB  = calculateSurfaceBlock(dataB.stats, dataB.stats1y, dataB.allMatches ?? [], surface);

  const trendA = calculateTrendBlock(dataA.stats1y, dataA.allMatches ?? []);
  const trendB = calculateTrendBlock(dataB.stats1y, dataB.allMatches ?? []);

  const oppA   = calculateOppositionBlock(dataA.allMatches ?? [], surface);
  const oppB   = calculateOppositionBlock(dataB.allMatches ?? [], surface);

  const srA    = calculateServeReturnBlock(dataA.stats, dataA.stats1y);
  const srB    = calculateServeReturnBlock(dataB.stats, dataB.stats1y);

  // ─── Pondération selon la surface ────────────────────────────────────────────
  let W_SURF, W_1Y, W_6M, W_OPP, W_SR;

  if (surface === 'clay') {
    [W_SURF, W_1Y, W_6M, W_OPP, W_SR] = [0.30, 0.20, 0.15, 0.20, 0.15];
  } else if (surface === 'grass') {
    [W_SURF, W_1Y, W_6M, W_OPP, W_SR] = [0.30, 0.15, 0.20, 0.15, 0.20];
  } else {
    // hard (défaut)
    [W_SURF, W_1Y, W_6M, W_OPP, W_SR] = [0.25, 0.20, 0.20, 0.20, 0.15];
  }

  console.log(`[Compare] Poids → Surface=${W_SURF} 1Y=${W_1Y} 6M=${W_6M} Opp=${W_OPP} SR=${W_SR}`);

  const calcScore = (surf, trend, opp, sr) =>
    surf.score                              * W_SURF +
    trend.score1y                           * W_1Y   +
    trend.score6m                           * W_6M   +
    (opp.available ? opp.score : 0.5)       * W_OPP  +
    sr.score                                * W_SR;

  // ─── H2H ─────────────────────────────────────────────────────────────────────
  const nameBNorm = norm(nameB);
  const nameANorm = norm(nameA);
  const h2hA = calcH2HAdjustment(dataA.allMatches ?? [], nameBNorm, surface);
  const h2hB = calcH2HAdjustment(dataB.allMatches ?? [], nameANorm, surface);

  const baseA  = calcScore(surfA, trendA, oppA, srA);
  const baseB  = calcScore(surfB, trendB, oppB, srB);
  const finalA = clamp(baseA + h2hA.adjustment, 0, 1);
  const finalB = clamp(baseB + h2hB.adjustment, 0, 1);

  console.log(
    `[Compare] ${nameA}: surf=${surfA.score.toFixed(3)} 1y=${trendA.score1y.toFixed(3)} ` +
    `6m=${trendA.score6m.toFixed(3)} opp=${oppA.score.toFixed(3)} sr=${srA.score.toFixed(3)} → ${finalA.toFixed(3)}`
  );
  console.log(
    `[Compare] ${nameB}: surf=${surfB.score.toFixed(3)} 1y=${trendB.score1y.toFixed(3)} ` +
    `6m=${trendB.score6m.toFixed(3)} opp=${oppB.score.toFixed(3)} sr=${srB.score.toFixed(3)} → ${finalB.toFixed(3)}`
  );

  // ─── Confiance ───────────────────────────────────────────────────────────────
  const confidence = calcConfidence(
    finalA, finalB,
    { lt: { available: surfA.available },  oy: { available: trendA.available1y },
      top50: { available: oppA.available }, form: { available: srA.available } },
    { lt: { available: surfB.available },  oy: { available: trendB.available1y },
      top50: { available: oppB.available }, form: { available: srB.available } }
  );

  // ─── Détails (format compatible analyze-daily.js) ─────────────────────────
  // Les clés long_term_block / one_year_block / top50_block / recent_form_block
  // sont conservées pour que buildExplanation et extractVisualStats fonctionnent.
  const detailsA = {
    long_term_block:   surfA.available    ? surfA.score    : null,
    one_year_block:    trendA.available1y ? trendA.score1y : null,
    top50_block:       oppA.available     ? oppA.score     : null,
    recent_form_block: trendA.available6m ? trendA.score6m : null,
    h2h_adjustment:    h2hA.adjustment,
    raw: { top50: oppA.raw?.top50 ?? null },
  };

  const detailsB = {
    long_term_block:   surfB.available    ? surfB.score    : null,
    one_year_block:    trendB.available1y ? trendB.score1y : null,
    top50_block:       oppB.available     ? oppB.score     : null,
    recent_form_block: trendB.available6m ? trendB.score6m : null,
    h2h_adjustment:    h2hB.adjustment,
    raw: { top50: oppB.raw?.top50 ?? null },
  };

  const { explanation, key_advantages } = buildExplanation(
    nameA, nameB, finalA, finalB, detailsA, detailsB, h2hA, surface
  );

  return {
    scoreA:  parseFloat(finalA.toFixed(4)),
    scoreB:  parseFloat(finalB.toFixed(4)),
    winner:  finalA >= finalB ? nameA : nameB,
    confidence,
    details: {
      joueur1: detailsA,
      joueur2: detailsB,
      weights: {
        surface:      W_SURF,
        trend_1y:     W_1Y,
        trend_6m:     W_6M,
        opposition:   W_OPP,
        serve_return: W_SR,
      },
      h2h: {
        total:     h2hA.total,
        winsA:     h2hA.wins,
        winsB:     h2hA.total - h2hA.wins,
        onSurface: h2hA.onSurface,
      },
    },
    explanation,
    key_advantages,
  };
}

module.exports = { comparePlayers };

// Scores B à O — Calculs complémentaires

// ─── Score B — Niveau offensif (winners moyens) ───────────────────────────────

/**
 * @param {number|null} winnersAvg  - Moyenne de winners par match
 * @param {string}      playerStyle - "offensive" | "defensive" | autre
 */
function calculateScoreB(winnersAvg, playerStyle) {
  if (winnersAvg > 20) return { score: 5, source: 'stats' };
  if (winnersAvg > 10) return { score: 2, source: 'stats' };
  if (winnersAvg !== null) return { score: 0, source: 'stats' };
  // Données manquantes → estimation par style
  if (playerStyle === 'offensive') return { score: 2, source: 'estimation' };
  if (playerStyle === 'defensive') return { score: 0, source: 'estimation' };
  return { score: 1, source: 'estimation' };
}

// ─── Score C — Premier service (%) ───────────────────────────────────────────

/**
 * @param {number|null} firstServePct - % premier service entrant
 */
function calculateScoreC(firstServePct) {
  if (firstServePct === null) return { score: null, source: 'N/D' };
  if (firstServePct > 85) return { score: 3, source: 'stats' };
  if (firstServePct > 75) return { score: 2, source: 'stats' };
  if (firstServePct > 65) return { score: 1, source: 'stats' };
  return { score: 0, source: 'stats' };
}

// ─── Score D — Points à défendre ─────────────────────────────────────────────

/**
 * @param {number} ptsToDefend    - Points ATP à défendre dans ce tournoi
 * @param {number} currentPoints  - Total points ATP actuels du joueur
 * @param {number} rankDiff       - Écart de classement avec l'adversaire (positif = joueur mieux classé)
 */
function calculateScoreD(ptsToDefend, currentPoints, rankDiff) {
  const ratio = currentPoints > 0 ? ptsToDefend / currentPoints : 0;
  if (ptsToDefend === 0 && rankDiff >= 50) return { score:  5 };
  if (ptsToDefend === 0 && rankDiff >= 30) return { score:  4 };
  if (ptsToDefend === 0)                   return { score:  2 };
  if (ratio < 0.05)                        return { score:  2 };
  if (ratio < 0.10)                        return { score:  1 };
  if (ratio < 0.20 && rankDiff < 30)       return { score:  0 };
  if (ratio < 0.20 && rankDiff >= 30)      return { score: -2 };
  return { score: -3 };
}

// ─── Score E — Tie-breaks (%) ─────────────────────────────────────────────────

/**
 * @param {number|null} tiebrakPct - % tie-breaks gagnés
 */
function calculateScoreE(tiebrakPct) {
  if (tiebrakPct === null) return { score: null, source: 'N/D' };
  if (tiebrakPct > 60)  return { score: 2 };
  if (tiebrakPct >= 50) return { score: 1 };
  return { score: 0 };
}

// ─── Score F — 3e set / set décisif (%) ──────────────────────────────────────

/**
 * @param {number|null} decidingSetPct - % sets décisifs gagnés
 */
function calculateScoreF(decidingSetPct) {
  if (decidingSetPct === null) return { score: null, source: 'N/D' };
  if (decidingSetPct > 60)  return { score: 2 };
  if (decidingSetPct >= 50) return { score: 1 };
  return { score: 0 };
}

// ─── Score G — Forme récente (comparaison Score A 5 vs 10 matchs) ─────────────

/**
 * @param {number} scoreA10 - Score A calculé sur les 10 derniers matchs
 * @param {number} scoreA5  - Score A calculé sur les 5 derniers matchs
 */
function calculateScoreG(scoreA10, scoreA5) {
  if (scoreA5 > scoreA10) return { score:  2 };
  if (scoreA5 === scoreA10) return { score: 0 };
  return { score: -2 };
}

// ─── Score H — Fatigue physique ───────────────────────────────────────────────

/**
 * @param {number} matchesLast14Days   - Matchs joués dans les 14 derniers jours
 * @param {number} matchesIn3Sets      - Parmi eux, nombre en 3 sets
 * @param {number} lastMatchHoursAgo   - Heures depuis le dernier match
 */
function calculateScoreH(matchesLast14Days, matchesIn3Sets, lastMatchHoursAgo) {
  let score = 0;
  if (matchesLast14Days <= 2)      score =  2;
  else if (matchesLast14Days <= 4) score =  1;
  else if (matchesLast14Days <= 6) score =  0;
  else                             score = -1;
  if (matchesIn3Sets >= 3)   score -= 1;
  if (lastMatchHoursAgo < 24) score -= 2;
  return { score };
}

// ─── Score I — Head-to-Head ───────────────────────────────────────────────────

/**
 * @param {number|null} h2hPct          - % de victoires en H2H
 * @param {boolean}     h2hOnSameSurface - H2H sur la même surface ?
 */
function calculateScoreI(h2hPct, h2hOnSameSurface) {
  const coeff = h2hOnSameSurface ? 1.0 : 0.5;
  if (h2hPct === null) return { score: 0, source: '1re rencontre' };
  let raw = 0;
  if (h2hPct > 70)       raw =  2;
  else if (h2hPct > 55)  raw =  1;
  else if (h2hPct >= 45) raw =  0;
  else if (h2hPct >= 30) raw = -1;
  else                   raw = -2;
  return { score: raw * coeff };
}

// ─── Score J — Qualité adversaires (Règle 2) ──────────────────────────────────

/**
 * Règle 2 : si Score A < 0, Score J = 0 (protection).
 * @param {number} scoreA          - Score A du joueur
 * @param {number} avgOpponentRank - Classement moyen des adversaires récents
 */
function calculateScoreJ(scoreA, avgOpponentRank) {
  if (scoreA < 0) return { score: 0, note: 'Règle 2 activée' };
  if (avgOpponentRank < 30)  return { score: 2 };
  if (avgOpponentRank <= 60) return { score: 1 };
  return { score: 0 };
}

// ─── Score K — Âge du joueur ──────────────────────────────────────────────────

/**
 * @param {number} age - Âge du joueur en années
 */
function calculateScoreK(age) {
  if (age >= 24 && age <= 30) return { score:  1 };
  if (age >= 20 && age < 24)  return { score:  0 };
  if (age < 20)               return { score: -1 };
  if (age > 32)               return { score: -1 };
  return { score: 0 }; // 30 < âge <= 32
}

// ─── Score L — Conditions extérieures ────────────────────────────────────────

/**
 * @param {number} wind          - Vitesse du vent (km/h)
 * @param {number} temp          - Température (°C)
 * @param {number} humidity      - Humidité (%)
 * @param {string} playerStyle   - "offensive" | "defensive" | autre
 * @param {number} playerAge     - Âge du joueur
 * @param {string} targetSurface - Surface du match
 */
function calculateScoreL(wind, temp, humidity, playerStyle, playerAge, targetSurface) {
  let score = 0;
  if (wind > 30 && playerStyle === 'offensive') score -= 1;
  if (temp > 35 && playerAge > 30)             score -= 1;
  if (humidity > 80 && (targetSurface === 'hard' || targetSurface === 'indoor_hard')) score -= 1;
  return { score };
}

// ─── Score M — Momentum (Règle 2) ────────────────────────────────────────────

/**
 * Règle 2 : si Score A < 0, Score M = -2 (signal fort de méforme).
 * @param {number} scoreA - Score A du joueur
 */
function calculateScoreM(scoreA) {
  if (scoreA < 0)    return { score: -2, note: 'Règle 2 activée' };
  if (scoreA > 1.5)  return { score:  2 };   // score A dans [-2, +2] (calculateScoreAFromDataModel)
  if (scoreA > 0.5)  return { score:  1 };
  return { score: 0 };
}

// ─── Score N — Série de l'outsider ───────────────────────────────────────────

/**
 * @param {number} consecutiveOutsiderWins - Victoires consécutives en tant qu'outsider
 */
function calculateScoreN(consecutiveOutsiderWins) {
  if (consecutiveOutsiderWins <= 0) return { score: 0 };
  if (consecutiveOutsiderWins === 1) return { score: 2 };
  if (consecutiveOutsiderWins === 2) return { score: 3 };
  if (consecutiveOutsiderWins === 3) return { score: 4 };
  return { score: 5 };
}

// ─── Score O — Maîtrise de la surface ────────────────────────────────────────

/**
 * @param {Object} surfaceStats   - { pct, titres } depuis Stats_Surface
 * @param {Array}  notableWins    - [{ rank: number }] victoires notables sur la surface (saison en cours)
 * @param {Object} seasonRecord   - { matches: number, pct: number } bilan saison en cours
 */
function calculateScoreO(surfaceStats, notableWins, seasonRecord) {
  // Bloc 1 — victoires notables sur la surface cette saison
  let bloc1 = 0;
  for (const win of notableWins) {
    if (win.rank <= 10)       bloc1 += 6;
    else if (win.rank <= 20)  bloc1 += 5;
    else if (win.rank <= 50)  bloc1 += 3;
    else if (win.rank <= 100) bloc1 += 1;
  }
  bloc1 = Math.min(bloc1, 12);

  // Bloc 2 — bilan ATP sur la surface (5 ans)
  const pct = surfaceStats.pct;
  let bloc2 = 0;
  if (pct > 60)       bloc2 =  3;
  else if (pct > 50)  bloc2 =  1;
  else if (pct >= 40) bloc2 =  0;
  else                bloc2 = -3;

  // Bloc 3 — titres sur la surface
  let bloc3 = 0;
  if (surfaceStats.titres >= 3)       bloc3 = 3;
  else if (surfaceStats.titres === 2) bloc3 = 2;
  else if (surfaceStats.titres === 1) bloc3 = 1;

  // Bloc 4 — bilan saison en cours
  let bloc4 = 0;
  if (seasonRecord.matches < 3) {
    bloc4 = 0;
  } else if (seasonRecord.pct > 70) {
    bloc4 =  2;
  } else if (seasonRecord.pct >= 50) {
    bloc4 =  1;
  } else {
    bloc4 = -1;
  }

  return {
    score:  bloc1 + bloc2 + bloc3 + bloc4,
    detail: { bloc1, bloc2, bloc3, bloc4 },
  };
}

module.exports = {
  calculateScoreB,
  calculateScoreC,
  calculateScoreD,
  calculateScoreE,
  calculateScoreF,
  calculateScoreG,
  calculateScoreH,
  calculateScoreI,
  calculateScoreJ,
  calculateScoreK,
  calculateScoreL,
  calculateScoreM,
  calculateScoreN,
  calculateScoreO,
};

// Score A v3.0 — Calcul principal

// ─── Coefficients de surface ──────────────────────────────────────────────────

const SURFACE_COEFFICIENTS = {
  same:      1.0,  // même surface que le match analysé
  close:     0.5,  // hard ↔ indoor_hard
  different: 0.25, // clay vs hard, clay vs grass, hard vs grass
};

function getSurfaceCoefficient(matchSurface, targetSurface) {
  if (matchSurface === targetSurface) return SURFACE_COEFFICIENTS.same;
  if (
    (matchSurface === 'hard'        && targetSurface === 'indoor_hard') ||
    (matchSurface === 'indoor_hard' && targetSurface === 'hard')
  ) return SURFACE_COEFFICIENTS.close;
  return SURFACE_COEFFICIENTS.different;
}

// ─── Barèmes de points ────────────────────────────────────────────────────────

const WIN_POINTS = {
  top5:       6,
  top10:      5,
  top20:      4,
  top50:      2,
  top100:     1,
  outside100: 0.5,
};

const LOSS_POINTS = {
  top5:        1,
  top10:       0,
  top20:       0,
  top50:      -1,
  top100:     -2,
  outside100: -3,
};

function getRankCategory(ranking) {
  if (!ranking || ranking <= 0) return 'outside100';
  if (ranking <= 5)   return 'top5';
  if (ranking <= 10)  return 'top10';
  if (ranking <= 20)  return 'top20';
  if (ranking <= 50)  return 'top50';
  if (ranking <= 100) return 'top100';
  return 'outside100';
}

// ─── Calcul principal ─────────────────────────────────────────────────────────

/**
 * Calcule le Score A v3.0 sur les 10 derniers matchs (triés date décroissante).
 *
 * Règle 5 ABSOLUE : retourne une erreur si moins de 5 matchs disponibles.
 *
 * @param {Array}  matches       - Matchs du joueur (format getCompletePlayerData)
 * @param {string} targetSurface - Surface du match à analyser
 * @returns {{
 *   score:   number|null,
 *   details: Array,
 *   error:   string|null
 * }}
 */
function calculateScoreA(matches, targetSurface) {
  // RÈGLE 5 — ABSOLUE : minimum 5 matchs requis
  if (!matches || matches.length < 5) {
    return {
      score:   null,
      details: [],
      error:   'DONNÉES INSUFFISANTES — Score A non calculable',
    };
  }

  const details = [];
  let total = 0;

  for (const match of matches.slice(0, 10)) {
    const surfaceCoeff    = getSurfaceCoefficient(match.surface, targetSurface);
    const category        = getRankCategory(match.rangAdversaire);
    const rawPoints       = match.resultat === 'V' ? WIN_POINTS[category] : LOSS_POINTS[category];

    // Coefficient Challenger supplémentaire ÷ 2
    const challengerCoeff = match.niveau === 'Challenger' ? 0.5 : 1;
    const finalPoints     = rawPoints * surfaceCoeff * challengerCoeff;

    total += finalPoints;

    details.push({
      date:       match.date,
      tournoi:    match.tournoi,
      surface:    match.surface,
      adversaire: match.adversaire,
      rang:       match.rangAdversaire,
      resultat:   match.resultat,
      ptsBruts:   rawPoints,
      coeff:      surfaceCoeff * challengerCoeff,
      ptsFinal:   finalPoints,
    });
  }

  return {
    score:   Math.round(total * 100) / 100, // arrondi 2 décimales
    details,
    error:   null,
  };
}

module.exports = { calculateScoreA, getSurfaceCoefficient };

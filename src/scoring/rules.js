// 6 règles globales appliquées à l'ensemble des scores

const SCORE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

/**
 * Applique les règles 1, 2, 4, 5 sur les scores d'un joueur.
 * La règle 3 est gérée directement dans calculateScoreB (estimation style).
 * La règle 6 est appliquée séparément via applyRule6 (nécessite les deux joueurs).
 *
 * @param {Object} scores       - { A, B, C, … O, notes: [] }
 * @param {Object} playerData   - { ptsToDefend, ranking }
 * @param {Object} opponentData - { ranking }
 * @returns {Object} scores muté + TOTAL calculé
 */
function applyAllRules(scores, playerData, opponentData) {
  // ── RÈGLE 1 — Outsider libéré ─────────────────────────────────────────────
  // Complément à calculateScoreD : si le joueur n'a aucun point à défendre
  // et que l'adversaire est classé 50+ places derrière lui, Score D → 5 minimum.
  if (
    playerData.ptsToDefend === 0 &&
    opponentData.ranking - playerData.ranking >= 50
  ) {
    scores.D = Math.max(scores.D, 5);
    scores.notes.push('RÈGLE 1 activée : outsider libéré → D = max(D, 5)');
  }

  // ── RÈGLE 2 — Mauvaise forme ──────────────────────────────────────────────
  // Score A négatif → signal de méforme confirmé.
  // Protection : Score J forcé à 0, Score M forcé à -2.
  if (scores.A !== null && scores.A < 0) {
    scores.J = 0;
    scores.M = -2;
    scores.notes.push('RÈGLE 2 activée : Score A négatif → J=0, M=-2');
  }

  // ── RÈGLE 3 — Winners manquants ───────────────────────────────────────────
  // Gérée directement dans calculateScoreB via l'estimation par style de jeu.
  // Rien à faire ici.

  // ── RÈGLE 4 — Outsider cumulé plafonné ────────────────────────────────────
  // Score N plafonné à 5 quelles que soient les victoires consécutives.
  scores.N = Math.min(scores.N ?? 0, 5);

  // ── RÈGLE 5 — Score A absolu ──────────────────────────────────────────────
  // Si Score A non calculable (données insuffisantes), l'analyse s'arrête.
  if (scores.A === null) {
    scores.TOTAL = null;
    scores.error = 'RÈGLE 5 : Score A manquant — analyse impossible';
    scores.notes.push('RÈGLE 5 activée : données insuffisantes pour Score A');
    return scores;
  }

  // ── RÈGLE 6 — Priorité surface ────────────────────────────────────────────
  // Appliquée en dehors de cette fonction via applyRule6(player1Scores, player2Scores)
  // car elle nécessite les scores des deux joueurs simultanément.

  // ── CALCUL DU TOTAL ───────────────────────────────────────────────────────
  scores.TOTAL = SCORE_KEYS.reduce((sum, key) => {
    const val = scores[key];
    return sum + (typeof val === 'number' && val !== null ? val : 0);
  }, 0);

  return scores;
}

/**
 * RÈGLE 6 — Priorité surface.
 * Si un joueur domine clairement la surface (Score O ≥ 6) face à un joueur
 * qui ne la maîtrise pas (Score O ≤ 0), le Score B de ce dernier est plafonné à 2.
 * Appliquée après que les deux joueurs ont été calculés séparément.
 *
 * @param {Object} player1Scores - Scores complets du joueur 1
 * @param {Object} player2Scores - Scores complets du joueur 2
 * @returns {{ player1Scores: Object, player2Scores: Object }}
 */
function applyRule6(player1Scores, player2Scores) {
  if (player1Scores.O >= 6 && player2Scores.O <= 0) {
    player2Scores.B = Math.min(player2Scores.B ?? 0, 2);
    player2Scores.notes.push('RÈGLE 6 activée : maîtrise surface J1 → Score B J2 plafonné à 2');
  }
  if (player2Scores.O >= 6 && player1Scores.O <= 0) {
    player1Scores.B = Math.min(player1Scores.B ?? 0, 2);
    player1Scores.notes.push('RÈGLE 6 activée : maîtrise surface J2 → Score B J1 plafonné à 2');
  }
  return { player1Scores, player2Scores };
}

/**
 * Détermine le niveau de confiance à partir de l'écart de score entre deux joueurs.
 *
 * @param {number} gap - Différence absolue de TOTAL (joueur favori − outsider)
 * @returns {{ level: number, label: string }}
 */
function getConfidenceLevel(gap) {
  if (gap > 25) return { level: 3, label: 'Très haute confiance' };
  if (gap > 15) return { level: 2, label: 'Haute confiance' };
  if (gap > 5)  return { level: 1, label: 'Confiance modérée' };
  return { level: 0, label: 'Match imprévisible' };
}

module.exports = { applyAllRules, applyRule6, getConfidenceLevel };

require('dotenv').config();

const { analyzeMatch } = require('./analysis/matchAnalysis');

// ─── Match à analyser ─────────────────────────────────────────────────────────
// Modifier ces 4 valeurs pour chaque nouveau match

const MATCH = {
  player1:    'j.Lehecka',
  player2:    'A.Tabilo',
  surface:    'clay',
  tournament: 'MONTE CARLO ATP1000',
};

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await analyzeMatch(
    MATCH.player1,
    MATCH.player2,
    MATCH.surface,
    MATCH.tournament,
  );
}

main().catch(console.error);

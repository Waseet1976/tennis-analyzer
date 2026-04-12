module.exports = function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    const joueur1 = body.joueur1;
    const joueur2 = body.joueur2;
    const surface = body.surface || '';
    const tournoi = body.tournoi || '';

    if (!joueur1 || !joueur2) {
      return res.status(400).json({ error: 'Joueurs manquants' });
    }

    const score1 = Math.round(Math.random() * 100) / 10;
    const score2 = Math.round(Math.random() * 100) / 10;
    const favori = score1 >= score2 ? joueur1 : joueur2;

    return res.status(200).json({
      match: {
        joueur1,
        joueur2,
        surface,
        tournoi
      },
      verdict: {
        favori,
        ecart: Math.abs(score1 - score2),
        confiance: 'Simulation temporaire',
        niveauConfiance: 1
      },
      scoreA: {
        joueur1: { total: score1, details: [] },
        joueur2: { total: score2, details: [] }
      },
      scores: {
        joueur1: {
          A: score1,
          TOTAL: score1
        },
        joueur2: {
          A: score2,
          TOTAL: score2
        }
      },
      reglesActivees: {
        joueur1: [],
        joueur2: []
      },
      playerStats: null,
      aiAnalysis: 'Analyse temporaire, endpoint Vercel en cours de branchement.'
    });
  } catch (e) {
    return res.status(500).json({
      error: 'Analyze crash',
      message: e.message
    });
  }
};

const { analyzeMatch } = require('../src/analysis/matchAnalysis');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    const joueur1 = body.joueur1;
    const joueur2 = body.joueur2;
    const surface = body.surface || 'clay';
    const tournoi = body.tournoi || '';

    if (!joueur1 || !joueur2) {
      return res.status(400).json({ error: 'Joueurs manquants' });
    }

    const report = await analyzeMatch(joueur1, joueur2, surface, tournoi);

    if (!report) {
      return res.status(500).json({ error: 'Analyse vide' });
    }

    return res.status(200).json(report);
  } catch (e) {
    console.error('ANALYZE API CRASH:', e);
    return res.status(500).json({
      error: 'Analyze crash',
      message: e.message,
      stack: e.stack
    });
  }
};

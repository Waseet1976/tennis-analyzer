require('dotenv').config();
const fs         = require('fs');
const path       = require('path');
const express    = require('express');
const { google } = require('googleapis');
const Anthropic  = require('@anthropic-ai/sdk');
const { googleSheets: cfg }  = require('../config/config');
const { analyzeMatch }       = require('./analysis/matchAnalysis');
console.log('📌 API requires analyzeMatch from ./analysis/matchAnalysis');
console.log('[DEBUG API] cfg =', cfg);
console.log('[DEBUG API] cfg.sheetId =', cfg?.sheetId);
console.log('[DEBUG API] cfg.apiKey exists =', !!cfg?.apiKey);
console.log('[DEBUG API] cfg.sheets =', cfg?.sheets);
console.log('[DEBUG API] cfg.sheets.matches =', cfg?.sheets?.matches);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router = express.Router();
console.log('✅ API ROUTES LOADED');

// ─── Route de test ────────────────────────────────────────────────────────────
router.get('/test', (_req, res) => {
  res.json({ ok: true, source: 'api.js' });
});

// ─── Cache (5 min) ────────────────────────────────────────────────────────────
let _playerCache     = null;
let _tournamentCache = null;
let _cacheTs         = 0;
const CACHE_TTL      = 5 * 60 * 1000;

async function getAllPlayerNames() {console.log('[DEBUG] getAllPlayerNames start');
console.log('[DEBUG] using sheetId:', cfg?.sheetId);
console.log('[DEBUG] using matches sheet:', cfg?.sheets?.matches);
  if (_playerCache && Date.now() - _cacheTs < CACHE_TTL) return _playerCache;

  const sheets = google.sheets({ version: 'v4' });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.sheetId,
    range:         `${cfg.sheets.matches}!E:F`,
    key:           cfg.apiKey,
  });

  const rows  = res.data.values ?? [];
  console.log('[DEBUG] rows length:', rows.length);
console.log('[DEBUG] first rows:', rows.slice(0, 3));
  const names = new Set();
  rows.slice(1).forEach((row) => {
    if (row[0]?.trim()) names.add(row[0].trim());
    if (row[1]?.trim()) names.add(row[1].trim());
  });

  _playerCache = [...names].sort((a, b) => a.localeCompare(b));
  _cacheTs     = Date.now();
  return _playerCache;
}

async function getAllTournamentNames() {
  if (_tournamentCache && Date.now() - _cacheTs < CACHE_TTL) return _tournamentCache;

  const sheets = google.sheets({ version: 'v4' });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.sheetId,
    range:         `${cfg.sheets.matches}!B:B`,
    key:           cfg.apiKey,
  });
  const rows  = res.data.values ?? [];
  console.log('[DEBUG] rows length:', rows.length);
console.log('[DEBUG] first rows:', rows.slice(0, 3));
  const names = new Set();
  rows.slice(1).forEach((row) => {
    if (row[0]?.trim()) names.add(row[0].trim());
  });

  _tournamentCache = [...names].sort((a, b) => a.localeCompare(b));
  _cacheTs = Date.now();
return _tournamentCache;
}

// ─── Analyse IA ──────────────────────────────────────────────────────────────

async function generateAIAnalysis(result) {
  const prompt = `Tu es un analyste expert en tennis spécialisé dans l'analyse statistique des matchs.

Voici les données du match :
- Joueur 1 : ${result.match.joueur1}
- Joueur 2 : ${result.match.joueur2}
- Surface : ${result.match.surface}
- Tournoi : ${result.match.tournoi}

SCORES DÉTAILLÉS :
- Score A (forme récente) : J1=${result.scores.joueur1.A} / J2=${result.scores.joueur2.A}
- Score B (winners) : J1=${result.scores.joueur1.B} / J2=${result.scores.joueur2.B}
- Score C (1re balle) : J1=${result.scores.joueur1.C} / J2=${result.scores.joueur2.C}
- Score D (pts à défendre) : J1=${result.scores.joueur1.D} / J2=${result.scores.joueur2.D}
- Score G (tendance) : J1=${result.scores.joueur1.G} / J2=${result.scores.joueur2.G}
- Score H (fatigue) : J1=${result.scores.joueur1.H} / J2=${result.scores.joueur2.H}
- Score I (H2H) : J1=${result.scores.joueur1.I} / J2=${result.scores.joueur2.I}
- Score M (régularité) : J1=${result.scores.joueur1.M} / J2=${result.scores.joueur2.M}
- Score N (outsider) : J1=${result.scores.joueur1.N} / J2=${result.scores.joueur2.N}
- Score O (surface) : J1=${result.scores.joueur1.O} / J2=${result.scores.joueur2.O}
- TOTAL : J1=${result.scores.joueur1.TOTAL} / J2=${result.scores.joueur2.TOTAL}

VERDICT : ${result.verdict.favori} favori — Écart ${result.verdict.ecart} pts — ${result.verdict.confiance}

RÈGLES ACTIVÉES :
${[...result.reglesActivees.joueur1, ...result.reglesActivees.joueur2].join('\n') || 'Aucune'}

Ta mission est de produire une conclusion claire, professionnelle et argumentée.

STRUCTURE OBLIGATOIRE :

1. VERDICT FINAL
Indique clairement quel joueur est favori avec une phrase directe.

2. NIVEAU DE CONFIANCE
Faible / Moyen / Élevé — justifie rapidement.

3. ANALYSE DÉTAILLÉE BASÉE SUR LES STATS
Compare les joueurs critère par critère.
Appuie TOUJOURS tes arguments sur les statistiques fournies.
Ne fais aucune supposition non présente dans les données.

4. POINTS CLÉS DÉCISIFS
Liste les 2 à 4 facteurs principaux qui expliquent le favori.

5. SCÉNARIO POSSIBLE DU MATCH
Décris brièvement comment le match pourrait se dérouler.

RÈGLES :
- Sois précis, pas vague
- Base-toi UNIQUEMENT sur les données fournies
- Évite les phrases génériques
- Style clair, professionnel, analytique, comme un pronostic d'expert`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    messages:   [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}

// ─── GET /api/daily-summary ──────────────────────────────────────────────────
router.get('/daily-summary', (req, res) => {
  console.log('📊 /api/daily-summary appelée');
  const filePath = path.join(__dirname, '..', 'data', 'matches-today-summary.json');
  console.log('[daily-summary] chemin fichier :', filePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Aucune analyse du jour disponible. Lancez analyze-daily.js.' });
  }
  try {
    const raw  = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Lecture impossible : ${err.message}` });
  }
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4' });
    await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.sheetId,
      range:         `${cfg.sheets.matches}!A1`,
      key:           cfg.apiKey,
    });
    res.json({ status: 'ok', sheet: 'connecté' });
  } catch (err) {
    res.status(500).json({ status: 'error', sheet: 'inaccessible', message: err.message });
  }
});

// ─── GET /api/players?q=texte ─────────────────────────────────────────────────
router.get('/players', async (req, res) => {
  const q = (req.query.q ?? '').toLowerCase().trim();
  if (q.length < 3) return res.json([]);

  try {
    const names    = await getAllPlayerNames();
    const filtered = names.filter((n) => n.toLowerCase().includes(q));
    res.json(filtered.slice(0, 25));
  } catch (err) {
    console.error('[API] /players error full:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tournaments?q=texte ────────────────────────────────────────────
router.get('/tournaments', async (req, res) => {
  const q = (req.query.q ?? '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  try {
    const names    = await getAllTournamentNames();
    const filtered = names.filter((n) => n.toLowerCase().includes(q));
    res.json(filtered.slice(0, 20));
  } catch (err) {
    console.error('[API] /tournaments error full:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/surface?joueur1=X&joueur2=Y ────────────────────────────────────
router.get('/surface', (_req, res) => {
  res.json({ surface: null });
});

// ─── POST /api/analyze ────────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  console.log('[DEBUG] req.body complet :', req.body);
  console.log('[DEBUG] typeof req.body :', typeof req.body);
  console.log('[DEBUG] joueur1 :', req.body?.joueur1);
  const body    = req.body ?? {};
  const joueur1 = body.joueur1  || body.player1;
  const joueur2 = body.joueur2  || body.player2;
  const surface = body.surface;
  const tournoi = body.tournoi  || body.tournament || '';

  if (!joueur1 || !joueur2 || !surface) {
    return res.status(400).json({
      erreur: 'Paramètres manquants',
      requis: ['joueur1', 'joueur2', 'surface'],
      recu:   body,
    });
  }

  try {
    const result = await analyzeMatch(joueur1, joueur2, surface, tournoi);

    if (!result) {
      return res.status(422).json({
        error: 'Données insuffisantes pour analyser ce match.'
      });
    }

    // Vérification que result est bien un objet
    if (typeof result === 'string') {
      console.error('[API] ERREUR : analyzeMatch a retourné une string au lieu d un objet');
      return res.status(500).json({ error: 'Erreur interne : format de réponse incorrect' });
    }

    console.log('[API] typeof result avant res.json:', typeof result);
    console.log('[API] clés result:', Object.keys(result));

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        result.aiAnalysis = await generateAIAnalysis(result);
      } catch (aiErr) {
        console.error('[API] Analyse IA échouée:', aiErr.message);
        result.aiAnalysis = null;
      }
    }

    return res.json(result);
  } catch (err) {
    console.error('[API] /analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

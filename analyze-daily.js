'use strict';

const fs           = require('fs');
const path         = require('path');
const { analyzeMatch } = require('./src/analysis/matchAnalysis');

const INPUT_FILE          = path.join(__dirname, 'data',        'matches-today.json');
const OUTPUT_FILE         = path.join(__dirname, 'data',        'matches-today-results.json');
const SUMMARY_FILE        = path.join(__dirname, 'data',        'matches-today-summary.json');
const PUBLIC_SUMMARY_FILE = path.join(__dirname, 'public', 'data', 'matches-today-summary.json');

// ─── Lecture du fichier d'entrée ─────────────────────────────────────────────

function readMatches() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Fichier introuvable : ${INPUT_FILE}`);
  }

  const raw     = fs.readFileSync(INPUT_FILE, 'utf-8');
  const matches = JSON.parse(raw);

  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error('Le fichier JSON doit contenir un tableau non vide de matchs.');
  }

  return matches;
}

// ─── Analyse de chaque match ──────────────────────────────────────────────────

async function analyzeAll(matches) {
  const results = [];

  for (let i = 0; i < matches.length; i++) {
    const { joueur1, joueur2, surface, tournoi = '' } = matches[i];

    console.log(`\n[${i + 1}/${matches.length}] ${joueur1} vs ${joueur2} — ${surface}${tournoi ? ` (${tournoi})` : ''}`);

    if (!joueur1 || !joueur2 || !surface) {
      console.error('  ✗ Champs manquants (joueur1, joueur2, surface requis) — match ignoré.');
      results.push({ joueur1, joueur2, surface, tournoi, error: 'Champs manquants' });
      continue;
    }

    try {
      const result = await analyzeMatch(joueur1, joueur2, surface, tournoi);

      const favori         = result?.verdict?.favori        ?? '?';
      const confiance      = result?.verdict?.confiance     ?? '?';
      const niveauConfiance = result?.verdict?.niveauConfiance ?? 0;
      const hybridScore1   = result?.hybrid?.merged?.score1 ?? null;
      const hybridScore2   = result?.hybrid?.merged?.score2 ?? null;
      const gap            = result?.hybrid?.merged?.gap    ?? null;

      console.log(`  ✓ Favori : ${favori} — Confiance : ${confiance}`);

      const summary = { favori, confiance, niveauConfiance, hybridScore1, hybridScore2, gap };
      results.push({ joueur1, joueur2, surface, tournoi, summary, result });
    } catch (err) {
      console.error(`  ✗ Erreur : ${err.message}`);
      results.push({ joueur1, joueur2, surface, tournoi, error: err.message });
    }
  }

  return results;
}

// ─── Sauvegarde des fichiers de sortie ───────────────────────────────────────

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveResults(results) {
  ensureDir(OUTPUT_FILE);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nRésultats complets sauvegardés dans : ${OUTPUT_FILE}`);
}

function saveSummary(results) {
  const summary = results
    .filter(r => !r.error)
    .map(r => ({
      joueur1:         r.joueur1,
      joueur2:         r.joueur2,
      surface:         r.surface,
      tournoi:         r.tournoi,
      favori:          r.summary.favori,
      confiance:       r.summary.confiance,
      niveauConfiance: r.summary.niveauConfiance,
      score1:          r.summary.hybridScore1,
      score2:          r.summary.hybridScore2,
      gap:             r.summary.gap,
    }))
    .sort((a, b) =>
      b.niveauConfiance - a.niveauConfiance || b.gap - a.gap
    );

  const json = JSON.stringify(summary, null, 2);

  // 1. data/matches-today-summary.json
  ensureDir(SUMMARY_FILE);
  fs.writeFileSync(SUMMARY_FILE, json, 'utf-8');
  console.log(`Summary sauvegardé dans        : ${SUMMARY_FILE}`);

  // 2. public/data/matches-today-summary.json (lu par le site statique)
  ensureDir(PUBLIC_SUMMARY_FILE);
  fs.writeFileSync(PUBLIC_SUMMARY_FILE, json, 'utf-8');
  console.log(`Summary copié dans             : ${PUBLIC_SUMMARY_FILE}`);

  return summary;
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

(async () => {
  console.log('=== Analyse quotidienne des matchs ===\n');

  let matches;
  try {
    matches = readMatches();
    console.log(`${matches.length} match(s) à analyser — lecture de ${INPUT_FILE}`);
  } catch (err) {
    console.error(`Erreur de lecture : ${err.message}`);
    process.exit(1);
  }

  const results = await analyzeAll(matches);

  saveResults(results);
  saveSummary(results);

  const ok  = results.filter(r => !r.error).length;
  const ko  = results.filter(r =>  r.error).length;
  console.log(`\n=== Terminé : ${ok} analyse(s) réussie(s), ${ko} erreur(s) ===`);
})();

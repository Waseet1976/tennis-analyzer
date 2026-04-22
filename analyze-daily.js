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

const cleanName = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function analyzeAll(matches) {
  const results = [];

  for (let i = 0; i < matches.length; i++) {
    const { joueur1: raw1, joueur2: raw2, surface, tournoi = '' } = matches[i];

    const joueur1 = cleanName(raw1);
    const joueur2 = cleanName(raw2);

    console.log(`\n[${i + 1}/${matches.length}] ${joueur1} vs ${joueur2} — ${surface}${tournoi ? ` (${tournoi})` : ''}`);

    console.log('[BATCH INPUT]', {
      joueur1_raw:    raw1,
      joueur2_raw:    raw2,
      joueur1_json:   JSON.stringify(raw1),
      joueur2_json:   JSON.stringify(raw2),
      joueur1_length: raw1?.length,
      joueur2_length: raw2?.length,
    });

    if (!joueur1 || !joueur2 || !surface) {
      console.error('  ✗ Champs manquants (joueur1, joueur2, surface requis) — match ignoré.');
      results.push({ joueur1, joueur2, surface, tournoi, error: 'Champs manquants' });
      continue;
    }

    try {
      const result = await analyzeMatch(joueur1, joueur2, surface, tournoi);

      // Verdict et probabilités : uniquement depuis comparison (modèle décisionnel unique)
      const cmp             = result?.comparison;
      const favori          = cmp?.winner                 ?? result?.verdict?.favori    ?? '?';
      const confiance       = cmp?.confidence?.label      ?? result?.verdict?.confiance ?? '?';
      const niveauConfiance = cmp?.confidence?.level      ?? result?.verdict?.niveauConfiance ?? 0;

      // Scores bruts de comparaison (la transformation logistique est appliquée côté front)
      // score1 = cmp.scoreA, score2 = cmp.scoreB — ne somment PAS forcément à 1
      const score1 = cmp?.scoreA != null ? parseFloat(cmp.scoreA.toFixed(4)) : null;
      const score2 = cmp?.scoreB != null ? parseFloat(cmp.scoreB.toFixed(4)) : null;

      // gap calculé en espace probabiliste pour le tri (niveauConfiance prime, gap sert de tie-break)
      let gap = null;
      if (score1 != null && score2 != null) {
        const k    = 3;
        const prob = 1 / (1 + Math.exp(-k * (score1 - score2)));
        gap = parseFloat(Math.abs(prob - (1 - prob)).toFixed(4));
      }

      console.log('[SUMMARY DEBUG]', {
        joueur1_input:  joueur1,
        joueur2_input:  joueur2,
        match_joueur1:  result?.match?.joueur1,
        match_joueur2:  result?.match?.joueur2,
        comparison_winner:  cmp?.winner,
        comparison_scoreA:  cmp?.scoreA,
        comparison_scoreB:  cmp?.scoreB,
        stored_score1: score1,   // brut — logistique appliqué côté front
        stored_score2: score2,   // brut — logistique appliqué côté front
        summary_gap:    gap,     // gap en espace probabiliste (pour tri)
      });

      console.log(`  ✓ Favori : ${favori} — Confiance : ${confiance}`);

      const summary = { favori, confiance, niveauConfiance, hybridScore1: score1, hybridScore2: score2, gap };
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

// ─── Extraction des stats visuelles par joueur ────────────────────────────────

/** Convertit une valeur formatée fr (ex: "88,81%" ou "68,07") en nombre ou null. */
function parseFr(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace('%', '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

/**
 * Extrait les 6 stats visuelles depuis les sous-objets du résultat d'analyse.
 * @param {Object} compDetails  result.comparison.details.joueur1 ou joueur2
 * @param {Object} playerStats  result.playerStats.joueur1 ou joueur2
 */
function extractVisualStats(compDetails, playerStats) {
  const d   = compDetails  ?? {};
  const s   = playerStats?.stats    ?? {};
  const s1y = playerStats?.stats1y  ?? {};
  const st  = playerStats?.statsTop50 ?? {};

  // 1. Top 50 clay (1 an) — taux de victoire surface contre Top50 (allMatches 12 mois)
  const top50_1y = d.raw?.top50?.surfaceRate != null
    ? parseFloat((d.raw.top50.surfaceRate * 100).toFixed(1)) : null;

  // 2. Win rate global 1 an
  const win_rate_1y = parseFr(s1y.win_rate_total_1y);

  // 3. Win rate clay long terme
  const win_rate_clay = parseFr(s.win_rate_clay);

  // 4. Win rate clay 1 an
  const win_rate_clay_1y = parseFr(s1y.win_rate_clay_1y);

  // 5. % points service gagnés (1 an)
  const raw_srv = parseFr(s1y.service_points_won_avg_1y);
  const service_1y = raw_srv != null ? parseFloat(raw_srv.toFixed(1)) : null;

  // 6. % points retour gagnés (1 an)
  const raw_ret = parseFr(s1y.return_points_won_avg_1y);
  const return_1y = raw_ret != null ? parseFloat(raw_ret.toFixed(1)) : null;

  // 7. Win rate clay vs Top50 — calculé depuis les compteurs bruts (colonne win_rate corrompue)
  const wT50 = parseInt(st.wins_clay_vs_top50,    10) || 0;
  const mT50 = parseInt(st.matches_clay_vs_top50, 10) || 0;
  const wr_clay_top50 = mT50 > 0 ? parseFloat(((wT50 / mT50) * 100).toFixed(1)) : null;

  return { top50_1y, win_rate_1y, win_rate_clay, win_rate_clay_1y, service_1y, return_1y, wr_clay_top50 };
}

// ─── Recalibration de la confiance ───────────────────────────────────────────

/**
 * Compte combien de stats (sur 6) le favori gagne face à l'adversaire,
 * et vérifie si le vainqueur modèle est cohérent avec le vainqueur stats.
 */
function calcDominanceStats(s1, s2, favori, joueur1) {
  const keys = ['win_rate_1y', 'win_rate_clay_1y', 'win_rate_clay', 'top50_1y', 'service_1y', 'return_1y'];
  const isJ1Favori = favori === joueur1;
  let favoriWins   = 0;
  let opponentWins = 0;

  for (const k of keys) {
    const v1 = s1[k];
    const v2 = s2[k];
    if (v1 == null || v2 == null) continue;
    if (v1 > v2) { isJ1Favori ? favoriWins++ : opponentWins++; }
    else if (v2 > v1) { isJ1Favori ? opponentWins++ : favoriWins++; }
  }

  return { dominanceStats: favoriWins, coherent: favoriWins >= opponentWins };
}

/**
 * Classifie la confiance depuis le gap probabiliste, la dominance stats et la cohérence.
 * "Élevée" exige gap >= 0.12 ET dominanceStats >= 4 ET cohérence modèle/stats.
 */
function classifyConfidence(gap, dominanceStats, coherent) {
  if (gap < 0.03) return { label: 'Très serré', level: 0 };
  if (gap < 0.07) return { label: 'Légère',     level: 1 };
  if (gap < 0.12) return { label: 'Modérée',    level: 2 };
  if (dominanceStats >= 4 && coherent) return { label: 'Élevée', level: 3 };
  return { label: 'Modérée', level: 2 };
}

function saveSummary(results) {
  const summary = results
    .filter(r => !r.error)
    .map(r => {
      const d1  = r.result?.comparison?.details?.joueur1;
      const d2  = r.result?.comparison?.details?.joueur2;
      const ps1 = r.result?.playerStats?.joueur1;
      const ps2 = r.result?.playerStats?.joueur2;

      const stats_j1 = extractVisualStats(d1, ps1);
      const stats_j2 = extractVisualStats(d2, ps2);

      const { dominanceStats, coherent } = calcDominanceStats(stats_j1, stats_j2, r.summary.favori, r.joueur1);
      const newConf = classifyConfidence(r.summary.gap ?? 0, dominanceStats, coherent);

      console.log(`[Confiance] gap=${(r.summary.gap ?? 0).toFixed(4)} dominance=${dominanceStats}/6 coherent=${coherent} → ${newConf.label}`);

      return {
        joueur1:         r.joueur1,
        joueur2:         r.joueur2,
        surface:         r.surface,
        tournoi:         r.tournoi,
        favori:          r.summary.favori,
        confiance:       newConf.label,
        niveauConfiance: newConf.level,
        score1:          r.summary.hybridScore1,
        score2:          r.summary.hybridScore2,
        gap:             r.summary.gap,
        stats_j1,
        stats_j2,
      };
    })
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

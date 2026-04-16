'use strict';

/**
 * merge-matches.js
 * Fusionne de nouveaux matchs dans data/matches-today.json sans écraser ni dupliquer.
 *
 * Usage :
 *   node merge-matches.js nouveau-fichier.json
 *   node merge-matches.js '[{"joueur1":"X","joueur2":"Y","surface":"clay","tournoi":"ATP X"}]'
 *
 * Clé de déduplication : joueur1 + joueur2 + tournoi + date (insensible à la casse, sans espaces superflus)
 */

const fs   = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'data', 'matches-today.json');

// ─── Lecture des nouveaux matchs (argument CLI) ────────────────────────────────

function readNewMatches(arg) {
  if (!arg) {
    console.error('Usage : node merge-matches.js <fichier.json|tableau JSON inline>');
    process.exit(1);
  }

  // Argument = chemin de fichier ?
  if (fs.existsSync(arg)) {
    const raw = fs.readFileSync(arg, 'utf-8');
    return JSON.parse(raw);
  }

  // Argument = JSON inline ?
  try {
    return JSON.parse(arg);
  } catch {
    console.error(`Argument invalide : ni un fichier existant, ni du JSON valide.\n  Reçu : ${arg}`);
    process.exit(1);
  }
}

// ─── Clé de déduplication ─────────────────────────────────────────────────────

function dedupeKey(m) {
  const norm = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return [
    norm(m.joueur1),
    norm(m.joueur2),
    norm(m.tournoi),
    norm(m.date ?? ''),       // date optionnelle
  ].join('|');
}

// ─── Fusion ───────────────────────────────────────────────────────────────────

function merge(existing, incoming) {
  const existingKeys = new Set(existing.map(dedupeKey));
  let added    = 0;
  let skipped  = 0;

  for (const match of incoming) {
    const key = dedupeKey(match);
    if (existingKeys.has(key)) {
      console.log(`  ⟳ Doublon ignoré : ${match.joueur1} vs ${match.joueur2} (${match.tournoi})`);
      skipped++;
    } else {
      existing.push(match);
      existingKeys.add(key);
      console.log(`  ✓ Ajouté        : ${match.joueur1} vs ${match.joueur2} (${match.tournoi})`);
      added++;
    }
  }

  return { merged: existing, added, skipped };
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

const arg = process.argv[2];
const newMatches = readNewMatches(arg);

if (!Array.isArray(newMatches) || newMatches.length === 0) {
  console.error('Le fichier source doit être un tableau JSON non vide.');
  process.exit(1);
}

// Lecture du fichier existant (ou tableau vide si absent)
let existing = [];
if (fs.existsSync(TARGET)) {
  existing = JSON.parse(fs.readFileSync(TARGET, 'utf-8'));
} else {
  console.warn(`Fichier cible absent, il sera créé : ${TARGET}`);
}

console.log(`\nMatchs existants : ${existing.length}`);
console.log(`Matchs à intégrer : ${newMatches.length}\n`);

const { merged, added, skipped } = merge(existing, newMatches);

fs.writeFileSync(TARGET, JSON.stringify(merged, null, 2), 'utf-8');

console.log(`\n─────────────────────────────────────`);
console.log(`Total après fusion : ${merged.length} match(s)`);
console.log(`  Ajoutés  : ${added}`);
console.log(`  Ignorés  : ${skipped} (doublons)`);
console.log(`Fichier mis à jour : ${TARGET}`);

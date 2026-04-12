require('dotenv').config();
const { getPlayerMatches } = require('./src/data/googleSheets');

async function testPlayer() {
  const playerName = process.argv[2];

  if (!playerName) {
    console.log('Usage : node test-player.js "Tirante T."');
    process.exit(1);
  }

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  10 DERNIERS MATCHS — ${playerName}`);
  console.log(`══════════════════════════════════════════════════════════════\n`);

  const matches = await getPlayerMatches(playerName);

  if (!matches) {
    console.log('❌ Erreur lors de la lecture du Google Sheets.');
    return;
  }

  if (matches.length === 0) {
    console.log(`⚠️  Aucun match trouvé pour "${playerName}".`);
    console.log('   → Vérifier l\'orthographe (ex: "Tirante T.", "Munar J.")');
    return;
  }

  const last10 = matches.slice(0, 10);

  console.log(
    'Date'.padEnd(12),
    'Tournoi'.padEnd(24),
    'Surf'.padEnd(12),
    'Adversaire'.padEnd(20),
    'Rang'.padEnd(6),
    'R'.padEnd(3),
    'Sets'.padEnd(5),
    'Aces'
  );
  console.log('─'.repeat(92));

  last10.forEach((m) => {
    const date    = (m.date    ?? '?').padEnd(12);
    const tournoi = (m.tournoi ?? '?').substring(0, 23).padEnd(24);
    const surface = (m.surface ?? '?').padEnd(12);
    const adv     = (m.adversaire ?? '?').substring(0, 19).padEnd(20);
    const rang    = m.rangAdversaire ? `#${m.rangAdversaire}`.padEnd(6) : '?     ';
    const res     = (m.resultat ?? '?').padEnd(3);
    const sets    = String(m.nbSets ?? '?').padEnd(5);
    const aces    = m.acesJoueur ?? '?';

    console.log(date, tournoi, surface, adv, rang, res, sets, aces);
  });

  console.log('─'.repeat(92));
  console.log(`\nTotal matchs dans le Sheet : ${matches.length}`);

  // Bilan rapide
  const avecResultat = matches.filter((m) => m.resultat !== null);
  const victoires    = avecResultat.filter((m) => m.resultat === 'V').length;
  const defaites     = avecResultat.filter((m) => m.resultat === 'D').length;
  const pct          = avecResultat.length > 0
    ? Math.round((victoires / avecResultat.length) * 100)
    : 0;

  console.log(`Bilan global    : ${victoires}V / ${defaites}D  (${pct}%)`);
  console.log();
}

testPlayer().catch(console.error);

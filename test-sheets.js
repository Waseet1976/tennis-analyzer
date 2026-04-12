require('dotenv').config();
const { google } = require('googleapis');

async function testGoogleSheets() {
  console.log('\n══════════════════════════════════════');
  console.log('   TEST CONNEXION GOOGLE SHEETS');
  console.log('══════════════════════════════════════\n');

  // Étape 1 — Vérifier les variables d'environnement
  console.log('📋 ÉTAPE 1 — Variables d\'environnement');
  console.log('─────────────────────────────────────');

  if (!process.env.SHEET_ID) {
    console.log('❌ SHEET_ID manquant dans .env');
    return;
  }
  if (!process.env.GOOGLE_API_KEY) {
    console.log('❌ GOOGLE_API_KEY manquant dans .env');
    return;
  }

  console.log('✅ SHEET_ID trouvé :', process.env.SHEET_ID.substring(0, 10) + '...');
  console.log('✅ GOOGLE_API_KEY trouvé :', process.env.GOOGLE_API_KEY.substring(0, 8) + '...');

  // Étape 2 — Tenter la connexion
  console.log('\n📡 ÉTAPE 2 — Connexion à Google Sheets');
  console.log('─────────────────────────────────────');

  try {
    const sheets = google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: '2025-atp-season!A1:Z5',
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log('⚠️  Connexion OK mais feuille "2025-atp-season" vide ou inexistante');
      console.log('    → Vérifier que la feuille s\'appelle bien "2025-atp-season"');
      return;
    }

    console.log('✅ Connexion réussie !');
    console.log(`✅ ${rows.length} ligne(s) trouvée(s)\n`);

    // Étape 3 — Afficher les premières lignes
    console.log('📊 ÉTAPE 3 — Premières lignes du Sheet');
    console.log('─────────────────────────────────────');
    rows.forEach((row, index) => {
      console.log(`Ligne ${index + 1} :`, row);
    });

    // Étape 4 — Vérifier les colonnes
    console.log('\n🔍 ÉTAPE 4 — Vérification des colonnes');
    console.log('─────────────────────────────────────');
    const header = rows[0];
    const colonnesAttendues = [
      'season', 'type de tournoi', 'date', 'tournois', 'tour', 'surface',
      'joueur 1', 'joueur 2', 'classement joueur 1', 'classement joueur 2',
      'point joueur 1', 'point joueur 2', 'nombre de set gagnés joueur 1',
      'nombre de set gagnés joueur 2', 'jeu gagné joueur 1 set 1', 'jeu gagné joueur 2 set 1',
      'jeu gagné joueur 1 set 2', 'jeu gagné joueur 2 set 2', 'jeu gagné joueur 1 set 3',
      'jeu gagné joueur 2 set 3', 'jeu gagné joueur 1 set 4', 'jeu gagné joueur 2 set 4',
      'jeu gagné joueur 1 set 5', 'jeu gagné joueur 2 set 5', 'aces joueur 1', 'aces joueur 2',
    ];

    colonnesAttendues.forEach((col, i) => {
      if (header[i]) {
        console.log(`✅ Colonne ${String.fromCharCode(65 + i)} : "${header[i]}"`);
      } else {
        console.log(`❌ Colonne ${String.fromCharCode(65 + i)} : MANQUANTE (attendu: "${col}")`);
      }
    });

    console.log('\n══════════════════════════════════════');
    console.log('   ✅ GOOGLE SHEETS FONCTIONNE');
    console.log('══════════════════════════════════════\n');

  } catch (error) {
    console.log('❌ ERREUR DE CONNEXION :');
    console.log('   ', error.message);
    console.log('\n🔧 SOLUTIONS POSSIBLES :');

    if (error.message.includes('API key')) {
      console.log('   → Clé API invalide ou Google Sheets API non activée');
      console.log('   → Aller sur console.cloud.google.com');
      console.log('   → Activer Google Sheets API');
      console.log('   → Vérifier la clé dans .env');
    }

    if (error.message.includes('not found') || error.message.includes('404')) {
      console.log('   → SHEET_ID incorrect');
      console.log('   → Vérifier l\'URL du Google Sheets');
    }

    if (error.message.includes('permission') || error.message.includes('403')) {
      console.log('   → Sheet non accessible publiquement');
      console.log('   → Cliquer Partager → Toute personne avec le lien → Lecteur');
    }
  }
}

testGoogleSheets();

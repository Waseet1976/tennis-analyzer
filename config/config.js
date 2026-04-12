require('dotenv').config();

// ─── Google Sheets ─────────────────────────────────────────────────────────────
const googleSheets = {
  sheetId: process.env.GOOGLE_SHEET_ID,
  apiKey:   process.env.GOOGLE_API_KEY,

  // Noms des feuilles
  sheets: {
    matches:      '2025-atp-season',
    stats:        'STATS',        // stats long terme (base principale)
    stats1y:      'STATS_1Y',    // stats 12 derniers mois (base récente)
    statsTop50:   'STATS_TOP50', // stats vs top 50 (complément qualitatif)
  },

  // Structure colonnes — feuille "2025-atp-season" (colonnes A→AP, 42 colonnes)
  // Les deux joueurs sont sur la même ligne ; résultat disponible via win_player1/win_player2.
  matchsColumns: {
    A:  'date',
    B:  'tournament',
    C:  'round',
    D:  'surface',
    E:  'player1',
    F:  'player2',
    G:  'rank_player1',
    H:  'rank_player2',
    I:  'points_player1',
    J:  'points_player2',
    K:  'sets_won_player1',
    L:  'sets_won_player2',
    M:  'games_set1_player1',
    N:  'games_set1_player2',
    O:  'games_set2_player1',
    P:  'games_set2_player2',
    Q:  'games_set3_player1',
    R:  'games_set3_player2',
    S:  'games_set4_player1',
    T:  'games_set4_player2',
    U:  'games_set5_player1',
    V:  'games_set5_player2',
    W:  'aces_player1',
    X:  'aces_player2',
    Y:  'double_faults_player1',
    Z:  'double_faults_player2',
    AA: 'service_points_won_player1',
    AB: 'service_points_won_player2',
    AC: 'return_points_won_player1',
    AD: 'return_points_won_player2',
    AE: 'breaks_converted_player1',
    AF: 'breaks_converted_player2',
    AG: 'breaks_saved_player1',
    AH: 'breaks_saved_player2',
    AI: 'match_valid',
    AJ: 'surface_valid',
    AK: 'stats_complete',
    AL: 'win_player1',
    AM: 'win_player2',
    AN: 'total_games_player1',
    AO: 'total_games_player2',
    AP: 'last_12_months',
  },
};

// ─── Périodes de données ───────────────────────────────────────────────────────
const datePeriods = {
  sheets: {
    startDate: process.env.SHEETS_START_DATE || '2020-01-01',
    endDate:   () => new Date().toISOString().split('T')[0],  // dynamique = aujourd'hui
  },
  web: {
    startDate: process.env.WEB_START_DATE || '2020-01-01',    // fallback si donnée manquante Sheets
  },
};

// ─── Sources de scraping (ordre de priorité) ──────────────────────────────────
const scrapingSources = [
  {
    name:     'TennisAbstract',
    priority: 1,
    baseUrl:  'https://www.tennisabstract.com/cgi-bin/player.cgi?p=',
    // Usage : baseUrl + nomJoueurSansEspaces  (ex: RafaelNadal)
  },
  {
    name:     'TennisRatio',
    priority: 2,
    baseUrl:  'https://www.tennisratio.com/players/',
    // Usage : baseUrl + slug-joueur  (ex: rafael-nadal)
  },
  {
    name:     'ATPTour',
    priority: 3,
    baseUrl:  'https://www.atptour.com/en/players/',
    // Usage : baseUrl + prenom-nom/id-atp/overview  (ex: rafael-nadal/n409/overview)
  },
  {
    name:     'UltimateTennisStatistics',
    priority: 4,
    baseUrl:  'https://www.ultimatetennisstatistics.com/playerProfile?name=',
    // Usage : baseUrl + Prenom%20Nom  (ex: Rafael%20Nadal)
  },
];

// ─── Valeurs de référence ─────────────────────────────────────────────────────
const referenceValues = {
  niveaux:   ['GS', 'Masters', 'ATP500', 'ATP250', 'Challenger'],
  surfaces:  ['clay', 'hard', 'indoor_hard', 'grass'],
  tours:     ['R1', 'R2', 'R3', 'R4', 'QF', 'SF', 'F'],
  resultats: ['V', 'D'],
};

module.exports = { googleSheets, datePeriods, scrapingSources, referenceValues };

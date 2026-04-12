# Tennis Scoring

Système d'analyse et de scoring de matchs de tennis.

## Installation

```bash
cd tennis-scoring
npm install
```

## Configuration

Remplir le fichier `.env` :

```
GOOGLE_SHEETS_ID=<id de votre feuille>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<email du compte de service>
GOOGLE_PRIVATE_KEY=<clé privée>
RAPIDAPI_KEY=<clé RapidAPI>
```

## Lancement

```bash
npm start
```

## Structure

| Fichier | Rôle |
|---|---|
| `src/data/googleSheets.js` | Connexion et lecture Google Sheets |
| `src/data/webScraper.js` | Scraping de sources tennis |
| `src/scoring/scoreA.js` | Calcul Score A v3.0 |
| `src/scoring/scoreB_O.js` | Calculs Scores B à O |
| `src/scoring/rules.js` | 6 règles globales |
| `src/analysis/matchAnalysis.js` | Analyse complète d'un match |
| `src/output/report.js` | Formatage tableau + verdict |
| `config/config.js` | Configuration centralisée |

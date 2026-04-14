// Désactiver le cache des modules en développement
Object.keys(require.cache).forEach(key => {
  if (!key.includes('node_modules')) {
    delete require.cache[key];
  }
});

require('dotenv').config();
const express = require('express');
const path    = require('path');
const api     = require('./api');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', api);

// ─── Middleware de gestion d'erreurs ─────────────────────────────────────────
// DOIT être déclaré après toutes les routes.
// Sans ce middleware, Express envoie une page HTML en cas d'erreur → le client
// obtient "Unexpected token '<'… is not valid JSON".
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server] Erreur non gérée :', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erreur interne du serveur' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎾 Tennis Analyzer disponible sur http://localhost:${PORT}`);
  console.log('Serveur actif - en attente de connexions...');
});

process.on('uncaughtException', (err) => {
  console.error('Erreur:', err.message);
});

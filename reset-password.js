#!/usr/bin/env node
/**
 * MyFlix — Réinitialiser un mot de passe depuis le terminal (y compris celui de l'admin)
 * Usage : node reset-password.js "nom d'utilisateur"
 * Le serveur doit être arrêté : il garde les comptes en mémoire et écraserait le changement.
 */

const http = require('http');
const PORT = parseInt(process.env.PORT, 10) || 8989;
const name = process.argv.slice(2).join(' ').trim();
if (!name) { console.log('Usage : node reset-password.js "nom d\'utilisateur"'); process.exit(1); }

// Refuser si le serveur tourne
http.get({ host: '127.0.0.1', port: PORT, path: '/api/auth/state', timeout: 1500 }, () => {
  console.log(`Le serveur MyFlix tourne encore (port ${PORT}). Arrête-le d'abord, puis relance cette commande.`);
  process.exit(1);
}).on('error', run).on('timeout', function () { this.destroy(); });

function run() {
  const auth = require('./auth');
  const u = auth.findByName(name);
  if (!u) { console.log(`Aucun compte « ${name} ».`); process.exit(1); }
  const r = auth.resetPassword(u.id, { allowAdmin: true });
  console.log(`\nMot de passe temporaire de « ${r.username} » : ${r.password}`);
  console.log('Il faudra en choisir un nouveau à la prochaine connexion.\n');
}

#!/bin/bash
# ═══════════════════════════════════════════════════
#  MyFlix — Lanceur (double-clic pour démarrer)
# ═══════════════════════════════════════════════════

# Aller dans le dossier du script (important !)
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   🎬  MyFlix — Démarrage...          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Vérifier si Node.js est installé ───────────────
if ! command -v node &>/dev/null; then
  osascript -e 'display dialog "❌ Node.js nest pas installé.\n\nVa sur https://nodejs.org et installe la version LTS, puis relance MyFlix." with title "MyFlix — Erreur" buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js détecté : $NODE_VERSION"
echo "🚀 Démarrage du serveur..."
echo ""

# ─── Lancer le serveur ───────────────────────────────
node server.js

# Si le serveur se ferme avec une erreur
echo ""
echo "Le serveur s'est arrêté."
read -p "Appuie sur Entrée pour fermer..."

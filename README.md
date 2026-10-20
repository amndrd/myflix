# 🎬 MyFlix — Votre Médiathèque Personnelle

Netflix personnel avec streaming depuis votre disque dur externe.

---

## 📁 Structure des fichiers

```
myflix/
├── LANCER_MYFLIX.command   ← Double-clic pour démarrer (macOS)
├── server.js               ← Serveur (Node.js, aucune dépendance)
├── auth.js                 ← Comptes, sessions, demandes d'accès
├── requests.js             ← Demandes de films
├── index.html              ← L'interface MyFlix
├── login.html              ← Page de connexion / demande d'accès
├── css/style.css
├── js/app.js, js/series.js
└── images/                 ← Affiches, fonds et logos (noms de fichiers)
```

Créés au premier lancement, **non inclus dans le dépôt** (données personnelles) :
`myflix-config.json` (chemin du disque), `myflix-data.json` (catalogue), `myflix-users.json` (comptes), `myflix-requests.json` (demandes de films). Le dossier `images/` ne contient que le logo du site.

Pour les sous-titres, les pistes audio et les aperçus de la barre de lecture, installe FFmpeg (`brew install ffmpeg`).

---

## 🚀 Démarrage (une seule fois à faire)

### Étape 1 — Installer Node.js
Va sur https://nodejs.org et télécharge la version LTS.
Installe-le normalement (double-clic sur le .pkg).

### Étape 2 — Autoriser le script (une seule fois)
Fais un clic droit sur LANCER_MYFLIX.command → "Ouvrir"
macOS va demander une confirmation → clique "Ouvrir".
Les fois suivantes, le double-clic suffira.

### Étape 3 — Lancer MyFlix
Double-clic sur LANCER_MYFLIX.command

Une fenêtre Terminal s'ouvre et ton navigateur se lance automatiquement sur http://localhost:8989.

---

## 💾 Utilisation avec le disque dur externe

1. Branche ton disque dur avant de lancer MyFlix
2. Lance MyFlix (double-clic)
3. Si c'est la première fois, une bannière jaune apparaît → clique "Configurer le disque dur"
4. Ton disque apparaît dans la liste (Ex: /Volumes/MonDisque) → clique Choisir puis Confirmer
5. Clique sur "Scanner" dans la barre de navigation
6. La liste de tous tes fichiers vidéo s'affiche → clique "+ Ajouter" pour chaque film

Chaque fois que tu veux regarder un film :
1. Branche le disque dur
2. Double-clic sur LANCER_MYFLIX.command
3. Ouvre http://localhost:8989 dans ton navigateur
4. Profite !

---

## 🎬 Formats vidéo supportés

MP4 (H.264) : Parfait
WEBM : Parfait
MKV : Partiel (dépend du codec)
MOV : Partiel
AVI : Partiel

Astuce : Si un MKV ne se lit pas, convertis-le en MP4 avec HandBrake (gratuit).

---

## 🗂️ Organisation recommandée sur le disque dur

MonDisque/
  Films/
    Action/
      John Wick.mp4
    Comédie/
      Intouchables.mp4
    Science-Fiction/
      Interstellar.mp4

MyFlix scanne les dossiers jusqu'a 4 niveaux de profondeur.

---

## 👥 Comptes et accès

Le site est réservé aux comptes que tu as validés.

- **Premier lancement** : la page d'accueil propose de créer ton compte administrateur. Ça ne marche que depuis ce Mac (http://localhost:8989), et une seule fois.
- **Tes amis** ouvrent le lien du site et cliquent sur « Demander un accès ». Tu reçois une notification sur le Mac.
- **Valider une demande** : clique sur ton initiale en haut à droite → « Demandes d'accès » → Accepter / Refuser. Au même endroit, tu peux retirer l'accès d'un membre (la déconnexion est immédiate).
- **Notification sur téléphone (facultatif)** : installe l'appli ntfy, abonne-toi à un nom de sujet difficile à deviner, puis ajoute-le dans `myflix-config.json` : `"ntfyTopic": "ton-sujet-secret"`.
- Seul l'administrateur peut ajouter, modifier ou supprimer du contenu. Chaque membre a sa propre progression de lecture.

### Demandes de films

- **Les membres** cliquent sur leur initiale → « Demander un film » (ou sur « Demander … » en bas d'une recherche). Si le titre est déjà au catalogue, le site le signale. Si quelqu'un l'a déjà demandé, leur voix s'ajoute à la demande existante (« Moi aussi »).
- **Toi** : notification à chaque demande, puis initiale → « Demandes de films ». Les plus demandées passent en premier. « Ajouté » ou « Refuser », avec un petit mot facultatif.
- Le membre voit la réponse (pastille sur son initiale) et, si le film est au catalogue, un bouton « Voir ».

Fichiers sensibles (jamais envoyés au navigateur) :
- `myflix-users.json` — comptes, mots de passe chiffrés (scrypt), sessions
- `myflix-requests.json` — demandes de films
- `myflix-data.json` — le catalogue

---

## 🔒 Confidentialite

- Tout reste en local sur ton Mac, aucune donnée n'est envoyée sur internet (sauf la notification ntfy si tu l'actives)
- Le serveur écoute sur ton réseau local (port 8989) : sans compte validé, on ne voit que la page de connexion
- Un membre ne peut lire que les vidéos présentes au catalogue, jamais le reste du disque

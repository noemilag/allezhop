# Allez Hop

La fiche du jour d'un enfant : jour du cycle, cours spécialisés, quoi apporter, météo de 7 h 30 à 18 h et rappels partagés entre les parents.

**Aucune donnée personnelle dans ce dépôt.** Le prénom, la classe, l'école, la ville, le calendrier et l'horaire de l'enfant sont dans Firebase (collection `enfants`), lisibles seulement par les membres de la famille.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page et son style |
| `app.js` | Affichage, rappels, notifications |
| `school.js` | Mécanique du cycle, du calendrier et de la météo (partagée avec la notification) |
| `sw.js` | Reçoit les notifications push |
| `scripts/notifier.js`, `.github/workflows/` | Notification du matin |
| `config.js` | Configuration Firebase (projet allez-hop-6aecd) |
| `firestore.rules` | Règles de sécurité Firebase (à copier, étape 2) |
| `manifest.webmanifest`, `icons/` | Icône et installation sur l'écran d'accueil |

### Fiche de l'enfant (Firebase, collection `enfants`)

À la première connexion, l'app demande le fichier de données de l'enfant (`.json`, remis à part) et l'enregistre dans Firebase. Forme attendue (exemple fictif) :

```json
{
  "prenom": "Alex", "classe": "101", "ecole": "École Exemple", "ville": "Ville",
  "lat": 45.5, "lon": -73.6,
  "annee": { "debut": "2026-08-31", "fin": "2027-06-23", "finEte": "2027-06-30" },
  "joursCycle": 6,
  "periodes": { "1": "7 h 55", "2": "8 h 45" },
  "cycle": { "1": { "1": "educ" }, "2": { "2": "angl" } },
  "conges": [ { "du": "2026-09-07", "au": "2026-09-07", "type": "conge", "label": "Fête du Travail" } ],
  "evenements": [ { "date": "2026-09-10", "ic": "📸", "titre": "Photo scolaire" } ]
}
```

Matières possibles dans `cycle` : voir `SUBJ` dans `school.js`. Pour corriger la fiche plus tard : console Firebase → Firestore → `enfants`.

## 1. Mettre l'app en ligne (GitHub Pages)

Settings → Pages → *Deploy from a branch* → branche `main`, dossier `/ (root)`.
L'app est ensuite à l'adresse `https://noemilag.github.io/allezhop/`.

## 2. Partager les rappels (Firebase, gratuit)

> Configuré pour le projet `allez-hop-6aecd`. À la première connexion sur un téléphone, les rappels déjà gardés sur ce téléphone deviennent partagés.

1. Sur <https://console.firebase.google.com>, crée un projet (ex. `allezhop`). Google Analytics n'est pas nécessaire.
2. **Authentication** → Get started → **Email/Password** → Enable.
   Onglet **Users** → *Add user* : crée un compte pour chaque parent (courriel + mot de passe).
3. **Firestore Database** → Create database → région `northamerica-northeast1 (Montréal)` → mode production.
   Onglet **Rules** : colle le contenu de `firestore.rules`, remplace les deux adresses par celles des parents, puis *Publish*.
4. Roue dentée → **Project settings** → *Your apps* → icône Web `</>` → enregistre l'app (pas besoin de Hosting).
   Copie l'objet `firebaseConfig` et colle-le dans `config.js` à la place de `null` :

   ```js
   window.ALLEZHOP_FIREBASE = {
     apiKey: "…",
     authDomain: "….firebaseapp.com",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…"
   };
   ```

5. Ouvre l'app et connecte-toi. La première fois, ajoute le fichier de données de l'enfant.

## 3. Installer sur l'iPhone

Ouvre l'adresse dans Safari → bouton Partager → **Sur l'écran d'accueil**.

## Météo

Prévisions horaires d'[Open-Meteo](https://open-meteo.com/) à la position de l'école (`lat`, `lon` dans la fiche de l'enfant), chargées par le téléphone à l'ouverture de l'app (gardées 30 minutes). Aucune clé n'est nécessaire.

## Notification du matin (push)

Chaque jour d'école, vers 7 h, l'iPhone reçoit : le jour du cycle, les spécialistes, quoi apporter et la météo. Les jours de congé, une seule notification le premier jour. Rien la fin de semaine.

C'est une tâche GitHub Actions (`.github/workflows/notification-matin.yml`) qui lance `scripts/notifier.js`. Elle lit la fiche de l'enfant dans Firebase avec une clé de compte de service (secret GitHub `FIREBASE_SERVICE_ACCOUNT`).

**À faire une seule fois :**

1. Ouvre `https://noemilag.github.io/allezhop/outils/cles.html` sur un ordinateur et touche **Créer les clés** (tout se fait dans le navigateur).
   - Clé **privée** → **Settings → Secrets and variables → Actions → New repository secret**, nom `VAPID_PRIVATE_KEY`. Ne la mets jamais dans le code.
   - Clé **publique** → dans `app.js` (`VAPID_PUBLIC`) et dans la tâche (`VAPID_PUBLIC`).
2. Sur chaque iPhone (iOS 16.4 ou plus) : ajoute Allez Hop à l'écran d'accueil, ouvre-la par son icône, touche la cloche → **Activer les notifications** → **Copier le code**.
3. Crée le secret `PUSH_SUBSCRIPTIONS` et colles-y les codes, **un par ligne** (un par téléphone). Pour ajouter un téléphone plus tard, remplace le secret par la liste complète.
4. Test : onglet **Actions → Notification du matin → Run workflow**.

**Changer l'heure :** dans le fichier de la tâche, change `HEURE` et décale les deux lignes `cron` (elles démarrent 45 min avant, en UTC : 7 h à Montréal = 11 h UTC l'été, 12 h UTC l'hiver).

**À savoir :** GitHub met en pause les tâches planifiées d'un dépôt public après 60 jours sans aucun commit. Il envoie alors un courriel ; un clic sur *Enable workflow* les relance.

## Mises à jour

Les téléphones gardent l'app en mémoire. Avant chaque mise en ligne, lance `./bump.sh` : il change le numéro de version (`version.json`, `app.js`, `index.html`). À l'ouverture suivante (ou au retour dans l'app), une fenêtre « Nouvelle version disponible » propose de mettre à jour : l'app retélécharge ses fichiers et se recharge, sans réinstaller l'icône.

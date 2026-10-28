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

## Notifications (push)

Chaque parent choisit dans l'app (icône de cloche) l'heure de sa notification. Heure avant midi : la journée même. Heure à partir de midi : le lendemain. Contenu : jour du cycle, spécialistes, quoi apporter, rappels du jour et météo. Envoyée les jours d'école, le premier jour d'un congé et tout jour qui a un rappel.

Chaque téléphone abonné est enregistré dans Firebase (collection `abonnements`, avec l'heure choisie). Une tâche GitHub Actions (`.github/workflows/notification-matin.yml`) lance `scripts/notifier.js` aux 15 minutes ; chaque téléphone reçoit sa notification une seule fois par jour.

**À faire une seule fois :**

1. Ouvrir `https://noemilag.github.io/allezhop/outils/cles.html` sur un ordinateur → **Créer les clés**.
   - Clé **privée** → secret GitHub `VAPID_PRIVATE_KEY` (Settings → Secrets and variables → Actions).
   - Clé **publique** → `VAPID_PUBLIC` dans `app.js` et dans la tâche.
2. Firebase → ⚙ Paramètres du projet → **Comptes de service** → **Générer une nouvelle clé privée** → coller tout le contenu du fichier dans le secret GitHub `FIREBASE_SERVICE_ACCOUNT`.
3. Règles Firestore : ajouter la collection `abonnements` (voir `firestore.rules`).
4. Test : onglet **Actions → Notifications → Run workflow**.

Sur iPhone (iOS 16.4 ou plus), l'app doit être ouverte depuis l'icône de l'écran d'accueil. GitHub met en pause les tâches planifiées d'un dépôt public après 60 jours sans commit ; un clic sur *Enable workflow* les relance.

## Mises à jour

Les téléphones gardent l'app en mémoire. Avant chaque mise en ligne, lance `./bump.sh` : il change le numéro de version (`version.json`, `app.js`, `index.html`). À l'ouverture suivante (ou au retour dans l'app), une fenêtre « Nouvelle version disponible » propose de mettre à jour : l'app retélécharge ses fichiers et se recharge, sans réinstaller l'icône.

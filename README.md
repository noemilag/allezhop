# Allez Hop

La journée d'école de votre enfant en un coup d'œil : jour du cycle, cours spécialisés, quoi apporter, météo et rappels partagés entre parents. Application web installable sur l'écran d'accueil (PWA), en français.

Adresse : <https://noemilag.github.io/allezhop/>

> **Aucun renseignement personnel dans ce dépôt (il est public).** Pas de prénoms, de courriels, de classes, d'écoles ni de clés secrètes. Les données des familles sont dans Firebase ; les secrets sont dans les *Secrets* de GitHub.

## Comment ça marche

- Chaque **famille** a ses données : `familles/{id}` (parents, courriels), avec les sous-collections `enfants`, `rappels` et `abonnements`. Un parent invite l'autre par un lien personnel.
- Un **assistant** crée l'enfant : on photographie la grille de l'horaire et le calendrier scolaire, une IA (Gemini, par Firebase AI Logic) les lit, puis le parent vérifie chaque étape. Les photos ne sont pas conservées.
- Prise en charge des **cycles** de 5, 9 ou 10 jours, des semaines A et B, des journées pédagogiques (de l'école ou non), des congés et des **journées de reprise** (congés qui deviennent des jours de classe en cas de fermeture).
- La **météo** vient d'[Open-Meteo](https://open-meteo.com/) (sans clé), à la position de la ville de l'enfant.
- Le **calendrier** de l'année peut être exporté en `.ics`.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page et son style |
| `app.js` | Affichage, connexion, familles, rappels, notifications |
| `assistant.js` | Assistant de création d'un enfant (photos, vérifications) |
| `school.js` | Cycle, calendrier scolaire, météo (partagé avec les notifications) |
| `sw.js` | Reçoit les notifications push |
| `config.js` | Configuration Firebase (publique par nature) |
| `firestore.rules` | Règles de sécurité Firestore (modèle, voir plus bas) |
| `scripts/notifier.js`, `.github/workflows/notification-matin.yml` | Envoi des notifications |
| `confidentialite.html`, `conditions.html` | Politique de confidentialité et conditions (versions provisoires) |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `beta/`, `essai-b/` | Redirections vers l'adresse principale (anciennes adresses) |
| `outils/cles.html` | Création des clés des notifications |
| `bump.sh` | Change le numéro de version avant chaque mise en ligne |

## Mettre en place (une seule fois)

### 1. Hébergement

GitHub : Settings → Pages → *Deploy from a branch* → `main`, dossier `/ (root)`.

### 2. Firebase

1. Créer un projet sur <https://console.firebase.google.com>.
2. **Authentication** : activer *Adresse e-mail / Mot de passe* et *Google*.
3. **Firestore** : créer la base, puis publier les règles inspirées de `firestore.rules`. Le dépôt contient des valeurs d'exemple : le **code d'invitation** de la période d'essai et les adresses de l'ancienne version ne doivent figurer que dans la console.
4. **Application Web** : enregistrer l'app et coller l'objet de configuration dans `config.js`.
5. **App Check** (obligatoire pour l'IA) : clé reCAPTCHA Enterprise ; protection contre la répétition appliquée ; l'app demande des jetons à usage unique.
6. **AI Logic** : activer l'API Gemini. Au palier gratuit, les limites sont très serrées ; au palier payant, régler un plafond de dépenses (AI Studio → Dépenses) et une alerte de budget (Google Cloud).

### 3. Notifications

Une tâche GitHub Actions lance `scripts/notifier.js` aux 15 minutes. Chaque téléphone abonné reçoit sa notification une fois par jour, à l'heure choisie dans l'app.

Secrets GitHub (Settings → Secrets and variables → Actions) :

| Secret | Contenu |
| --- | --- |
| `VAPID_PRIVATE_KEY` | Clé privée créée avec `outils/cles.html` (la clé publique est dans `app.js` et dans la tâche) |
| `FIREBASE_SERVICE_ACCOUNT` | Fichier JSON complet d'un compte de service Firebase |
| `ADMIN_EMAIL` | (facultatif) courriel(s) du ou des comptes qui reçoivent les alertes de bugs, séparés par une virgule |

Test : onglet **Actions → Notifications → Run workflow**.

Les journaux de la tâche sont publics : le programme n'y écrit ni courriel, ni prénom, ni contenu de message. Sur iPhone (iOS 16.4 ou plus), l'app doit être ouverte depuis l'icône de l'écran d'accueil. GitHub met en pause les tâches planifiées après 60 jours sans commit.

### Quitter une famille, supprimer la famille ou le compte

Dans le menu : « Quitter la famille… » (quitter ; supprimer la famille seulement pour son dernier parent) et « Supprimer mon compte… ». Ces actions demandent des règles Firestore à jour : voir dans `firestore.rules` les blocs `invitations` (suppression d'un lien), `familles` (mise à jour limitée de la liste des parents, et suppression). Sans elles, l'app affiche « Firebase refuse cette action ». Supprimer le compte de connexion demande une connexion récente.

### 4. Signalement de bugs

Le bouton « Signaler un bug » (dans les erreurs de l'assistant) écrit un rapport dans la collection `signalements` (lisible seulement dans la console Firebase). Les règles doivent contenir le bloc `signalements` de `firestore.rules`. Une notification est envoyée aux téléphones de `ADMIN_EMAIL`.

## Mises à jour

Les téléphones gardent l'app en mémoire. Avant chaque mise en ligne, lancer `./bump.sh` : il change le numéro de version (`version.json`, `app.js`, `assistant.js`, `index.html`). À l'ouverture suivante, une fenêtre propose la mise à jour.

## Sauvegarde

La branche `avant-le-saut` contient l'ancienne application à un seul enfant, avant le passage au mode familles ; la branche `version-fiches` en est une version antérieure.

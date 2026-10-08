# AION 2 — Routine individuelle Discord

Application non officielle, dérivée de la fiche récapitulative fournie. Checklist quotidienne et hebdomadaire, planning, compteurs de ressources et export/import JSON.

**Architecture** : Cloudflare Workers (site et API), D1 (SQLite), OAuth2 Discord (scope `identify`). Le dépôt GitHub est public ; seules les progressions restent privées dans D1. Aucun bot Discord et aucun nom de domaine payant requis.

## État de la configuration

Le dépôt contient le code, mais le service n'est **pas encore déployé**. La base D1 `aion2-routine-db` est créée et son UUID est déjà renseigné dans `wrangler.toml`. Il reste à initialiser les tables SQL, renseigner le Discord Application ID et configurer le secret Discord sur Cloudflare.

L'adresse retenue est : https://aion2-routine.captntof.workers.dev

## Mise en service (administrateur)

### 1. Base Cloudflare D1

- La base `aion2-routine-db` existe déjà dans Cloudflare. Son Database ID est enregistré dans `wrangler.toml`.
- Dans la console SQL de la base, exécuter **une fois** le contenu de `migrations/0001_initial.sql`. Alternativement, sur un poste avec Wrangler connecté à Cloudflare : `npx wrangler d1 migrations apply aion2-routine-db --remote` (choisir l'une des méthodes, pas les deux).
- Les requêtes de l'API utilisent obligatoirement l'ID Discord provenant du **cookie de session validé par le serveur**, jamais un ID fourni par le navigateur.

### 2. Application Discord

- Sur https://discord.com/developers/applications, **New Application** → `AION 2 Routine`.
- **General Information** : copier l'`Application ID` (= OAuth2 Client ID) et renseigner `DISCORD_CLIENT_ID` dans `wrangler.toml`.
- **OAuth2 → Redirects** : ajouter exactement :
  `https://aion2-routine.captntof.workers.dev/auth/callback`
- Récupérer le **Client Secret** dans la section OAuth2 ; **ne jamais le commiter et ne pas le communiquer dans un chat**.
- Après création du Worker sur Cloudflare, ajouter le Client Secret via **Worker → Settings → Variables and Secrets → Add → Secret**, nom **`DISCORD_CLIENT_SECRET`** et la valeur du secret.
- Seul le scope **`identify`** est utilisé. Inutile de créer un bot ou de demander des permissions serveur.

### 3. Lier GitHub et publier le Worker

- Cloudflare → **Compute → Workers & Pages → Create application**.
- Choisir **Import a repository** et autoriser le dépôt `captntof-coder/aion2-routine`.
- Nom du Worker : `aion2-routine` (correspond exactement au `name` du `wrangler.toml`).
- Branche : `main` ; dossier racine : `/` ; commande Build : **aucune** ; commande Deploy : `npx wrangler deploy`.
- Cliquer sur **Save and Deploy** après avoir renseigné le UUID D1.
- Dans **Settings → Variables and Secrets**, ajouter le secret `DISCORD_CLIENT_SECRET`.
- Vérifier : `https://aion2-routine.captntof.workers.dev/api/health` doit indiquer `ok:true`, `database:true`, `discord:true`.
- Effectuer le premier essai de connexion Discord et enregistrer une case ; vérifier sur un autre appareil. Puis épingler le lien dans un forum Discord.

## Utilisation / sauvegarde

- En invité : sauvegarde locale au navigateur.
- Avec Discord : cookie de session **HttpOnly, Secure, SameSite=Lax** valable 30 jours ; la base enregistre par utilisateur et par tâche.
- Une mise à jour modifie uniquement la ligne de la tâche concernée. Les appareils rafraîchissent au retour au premier plan et toutes les 30 s lorsqu'ils sont ouverts.
- En absence de réseau : les changements déjà saisis sont conservés localement et envoyés à la reconnexion. Lorsque deux appareils modifient le **même champ** en parallèle, la dernière écriture sur le serveur l'emporte.
- **Importer ma progression locale** copie les coches du navigateur dans le compte. Attention : l'opération peut remplacer les coches distantes de la période courante.
- Export/import JSON disponible depuis la fiche.

## Développeur

```bash
npm install
npm run check
npm run db:local
npm run dev
```

Les cookies `Secure` sont conçus pour l'URL HTTPS de production. Pour l'authentification locale, utiliser un environnement HTTPS de test.

**Sécurité :** n'enregistrer ni jeton API Cloudflare, ni Client Secret Discord dans GitHub, `wrangler.toml`, des captures d'écran ou cette discussion. Les cookies contiennent des jetons aléatoires ; seul leur SHA-256 est stocké dans D1.

# Symbiose sans serveur : le plan

> Proposition du 5 novembre 2026, mise en œuvre sur la branche `local-mode`. Ce document sert de référence pour tout le chantier : on le met à jour à chaque décision. L'avancement est en fin de document.

## 0. En une page

**Objectif.** N'importe qui installe Symbiose depuis l'App Store ou le Play Store, touche « Commencer », se connecte à ChatGPT, et tout marche, sans serveur et sans rien comprendre de technique. Ceux qui ont un serveur gardent tout ce qu'il apporte. Ceux qui savent se servir d'une clé d'API choisissent leur fournisseur dans « Paramètres avancés ».

**Principe : un seul cœur, deux hôtes.** Le code du serveur (routes, services, IA, schéma) devient un paquet commun, `packages/core`. Il tourne :
- sur un serveur, comme aujourd'hui (Node, better-sqlite3, Docker) ;
- **dans l'app**, sur `expo-sqlite`, appelé en mémoire au lieu du réseau.

Les écrans ne savent pas où tourne le cœur. Il n'y a donc qu'une seule logique métier, testée une seule fois, et le même format de données des deux côtés, ce qui rend le passage de l'un à l'autre possible.

**Ce que ça change pour chacun**

| Qui | Avant | Après |
| --- | --- | --- |
| Nouvel utilisateur non technique | Doit trouver ou monter un serveur | « Commencer » puis « Continuer avec ChatGPT » |
| Utilisateur avancé sans serveur | Impossible | Paramètres avancés : Claude, Gemini, Mistral, OpenAI, OpenRouter, Ollama, avec sa clé |
| Utilisateur actuel (serveur) | — | Rien ne change, sa session est reconnue |
| Auto-hébergeur | — | Même image Docker, mêmes variables, nouvelles routes de sauvegarde en plus |

**Les trois points à valider avant tout le reste** (phase 0)
1. **La connexion ChatGPT sur téléphone.** OpenAI n'accepte qu'un retour sur `http://127.0.0.1` : l'app doit écouter elle-même sur cette adresse pendant la connexion.
2. **Le cœur sur Hermes**, le moteur JavaScript de l'app : Hono en mémoire, streaming, Drizzle sur `expo-sqlite`.
3. **La qualité des analyses avec les modèles de ChatGPT**, alors que les prompts ont été réglés sur Claude.

**Les phases**
0. Vérifications sur appareil, et contact avec OpenAI.
1. Extraire le cœur (le serveur reste identique).
2. Faire tourner le cœur dans l'app, d'abord avec une clé d'API.
3. Connexion ChatGPT.
4. Accueil, choix de l'IA, réglages, erreurs d'IA, consentement.
5. Sauvegarde, restauration, passage entre téléphone et serveur.
6. Montre, widgets et Live Activity sans serveur.
7. Conformité, documentation, site, bêta, publication.

Chaque phase laisse l'app publiable. Les phases 2 à 6 restent derrière un interrupteur caché jusqu'à la phase 7.

---

## 1. Ce que les vérifications ont établi

### 1.1 Le code s'y prête déjà

- **Une fabrique.** Le serveur est construit par `createApp(deps)` ([app.ts](../apps/server/src/app.ts), dépendances `{ db, ai, photos, config, fetch }` dans [http.ts](../apps/server/src/http.ts)). Les tests le pilotent déjà en mémoire avec `app.request(...)`, streaming SSE compris ([app.test.ts](../apps/server/src/app.test.ts)). C'est exactement ce que fera l'app.
- **Une base synchrone.** Tous les appels Drizzle sont synchrones (55 `.all()`, 65 `.get()`, 22 `.run()`, aucun `await`), et le pilote `drizzle-orm/expo-sqlite` est lui aussi synchrone (`BaseSQLiteDatabase<'sync', …>`). Les services marcheront tels quels.
- **Pas de tâche de fond.** Aucune file ni minuterie côté serveur : `POST /api/meals` attend l'IA puis écrit. Rien à recréer en arrière-plan sur le téléphone.
- **Les API web sont là.** Expo 58 installe `fetch` (streaming), `ReadableStream`, `TextDecoderStream`, `URL` et `structuredClone` dans Hermes. L'app lit déjà le SSE du serveur ainsi ([api.ts](../apps/mobile/src/lib/api.ts)).
- **Les notifications sont déjà locales** (bilan du matin, alerte d'envie, bilan de la semaine) : aucun service de push à remplacer.
- **Une file hors ligne existe déjà.** Elle garde chaque saisie sur le téléphone avant tout envoi ([outbox.ts](../apps/mobile/src/lib/outbox.ts)).

### 1.2 Ce qui dépend de Node ou du serveur aujourd'hui (inventaire complet)

**Dans le code serveur** (8 070 lignes hors tests, plus 4 053 lignes de tests) :

| Dépendance | Où | Traitement prévu |
| --- | --- | --- |
| `randomUUID` de `node:crypto` | 14 appels dans 10 fichiers | `newId()` du cœur, avec `crypto.randomUUID` (fourni par `expo-crypto` sur téléphone) |
| `createHash('sha256')` | [review.ts](../apps/server/src/services/review.ts) (clé du cache des bilans) | SHA-256 en JS pur (`@noble/hashes`) : même résultat, donc les bilans en cache restent valides |
| `Buffer` pour les photos | [photos.ts](../apps/server/src/services/photos.ts), [meals.ts](../apps/server/src/services/meals.ts), [tracking.ts](../apps/server/src/routes/tracking.ts) | Interface `PhotoStore` avec une version fichiers Node et une version `expo-file-system` ; type de fichier détecté sur le début du base64 |
| `node:fs`, `node:path` | `env.ts`, `db/index.ts`, `services/admin.ts`, `services/photos.ts` | Restent dans l'hôte serveur |
| JWT, scrypt, limiteur de connexions | [auth.ts](../apps/server/src/auth.ts) | Restent côté serveur ; le cœur reçoit une stratégie d'authentification |
| Administration, inscriptions, page QR | `routes/admin.ts`, `services/admin.ts`, `routes/account.ts` (connexion et inscription), `landing.ts` | Restent côté serveur, montés en plus du cœur |
| L'IA choisie une fois au démarrage | [ai/index.ts](../apps/server/src/ai/index.ts) | Sur téléphone, on reconstruit l'app (des objets, rien de lourd) quand l'IA change |
| Migrations lues sur le disque | [db/index.ts](../apps/server/src/db/index.ts) (11 migrations) | Un script les embarque en chaînes pour le migrateur Expo, avec une vérification en CI |
| Table `users` : email et mot de passe obligatoires | [schema.ts](../apps/server/src/db/schema.ts) | Un utilisateur local unique (`local@symbiose.invalid`, mot de passe vide jamais vérifiable) : aucune migration |

**Dans l'app** :

| Point de contact | Où | Traitement prévu |
| --- | --- | --- |
| 65 méthodes d'API (62 JSON, 3 streams) | [api.ts](../apps/mobile/src/lib/api.ts) | Un `fetcher` injecté : le réseau en mode serveur, le cœur en mode local |
| Photos par URL avec en-tête Bearer | `meal/[id].tsx`, `meal-card.tsx`, `queued-meal-card.tsx` | `photoUrl(id)` renvoie un `file://` en mode local |
| Export ouvert dans le navigateur, jeton dans l'URL | [me.tsx](../apps/mobile/src/app/(tabs)/me.tsx) | Remplacé par la sauvegarde en mode local |
| Session `{serverUrl, token}` | [session.tsx](../apps/mobile/src/lib/session.tsx) | `{mode: 'server', …}` ou `{mode: 'local'}` |
| Adresse de serveur préremplie par `EXPO_PUBLIC_SERVER_URL` | [welcome.tsx](../apps/mobile/src/app/welcome.tsx) | Plus de valeur par défaut dans les builds publiés (développement seulement) |
| Codes d'erreur d'IA non traités, messages du serveur en anglais | `errorMessage()` dans [hooks.ts](../apps/mobile/src/lib/hooks.ts) | Codes traduits avec une action (voir 2.5), dans les deux modes |
| L'app ne sait pas si une IA est branchée après la connexion | `/api/info` lu seulement à l'accueil | Un état « Ton IA » persistant |

**Dans le code natif** :

| Cible | Appels au serveur | En mode local |
| --- | --- | --- |
| Widget iOS | `GET /api/glance` quand le cache a plus de 25 min ([Glance.swift](../apps/mobile/targets/controls/Glance.swift)) | Cache seul. La logique « nouvelle journée, compteurs à zéro » existe déjà |
| Live Activity (« J'ai tenu » / « J'ai craqué ») | `PATCH /api/cravings/:id` ([CravingIntents.swift](../apps/mobile/targets/controls/_shared/CravingIntents.swift)) | Directement dans la file `craving.pendingOutcomes`, que l'app rejoue déjà au retour au premier plan |
| Montre | 6 appels directs : glance, repas dicté, remanger, annuler, envie, issue de l'envie ([API.swift](../apps/mobile/targets/watch/Core/API.swift)) | Nouveau canal de la montre vers l'iPhone (voir 3.7) |
| Complications, contrôles du Centre de contrôle | Aucun | Rien à faire |
| Android | Aucun code natif ne parle au serveur | Rien à faire |

### 1.3 ChatGPT : ce qu'OpenAI permet

D'après la documentation « Sign in with ChatGPT », partie *ChatGPT plan usage* :
- **Pour qui.** Les apps **open source et locales** peuvent utiliser l'abonnement ChatGPT de l'utilisateur. Les apps payantes ou hébergées passent par un formulaire d'intérêt. Symbiose en mode local rentre dans la première catégorie ; à confirmer avec OpenAI pour une app distribuée sur les stores.
- **Offres concernées.** Plus et Pro, peut-être Go (les sources divergent). Les comptes gratuits peuvent se connecter mais pas utiliser leur abonnement, avec l'erreur `subscription_sharing_user_not_eligible`.
- **Connexion.** OAuth avec PKCE, sans secret côté app. Le premier enregistrement se fait avec `client_id=dynamic_agent_client`, `agent_name_hint` et un `ext_agent_host_id` stable par appareil ; OpenAI renvoie un `client_id` à garder. Périmètre : `offline_access resource.invoke chatgpt.tokens.use.direct`.
- **Retour de connexion.** Uniquement `http://127.0.0.1:<port>/…`, jamais `localhost` ; seul le port peut changer. Aucun schéma d'URL d'app n'est prévu : **c'est le point technique n°1**.
- **Jetons.** Le jeton d'accès vaut 1 h. Le jeton de rafraîchissement vaut 30 jours et se renouvelle à chaque rafraîchissement. Les rafraîchissements doivent passer un par un. La révocation passe par l'`revocation_endpoint` de `/.well-known/openid-configuration`.
- **Appels.** Responses API uniquement (`POST /v1/responses`), avec `stream: true` et `store: false` obligatoires. Le prompt système va dans `instructions`. Images et outils (fonctions) acceptés. Non acceptés : `max_output_tokens`, `temperature`, `metadata`, `previous_response_id`, `prompt_cache_retention`, entre autres. La sortie structurée (`text.format`) n'est pas mentionnée : à tester.
- **Limites.** `subscription_sharing_usage_limit_exceeded` (429) peut arriver **en plein stream** (`response.failed`). L'utilisateur règle un plafond par app dans les réglages de ChatGPT.
- **Règles d'interface.** Bouton « Continue with ChatGPT ». Une fenêtre de bienvenue à la première connexion (« Tu utilises ton abonnement ChatGPT » + OK). Une mention « Abonnement ChatGPT » avec un lien « Gérer l'usage » près de la zone de saisie du coach. Quand la limite est atteinte, l'action principale est « Gérer l'usage ».
- **C'est une préversion** : les règles peuvent bouger.

### 1.4 Les autres fournisseurs

- **Claude.** Anthropic interdit depuis février 2026 d'utiliser un abonnement Pro ou Max dans une app tierce. Claude passe donc par une clé d'API (console Anthropic) ou par OpenRouter.
- **OpenRouter.** OAuth PKCE sans secret : l'app reçoit une clé liée au compte de l'utilisateur, qui paie ses crédits. Le retour sur `localhost` est accepté sur tout port, donc le même module natif que pour ChatGPT sert ici. C'est la porte d'entrée la plus simple vers Claude ou Gemini sans créer de clé.
- **Clés d'API.** Tous les fournisseurs que le serveur gère déjà ([providers.ts](../apps/server/src/ai/providers.ts)) : Anthropic, OpenAI, Gemini, Mistral, OpenRouter, Ollama, et tout serveur compatible OpenAI.
- **Gemini gratuit.** Hors Europe, Google peut utiliser les données de l'offre gratuite pour améliorer ses modèles. Dans l'EEE, au Royaume-Uni et en Suisse, les règles de l'offre payante s'appliqueraient. À vérifier dans les conditions de Google avant d'en parler dans l'app.

### 1.5 Stores et vie privée

- **Apple 5.1.2(i)** (novembre 2025) : avant d'envoyer des données personnelles à une IA tierce, l'app doit dire **quoi** et **à qui**, et obtenir une permission explicite. Une ligne dans la politique de confidentialité ne suffit pas, et des apps ont été refusées pour un consentement mal visible. **Cela vaut aussi pour le mode serveur actuel**, qui n'a pas d'écran de consentement : à faire avant toute publication.
- **Pas de politique de confidentialité.** Le site n'en a aucune, alors que les deux stores en exigent une.
- **HDS.** En mode local, Synapsr n'héberge aucune donnée de santé : pas de certification HDS, pas de responsabilité d'hébergeur. Le serveur `cloud.symbiose.synapsr.io` reste réservé aux testeurs.

---

## 2. L'expérience

### 2.1 Principes

1. **Une seule question par écran**, et toujours une sortie : on ne bloque jamais quelqu'un.
2. **Pas de jargon.** On ne parle pas de « mode local » ni de « serveur » à l'utilisateur normal. On dit « sur ce téléphone » ; « serveur » n'apparaît que derrière « J'ai un serveur Symbiose ».
3. **Le technique est derrière « Paramètres avancés »** et ne gêne jamais le chemin principal.
4. **Rien ne se perd.** Une saisie qui ne peut pas être analysée attend, elle n'est jamais jetée.
5. **Les mêmes écrans dans les deux modes.** Seuls l'accueil et les réglages diffèrent.

### 2.2 Premier lancement

```
Bienvenue ──[Commencer]──► Ton IA ──[Continuer avec ChatGPT]──► connexion OpenAI ──► « Tu utilises ton abonnement ChatGPT » ──► Prénom → Santé → … → Objectif → Plan → Aujourd'hui
   │                         ├── Paramètres avancés ──► choix du fournisseur ──► clé + test ──┘
   │                         └── Plus tard ─────────────────────────────────────────────────────┘
   ├── J'ai déjà une sauvegarde ──► choisir le fichier ──► restauration ──► Ton IA (à rebrancher) ──► Aujourd'hui
   └── J'ai un serveur Symbiose ──► adresse ou QR ──► compte (écran actuel) ──► suite actuelle
```

**L'IA vient avant le profil**, parce que l'étape « Objectif » rédige le plan avec l'IA. Sans IA, le planificateur par mots-clés prend le relais, comme aujourd'hui ([goals.ts](../apps/server/src/services/goals.ts)).

**Écran « Bienvenue »** (refonte de [welcome.tsx](../apps/mobile/src/app/welcome.tsx))
- Le logo et une phrase : « Mange comme tu l'as décidé. »
- Bouton principal : **Commencer**.
- Deux liens discrets : « J'ai déjà une sauvegarde » et « J'ai un serveur Symbiose ».
- Le formulaire actuel (adresse, QR, connexion, inscription, inscription sur demande) part tel quel derrière « J'ai un serveur Symbiose ».

**Écran « Ton IA »** (nouveau)
- Titre : « Branche ton IA ».
- Texte : « Symbiose utilise ton abonnement ChatGPT pour comprendre tes repas et te coacher. Rien de plus à payer. »
- Encadré de consentement, visible sans défiler : « Tes repas (photos et textes), ton objectif, ton profil et les données santé que tu actives sont envoyés à **OpenAI** pour être analysés. Rien n'est envoyé à Synapsr. Tout le reste reste sur ce téléphone. » Avec un lien « En savoir plus ».
- Bouton principal, formulation d'OpenAI : **Continuer avec ChatGPT**.
- Liens : « Paramètres avancés » et « Plus tard ».
- Toucher le bouton, après ce texte, vaut consentement. On enregistre la date et le fournisseur, et on redemande si le fournisseur change.

**Après la connexion ChatGPT**, un tout petit appel de test vérifie que l'offre de la personne est éligible :
- **Éligible** : la fenêtre de bienvenue demandée par OpenAI, « Tu utilises ton abonnement ChatGPT. Tu peux régler ce que Symbiose utilise dans les réglages de ChatGPT », avec « Gérer l'usage » et « OK ».
- **Non éligible** (compte gratuit) : « Ton offre ChatGPT ne permet pas de l'utiliser dans d'autres apps : il faut ChatGPT Plus ou Pro. » Trois choix : « Voir les offres ChatGPT », « Choisir une autre IA » (paramètres avancés), « Continuer sans IA ».
- **Échec ou annulation** : retour à l'écran « Ton IA », sans message d'erreur effrayant.

**« Paramètres avancés » : choisir son IA**
- **Avec ton compte**
  - ChatGPT (le même bouton).
  - OpenRouter, « Se connecter à OpenRouter » : accès à Claude, Gemini, GPT et d'autres, paiement à l'usage.
- **Avec une clé d'API**
  - Anthropic (Claude), OpenAI, Google Gemini, Mistral.
  - Pour chacun : un champ clé avec un bouton « Coller », le modèle (valeur par défaut affichée, modifiable), un lien « Où trouver ma clé ? », puis **Tester et utiliser**.
  - Pour Anthropic, l'identifiant de workspace est rangé sous « Plus d'options ».
- **Sur ton réseau** : Ollama ou un serveur compatible OpenAI, avec l'adresse, le modèle, une clé facultative, et « Ce modèle lit les photos » (oui ou non).
- L'encadré de consentement reprend le nom du fournisseur choisi.

**« Plus tard », sans IA.** Une phrase honnête : « Sans IA, tu peux scanner des codes-barres, noter tes repas à la main et suivre tes modules. Les photos et les descriptions attendront ton IA. » Ensuite :
- les photos et descriptions vont dans la file avec l'état « En attente de ton IA » ;
- elles partent dès qu'une IA est branchée ;
- un bandeau discret sur Aujourd'hui propose « Brancher mon IA ».

### 2.3 Les situations où l'on pourrait perdre quelqu'un

| Situation | Ce qui se passe |
| --- | --- |
| Utilisateur actuel qui met à jour l'app | Sa session serveur est reconnue : rien ne change, pas de nouvel accueil |
| Compte ChatGPT gratuit | Message clair et trois portes de sortie (voir 2.2) |
| Pas de ChatGPT du tout | « Paramètres avancés » ou « Plus tard » : l'app reste utilisable |
| Pas de réseau | Les saisies attendent, comme aujourd'hui ; les données sont lisibles hors ligne puisqu'elles sont sur le téléphone |
| Limite ChatGPT atteinte | Les saisies attendent ; message « Ta limite ChatGPT est atteinte » avec « Gérer l'usage » en premier ; aucune donnée perdue |
| App non ouverte pendant plus de 30 jours (connexion ChatGPT expirée) | Bandeau « Reconnecte ChatGPT » ; les saisies attendent ; aucune donnée perdue |
| Accès à Symbiose retiré depuis les réglages de ChatGPT | Détecté au premier appel ; même bandeau |
| Clé d'API invalide ou sans crédit | « Ta clé Anthropic est refusée » ou « Ton crédit est épuisé », avec « Changer de clé » |
| Nouveau téléphone | « J'ai déjà une sauvegarde » à l'accueil, ou la sauvegarde du système (iCloud, Google) qui ramène la base ; dans ce dernier cas l'app reprend sur ses données et demande seulement de rebrancher l'IA |
| App supprimée sans sauvegarde | La sauvegarde du système couvre la base. Rappel doux dans Moi : « Dernière sauvegarde il y a 34 jours » |
| Envie de passer sur un serveur, ou d'en revenir | « Passer sur un serveur » et « Ramener mes données sur ce téléphone », avec un contrôle que rien ne manque avant de basculer |
| Montre sans iPhone à portée | L'action attend et part à la prochaine ouverture de l'app iPhone (voir 3.7) |

### 2.4 Réglages (onglet Moi)

Deux sections nouvelles, à la place de la ligne « Compte » actuelle :

**Ton IA** (mode local)
- Le fournisseur et son état, par exemple « ChatGPT · Abonnement Plus » ou « Claude · clé d'API ».
- « Gérer l'usage » pour ChatGPT ; pour une clé, les appels du mois et une estimation du coût (déjà calculée par [ai-prices.ts](../apps/server/src/services/ai-prices.ts)).
- « Changer d'IA » et « Déconnecter ».
- En mode serveur : « L'IA de ton serveur : Claude », en lecture seule.

**Tes données**
- *Sur ce téléphone* : « Sauvegarder maintenant », « Dernière sauvegarde : … », « Restaurer une sauvegarde », « Passer sur un serveur Symbiose », « Effacer toutes mes données ».
- *Sur `<serveur>`* : « Exporter », « Ramener mes données sur ce téléphone », « Se déconnecter », « Supprimer mon compte ».

### 2.5 Erreurs d'IA, traduites et avec une action

Aujourd'hui, l'utilisateur voit le message brut du serveur, en anglais. On traduit chaque code, dans les deux modes :

| Code | Message | Action |
| --- | --- | --- |
| `ai_disabled` | « Pas encore d'IA branchée » | Brancher mon IA (local), rien en mode serveur |
| `ai_plan_limit` (nouveau, ChatGPT) | « Ta limite ChatGPT est atteinte » | Gérer l'usage |
| `ai_not_eligible` (nouveau) | « Ton offre ChatGPT ne le permet pas » | Choisir une autre IA |
| `ai_reconnect` (nouveau) | « Reconnecte ChatGPT » | Se reconnecter |
| `ai_misconfigured` | « Ta clé est refusée » | Changer de clé |
| `ai_rate_limited` | « Trop de demandes, on réessaie dans un instant » | Automatique |
| `ai_unreachable` | « L'IA ne répond pas » | Automatique, comme le hors-ligne |
| `ai_no_vision` | « Ce modèle ne lit pas les photos : décris ton repas » | Écrire |
| `ai_refused`, `ai_bad_output`, `ai_error` | « L'analyse n'a pas marché » | Réessayer |

**Règles de la file en mode local** ([outbox-logic.ts](../apps/mobile/src/lib/outbox-logic.ts)) : `ai_unreachable` compte comme une absence de réseau ; `ai_plan_limit` et `ai_rate_limited` attendent plus longtemps ; `ai_disabled` et `ai_reconnect` mettent la saisie en « En attente de ton IA » au lieu de l'abandonner.

### 2.6 Ce que chaque mode offre

| | Sur ce téléphone | Avec un serveur |
| --- | --- | --- |
| Repas, coach, envies, bilans, modules | Oui, avec l'IA de l'utilisateur | Oui, avec l'IA du serveur |
| Fonctionne sans rien installer | Oui | Non |
| Plusieurs appareils, version web | Non | Oui |
| Montre sans l'iPhone à côté | Les actions attendent l'iPhone | Oui, la montre parle au serveur |
| Widgets | Mis à jour par l'app | Mis à jour par l'app et par eux-mêmes |
| Famille ou amis sur la même installation | Non | Oui |
| Sauvegarde | Fichier, plus la sauvegarde du système | Le serveur, avec ses copies avant chaque migration |
| Vue admin | Non | Oui |

---

## 3. L'architecture

### 3.1 Un cœur, deux hôtes

```
                       packages/shared (calculs, schémas zod) ─ inchangé
                                   │
                       packages/core (nouveau)
            routes Hono · services · adaptateurs IA · schéma Drizzle · migrations
              createApp({ db, ai, photos, auth, fetch, newId, … })
                 │                                         │
   apps/server (hôte Node)                    apps/mobile/src/local (hôte téléphone)
   better-sqlite3 · photos sur disque          expo-sqlite · photos dans Documents
   JWT + scrypt · inscriptions · admin         utilisateur local unique, sans jeton
   page QR · copies avant migration            IA réglée sur le téléphone (SecureStore)
   Docker                                      fetcher en mémoire pour api.ts
```

### 3.2 `packages/core`

**Déplacé depuis `apps/server/src`** :
- `routes/`, sauf `admin.ts` et la partie connexion et inscription de `account.ts` ;
- `services/`, sauf `admin.ts` ;
- `ai/`, `db/schema.ts`, `drizzle/`, `http.ts`, `errors.ts`, `app.ts`.

**Changements dans ce code** :
- `Db` devient le type générique SQLite synchrone de Drizzle, compatible avec les deux pilotes. `.run().changes` existe des deux côtés.
- `newId()` remplace `randomUUID`, `sha256()` en JS pur remplace `createHash`, et `Buffer` disparaît au profit d'une interface `PhotoStore` :
  - `save(userId, base64)` renvoie `{id, mime}` ;
  - `readBase64(id)` ;
  - `remove(id)` ;
  - `respond(id)`, pour `GET /api/photos/:id` en mode serveur.
- `createApp(deps, options)` reçoit :
  - `auth`, un middleware qui pose `userId` : JWT côté serveur, utilisateur local côté téléphone ;
  - `extraRoutes`, pour l'admin, les inscriptions et la page QR, côté serveur seulement ;
  - `http`, qui active CORS, les limites de taille et le logger, côté serveur seulement.
- Une règle ESLint interdit dans le cœur `node:*`, `process` et `Buffer`, pour qu'il ne redevienne jamais dépendant de Node.
- Un script génère `migrations.ts` (journal et SQL en chaînes) pour le migrateur Expo, et la CI vérifie qu'il est à jour.

### 3.3 L'hôte téléphone (`apps/mobile/src/local/`)

- **Base** :
  - `db.ts` ouvre `symbiose.db` avec `expo-sqlite` (`foreign_keys = ON`, WAL), applique les migrations et crée l'utilisateur local au premier lancement.
  - Emplacement : `Documents/` sur iOS, pour la sauvegarde iCloud du téléphone. Sur Android, des règles Auto Backup incluent la base et excluent les photos, car **au-delà de 25 Mo Android ne sauvegarde plus rien**. Ces règles doivent cohabiter avec celles qu'`expo-secure-store` ajoute déjà : à vérifier au prebuild.
- **Photos** : `Documents/photos/<id>.jpg`, affichées en `file://`.
- **IA** :
  - le réglage (fournisseur, modèle, clé ou jetons) est rangé dans SecureStore ;
  - l'adaptateur est construit au lancement et reconstruit à chaque changement ;
  - les SDK reçoivent `expo/fetch` pour le streaming.
- **`api.ts`** : `createApi(baseUrl, token, fetcher)`. Le fetcher local appelle `app.request(...)`. Rien ne change dans les écrans.
- **`session.tsx`** décide du mode au lancement :
  1. une session serveur existe : mode serveur, comme aujourd'hui ;
  2. sinon, une base locale existe (cas d'un téléphone restauré par le système) : mode local ;
  3. sinon : écran Bienvenue.

  **Le mode ne dépend jamais seulement de SecureStore**, qu'Android exclut de ses sauvegardes.
- **Inchangés, ils passent simplement par le fetcher** : Open Food Facts (le même code du cœur, appelé depuis le téléphone), la synchro Santé, les notifications, la file hors ligne.
- **Au lancement** : purge des statistiques d'usage de l'IA de plus de 13 mois, comme le fait le serveur.

### 3.4 L'IA côté téléphone

- **Clés d'API** : les adaptateurs actuels ([claude.ts](../apps/server/src/ai/claude.ts), [openai.ts](../apps/server/src/ai/openai.ts)), sans changement de fond : mêmes prompts, mêmes schémas, mêmes contrôles.
- **Abonnement ChatGPT** : un nouvel adaptateur `ai/chatgpt.ts` sur la Responses API.
  - Toujours en streaming, avec `store: false` ; le prompt système dans `instructions`, l'entrée en tableau.
  - Photos en `input_image` (data URL).
  - Sortie structurée en `text.format` JSON Schema, ou, si la phase 0 montre que ce n'est pas accepté, en appel de fonction forcé.
  - Outils du coach en fonctions.
  - Il obtient le jeton par une fonction qui rafraîchit au besoin.
  - Il traduit les erreurs, y compris `response.failed` en plein stream, vers les codes de 2.5.
- **Coût** : chaque appel est déjà compté (`AiUsageListener`) ; on réutilise ce comptage pour « Ton IA » dans Moi.

### 3.5 Connexion ChatGPT, en détail

- **Module natif `modules/loopback-auth`** :
  - iOS : `NWListener` sur `127.0.0.1` (port libre) et `ASWebAuthenticationSession` (partage les cookies de Safari) ;
  - Android : `ServerSocket` et Custom Tabs ;
  - il sert une petite page « C'est bon, retourne dans Symbiose », renvoie `{code, state, redirectUri}` au JS et ferme le navigateur ;
  - il sert aussi pour OpenRouter.
- **`src/local/chatgpt-auth.ts`** :
  - un `ext_agent_host_id` (`urn:uuid:` tiré une fois par installation) et le `client_id` reçu, gardés dans SecureStore ;
  - PKCE S256, `state` et `nonce` neufs à chaque tentative, contrôle du `nonce` dans l'ID token ;
  - rafraîchissement près de l'expiration, **une seule promesse à la fois** (le jeton tourne), jamais d'effacement sur une simple panne réseau ;
  - déconnexion par la révocation, puis effacement local.
- **Choix du modèle** : `GET /v1/models` (ceux en `visibility: "list"`), avec une valeur par défaut, et une mise à jour si le compte change.
- **Banc d'essai avant d'en faire le chemin principal** : une vingtaine de repas de référence (photos et textes, valeurs connues) passés sur Claude et sur le modèle ChatGPT. On compare l'énergie, les sucres ajoutés et le nombre de questions posées. On règle les prompts si l'écart est trop grand.

### 3.6 Sauvegarde : format et flux

**Format `.symbiose`** (recommandé) : un fichier SQLite autonome contenant :
- toutes les tables de l'utilisateur ;
- une table `backup_photos(id, mime, data BLOB)` ;
- une table `backup_meta` : version du format, version de l'app, dernière migration, date, nombre de lignes par table, origine (téléphone ou serveur).

Pourquoi ce format :
- un seul fichier, sans bibliothèque zip ;
- lisible par n'importe quel outil SQLite ;
- le même format côté téléphone et côté serveur.

Les photos y sont copiées une par une, pour ne pas tout charger en mémoire.

**Sur le téléphone**
- **Sauvegarder** : `VACUUM INTO` (copie cohérente), ajout des photos, puis le menu de partage (`expo-sharing`) vers Drive, iCloud Drive, Fichiers ou un mail. La taille est affichée avant.
- **Restaurer** : `expo-document-picker`, puis on lit `backup_meta`.
  - Format plus récent que l'app : « Mets Symbiose à jour d'abord ».
  - Format plus ancien : restauration, puis migrations.
  - L'ancienne base est gardée jusqu'au lancement suivant réussi.
- **Rappel** : « Dernière sauvegarde : … » dans Moi, et une phrase douce après 30 jours sans sauvegarde.

**Côté serveur** (routes ajoutées, rien de cassé)
- `GET /api/me/backup` : le même fichier, pour un seul utilisateur.
- `POST /api/me/restore` :
  - écrit sur le disque au fil de l'envoi ;
  - dans un compte vide, ou avec un « remplacer » explicite ;
  - les identifiants déjà pris sont régénérés avec leurs références (`photoId`, photos des plats, repas cités par le coach) : à inventorier précisément en phase 5 ;
  - une limite de taille dédiée.

**Passer de l'un à l'autre**
- **Vers un serveur** : adresse, compte, envoi, puis comparaison des nombres de lignes. La bascule ne se fait qu'ensuite. La copie du téléphone reste jusqu'à ce que l'utilisateur la supprime.
- **Vers le téléphone** : `GET /api/me/backup`, restauration, contrôle, bascule. Le compte serveur reste, et on propose de le supprimer.

**L'export JSON actuel** (`/api/me/export`) reste : il sert à la portabilité RGPD, pas à la restauration.

### 3.7 Montre, widgets et Live Activity sans serveur

- **Widgets**
  - L'app écrit `widget.mode = local` et ne met plus d'adresse ni de jeton dans l'App Group.
  - En mode local, [Glance.swift](../apps/mobile/targets/controls/Glance.swift) ne contacte jamais le réseau : il affiche le cache, avec la journée remise à zéro quand on change de jour (ça existe déjà hors ligne).
  - `SymbioseGroup.session` considère le mode local comme connecté.
- **Live Activity** : en mode local, l'intention met l'issue dans `craving.pendingOutcomes` ; l'app la rejoue déjà au retour au premier plan ([live-activity.ios.ts](../apps/mobile/src/lib/live-activity.ios.ts)).
- **Montre**
  - L'iPhone continue d'envoyer le glance par `updateApplicationContext`, avec `mode: local`.
  - **Nouveau canal de la montre vers l'iPhone** pour les repas dictés, « remanger » et les envies :
    - `sendMessage` quand l'iPhone est joignable et que son app tourne : réponse immédiate ;
    - sinon `transferUserInfo`, une file garantie traitée à la prochaine ouverture de l'app iPhone.
  - [WatchBridgeModule.swift](../apps/mobile/modules/watch-bridge/ios/WatchBridgeModule.swift) reçoit ces messages et les passe au JS, qui les traite par le cœur puis renvoie le nouveau glance.
  - La montre affiche alors « Noté : ton iPhone l'analysera ». Le conseil d'envie vient d'une petite liste locale tant que l'iPhone n'a pas répondu.
  - Limite assumée : React Native ne démarre pas en arrière-plan, donc une action faite iPhone fermé attend son ouverture. Le mode serveur garde l'avantage d'une montre autonome.

### 3.8 Sécurité

- **Clés et jetons** : uniquement dans SecureStore (trousseau iOS, Keystore Android). Jamais dans l'App Group, jamais envoyés à la montre, jamais dans les journaux.
- **En mode local, l'app ne contacte que** le fournisseur d'IA choisi, Open Food Facts (codes-barres) et OpenAI ou OpenRouter pendant la connexion.
- **Réseau local (Ollama)** : `NSAllowsLocalNetworking` est déjà actif. Il faut ajouter `NSLocalNetworkUsageDescription` pour la demande d'accès au réseau local d'iOS.

---

## 4. Les phases

Chaque phase dit ce qu'elle livre et quand elle est terminée.

### Phase 0 : vérifier sur appareil (prototypes jetables)

**Ce qu'on fait**
1. **Le cœur sur Hermes**, dans un écran de développement :
   - `createApp` sur `expo-sqlite`, avec les 11 migrations embarquées, dont `0008` et son `PRAGMA foreign_keys` ;
   - avec l'IA factice : un jour, un repas texte, un repas photo de 5 Mo, le stream du coach, une erreur 4xx ;
   - les appels sensibles au moteur : `normalize('NFD')`, `toLocaleDateString(…, { timeZone: 'UTC' })`, `crypto.randomUUID`.
2. **Les SDK d'IA sur téléphone** : Anthropic et OpenAI avec une vraie clé de développement, en sortie structurée et en streaming via `expo/fetch`.
3. **ChatGPT sur iPhone et sur Android** :
   - le module de retour sur `127.0.0.1` ;
   - enregistrement, jetons, un appel Responses avec photo et sortie structurée en streaming ;
   - un rafraîchissement ;
   - avec un compte Plus, puis un compte gratuit pour voir le code d'erreur.
4. **Écrire à OpenAI** : confirmer qu'une app open source gratuite distribuée sur les stores est éligible, et demander si un retour par lien d'app (schéma ou lien universel) est prévu sur mobile.
5. **Le banc d'essai** Claude contre ChatGPT (voir 3.5).

**Décisions qui en découlent**
- Si le streaming ne passe pas en mémoire, les trois routes de streaming sont appelées directement, sans HTTP, en mode local.
- Si ChatGPT ne passe pas sur mobile, ou si OpenAI refuse, on lance avec « Paramètres avancés » et OpenRouter, et ChatGPT arrive plus tard. **C'est à décider ensemble**, puisque ChatGPT est le chemin principal voulu.
- Si les analyses GPT sont nettement moins bonnes, on ajuste les prompts avant la phase 3.

**Terminé quand** chaque point a une réponse écrite dans ce document.

### Phase 1 : extraire le cœur

- Créer `packages/core` et y déplacer le code (voir 3.2) ; l'hôte Node reste dans `apps/server`.
- `newId`, `sha256`, `PhotoStore`, stratégie d'authentification, routes en plus pour l'hôte serveur, règle ESLint, script des migrations avec sa vérification en CI.
- Les tests suivent le code et tournent aussi avec l'authentification locale.

**Terminé quand** tous les tests passent, l'image Docker se comporte exactement comme avant (démarrage, migrations, copies, admin, QR) et un auto-hébergeur ne voit aucune différence. **Publiable seule.**

### Phase 2 : le cœur dans l'app, avec une clé d'API

- Ajouter `expo-sqlite`, `expo-crypto`, `expo-sharing` et `expo-document-picker`.
- Écrire `src/local/` (base, photos, hôte, fetcher, IA réglée sur le téléphone).
- Session à deux modes ; `api.ts` avec fetcher ; `photoUrl` local.
- Règles de la file en mode local (voir 2.5).
- Règles Auto Backup Android ; base et photos dans `Documents/` sur iOS.
- Un interrupteur caché (build de développement) pour démarrer en local, avec un écran de réglage de clé provisoire.

**Terminé quand**, sur iPhone et Android, en mode local avec une clé :
- tout marche : repas (photo, texte, code-barres, plats, correction, remanger), coach avec propositions, envies, bilan du matin, alertes, bilan de la semaine, Santé, journal, modules ;
- en mode avion, les saisies attendent puis partent ;
- l'app ne contacte que l'IA et Open Food Facts ;
- le mode serveur est intact.

### Phase 3 : connexion ChatGPT

- Le module `loopback-auth`, `chatgpt-auth.ts` et l'adaptateur `ai/chatgpt.ts`.
- Les nouveaux codes d'erreur et le choix du modèle.
- La fenêtre de bienvenue, la mention « Abonnement ChatGPT » et « Gérer l'usage » près du coach.
- Le banc d'essai repassé avec les prompts finaux.

**Terminé quand** :
- un compte Plus fait tout le parcours et toutes les fonctions d'IA ;
- un compte gratuit reçoit le bon message et ses trois sorties ;
- le rafraîchissement au bout d'une heure fonctionne ;
- une déconnexion faite depuis ChatGPT est détectée ;
- une limite atteinte en plein stream est bien gérée.

### Phase 4 : accueil, choix de l'IA, réglages, erreurs, consentement

- Refonte de `welcome.tsx` en « Bienvenue » ; le formulaire serveur passe dans `server.tsx`, sans perte (QR, sonde `/api/info`, inscription sur demande).
- Les écrans « Ton IA » et « Paramètres avancés », y compris OpenRouter.
- L'ordre de l'onboarding en mode local : IA d'abord.
- Les sections « Ton IA » et « Tes données » dans Moi.
- Les erreurs d'IA traduites (voir 2.5), dans les deux modes.
- **Le consentement dans les deux modes.** En mode serveur, une fois, en nommant le fournisseur du serveur ; `/api/info` l'expose en plus.
- Le préremplissage `EXPO_PUBLIC_SERVER_URL` retiré des builds publiés.
- Tous les textes en français et en anglais.

**Terminé quand** deux ou trois personnes non techniques ont fait chaque parcours (ChatGPT, compte gratuit, plus tard, sauvegarde) sans aide ni question.

### Phase 5 : sauvegarde, restauration, passages

- Le format `.symbiose`, la sauvegarde et la restauration sur le téléphone, et le rappel.
- `GET /api/me/backup` et `POST /api/me/restore` sur le serveur.
- Les parcours « Passer sur un serveur » et « Ramener mes données sur ce téléphone », avec contrôle.

**Terminé quand** :
- les tests d'aller-retour passent en CI (téléphone → fichier → serveur → fichier → téléphone, mêmes lignes, mêmes photos) ;
- une restauration sur un nouveau téléphone a été faite à la main sur iOS et Android ;
- une restauration par la sauvegarde du système a été vérifiée.

### Phase 6 : montre, widgets, Live Activity sans serveur

- Widgets et Live Activity en mode local (voir 3.7).
- Le canal de la montre vers l'iPhone, les états affichés sur la montre et les conseils d'envie locaux.
- Au passage, le bug actuel : `CravingHelp.alternative` doit être optionnel ([API.swift:107](../apps/mobile/targets/watch/Core/API.swift#L107)), puisque le serveur peut renvoyer `null`.

**Terminé quand** chaque action de la montre en mode local aboutit tout de suite ou attend puis aboutit à la prochaine ouverture de l'iPhone, sans jamais se perdre, et que le widget passe minuit correctement.

### Phase 7 : conformité, documentation, publication

- **Politique de confidentialité** sur le site, en français et en anglais : mode local, mode serveur, fournisseurs d'IA, Open Food Facts, Santé, aucun traceur.
- **Fiches des stores** : étiquettes de confidentialité de l'App Store, section « Sécurité des données » de Google Play, déclaration santé, textes des fiches.
- **Notes pour la revue d'Apple** : le chemin « Plus tard », et une clé de test plafonnée ou un compte de démonstration sur un serveur.
- **Documentation et site** :
  - README : « sur ton téléphone, ou sur ton serveur » ;
  - [architecture.md](architecture.md) ;
  - [self-hosting.md](self-hosting.md), avec une section « Pourquoi héberger un serveur » ;
  - le site : accroche, section vie privée, FAQ, feuille de route.
- **Bêta** : TestFlight (toi, Lisa) et test interne Google Play (Maëlys), avec une liste de contrôle par parcours. Ensuite, la publication.

---

## 5. Tests

- **Le cœur** : toute la suite actuelle, lancée avec l'authentification JWT et avec l'authentification locale.
- **ChatGPT** : l'adaptateur testé contre un faux stream Responses (succès, `response.incomplete`, `response.failed` en plein stream, 401, 403, 429), comme [openai.test.ts](../apps/server/src/ai/openai.test.ts).
- **Les jetons** : rafraîchissements simultanés, jeton tournant, panne réseau (on garde), erreur définitive (on reconnecte).
- **La sauvegarde** : aller-retour, migration d'une sauvegarde ancienne, refus d'une sauvegarde plus récente, collision d'identifiants.
- **La file en mode local** : chaque code d'erreur d'IA aboutit au bon état.
- **La CI** : règle « pas de Node dans le cœur » et migrations embarquées à jour.
- **Sur appareil**, à chaque phase, sur iPhone et Android : la liste de 2.3, ligne par ligne.

## 6. Ce qui ne change pas

- Le mode serveur, l'API (les ajouts seulement), l'image Docker et ses variables.
- `packages/shared` et tous les calculs.
- Les écrans hors accueil et réglages.
- La file hors ligne, la synchro Santé, les notifications, les widgets et la montre en mode serveur.

## 7. Plus tard (hors de ce chantier)

- Sauvegarde automatique vers iCloud Drive (capacité iCloud à ajouter) et Google Drive (portée `drive.appdata`, non sensible).
- Sauvegardes chiffrées par mot de passe.
- ChatGPT pour chaque utilisateur d'un serveur : c'est le cas « hébergé », qui passe par le formulaire d'OpenAI.
- Une IA sur l'appareil comme secours gratuit.
- Plusieurs appareils sans serveur, et Wear OS.

## 8. Décisions à prendre

1. **Format de sauvegarde** : fichier SQLite avec les photos dedans (recommandé) ou archive zip.
2. **Sans IA** : mettre les photos et descriptions en attente (recommandé) ou bloquer leur saisie.
3. **Modèles par défaut pour les clés personnelles** : par exemple un modèle moins cher qu'Opus pour Anthropic, à choisir avec les chiffres réels de la vue admin.
4. **Si ChatGPT ne passe pas en phase 0** : lancer sans ChatGPT, ou attendre.
5. **Le serveur `cloud.symbiose.synapsr.io`** reste fermé au public (recommandé, pour la question HDS).

## 9. Risques

| Risque | Parade |
| --- | --- |
| Le retour sur `127.0.0.1` ne marche pas sur mobile, ou OpenAI refuse | Phase 0 en premier ; lancement possible sans ChatGPT ; question posée à OpenAI dès le départ |
| La préversion d'OpenAI change ses règles | Adaptateur isolé, codes d'erreur génériques, les autres fournisseurs restent disponibles |
| Analyses GPT moins justes | Banc d'essai, réglage des prompts ; les contrôles par le code restent les mêmes |
| Différences de Hermes (Intl, dates) | Contrôles de phase 0, tests sur appareil |
| Perte de données en mode local | Sauvegarde du système, fichier, rappel, contrôle avant chaque bascule |
| Refus à la revue d'Apple | Écran de consentement explicite, notes de revue, chemin sans IA |
| Plus de 25 Mo de données sur Android | Photos exclues ; on surveille la taille de la base |

## Sources

- OpenAI, Sign in with ChatGPT : [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)
- Offres éligibles : [The New Stack](https://thenewstack.io/sign-in-with-chatgpt/), [xenospectrum](https://xenospectrum.com/en/chatgpt-sign-in-subscription-apps/)
- Anthropic et les abonnements : [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)
- OpenRouter : [OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)
- Apple 5.1.2(i) : [TechCrunch](https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai), [forum développeurs Apple](https://developer.apple.com/forums/thread/820209)
- Google Drive, portées : [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- Gemini, offre gratuite : [meetily.ai](https://meetily.ai/llm-privacy/gemini) (source secondaire, à vérifier dans les conditions de Google)

---

## Avancement (branche `local-mode`)

| Phase | État | Où |
| --- | --- | --- |
| 1. Le cœur | Fait. Le serveur tourne sur `packages/core`, image et API inchangées, tous les tests passent. | `packages/core`, `apps/server/src/app.ts` |
| 2. Le cœur dans l'app | Fait. API en mémoire sur `expo-sqlite`, `Response` capable de streams, utilisateur unique, photos dans Documents, file hors ligne « en attente de ton IA ». Testé dans Node avec les classes réseau de React Native (`local-mode.test.ts`). | `apps/mobile/src/local`, `packages/core/src/in-process.ts`, `local.ts` |
| 3. ChatGPT | Écrit et testé contre une fausse API (9 tests) : adaptateur Responses, connexion PKCE avec retour sur `127.0.0.1` (module natif iOS et Android), jetons rafraîchis un par un, vérification de l'offre. **À essayer avec un vrai compte Plus.** | `packages/core/src/ai/chatgpt.ts`, `src/local/chatgpt-auth.ts`, `modules/loopback-auth` |
| 4. Accueil, IA, réglages, erreurs, consentement | Fait. Bienvenue, étape « Branche ton IA », « Choisis ton IA » (ChatGPT, OpenRouter, clés, réseau local), Moi, erreurs traduites, consentement dans les deux modes. | `src/app/welcome.tsx`, `server.tsx`, `ai-setup.tsx`, `onboarding.tsx`, `(tabs)/me.tsx`, `lib/error-texts.ts` |
| 5. Sauvegarde | Fait. Format `.symbiose` commun, sauvegarde partagée, restauration, passages téléphone ↔ serveur (`GET /api/me/backup`, `POST /api/me/restore`), règles Auto Backup Android. Aller-retour testé (`backup.test.ts`). | `packages/core/src/backup.ts`, `src/local/backup*.ts`, `apps/server/src/routes/backup.ts`, `plugins/with-backup-rules.js` |
| 6. Montre, widgets, Live Activity | Fait. Widgets et Live Activity sans réseau en mode local ; la montre passe par l'iPhone (réponse immédiate, sinon file garantie). Bug `CravingHelp.alternative` corrigé. | `targets/`, `modules/watch-bridge`, `src/lib/watch.ios.ts` |
| 7. Conformité, docs, publication | Fait pour le dépôt : politique de confidentialité ([PRIVACY.md](../PRIVACY.md)), README, architecture, auto-hébergement, site. Restent les fiches des stores et la revue d'Apple (voir ci-dessous). | `PRIVACY.md`, `README.md`, `docs/`, `website/src/i18n.ts` |

### Vérifié sur le simulateur iOS (Hermes, build de développement)

`symbiose://dev-check` (ou l'argument de lancement `-symbioseDevCheck 1`) fait tourner l'API dans le moteur de l'app, sur une base à part : **18 vérifications sur 18**. Migrations sur expo-sqlite, utilisateur unique, Intl, plan sans IA, repas texte et photo, journée, coach en streaming, glance, alertes, sauvegarde scellée avec sa photo, les SDK d'Anthropic et d'OpenAI qui joignent bien leur API (clé refusée, rien de facturé), l'adaptateur ChatGPT (jeton refusé → `ai_reconnect`), le serveur de retour sur `127.0.0.1`.

Deux problèmes trouvés et corrigés grâce à ces essais :
- **Le SDK d'Anthropic** plantait au démarrage dans Metro (ré-exports circulaires de sa version ESM). Metro charge désormais la version CommonJS des SDK d'IA (`apps/mobile/metro.config.js`).
- **Le serveur de retour iOS** ne recevait rien avec `acceptLocalOnly`. Il est maintenant lié explicitement à `127.0.0.1`.

Écrans vérifiés : Bienvenue, « Branche ton IA », « Choisis ton IA », Aujourd'hui (avec la notice « Branche ton IA »), Moi.

**Android** : l'app compile (module de retour local en Kotlin, règles de sauvegarde dans le manifeste), mais elle n'a pas encore tourné sur un émulateur : le build de debug n'a pas trouvé Metro. À essayer sur un appareil ou avec `expo run:android`.

### Ce qui reste à faire par toi
- Essayer « Continuer avec ChatGPT » avec un compte Plus, puis un compte gratuit, sur iPhone et Android.
- Écrire à OpenAI : éligibilité d'une app gratuite open source publiée sur les stores, et retour vers l'app sur mobile.
- Le banc d'essai des analyses (Claude et ChatGPT sur les mêmes repas).
- Les fiches des stores (étiquettes de confidentialité, sécurité des données) et les notes pour la revue d'Apple.

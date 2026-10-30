export type Lang = 'fr' | 'en';

export const REPO = 'https://github.com/Synapsr/Symbiose';

export const DOCKER_RUN = `docker run -d --name symbiose \\
  -p 3000:3000 \\
  -e ANTHROPIC_API_KEY=sk-ant-... \\
  -v symbiose-data:/data \\
  ghcr.io/synapsr/symbiose:latest`;

export type GoalId = 'sugar' | 'weight' | 'muscle' | 'fiber';

const fr = {
  meta: {
    title: 'Symbiose · Mange en conscience, pas en comptant.',
    description:
      "Symbiose est un compagnon repas open source, piloté par l'IA. Dis ton objectif avec tes mots, photographie ton assiette : il calcule tout selon ce qui compte pour toi, sur ton propre serveur.",
  },
  nav: {
    skip: 'Aller au contenu',
    how: 'Fonctionnement',
    features: 'Fonctions',
    precision: 'Précision',
    privacy: 'Vie privée',
    faq: 'FAQ',
    github: 'GitHub',
    githubLabel: 'Symbiose sur GitHub',
    darkMode: 'Mode sombre',
    language: 'Langue',
    home: 'Symbiose, accueil',
    primary: 'Navigation principale',
  },
  hero: {
    eyebrow: ['Open source', 'Auto-hébergé', 'Licence MIT'],
    title1: 'Mange en conscience,',
    title2: 'pas en comptant.',
    lead: "Dis ce que tu veux changer, avec tes mots. Prends ton repas en photo. Symbiose calcule tout selon ton objectif, sur ton propre serveur.",
    ctaPrimary: 'Héberger mon serveur',
    ctaSecondary: 'Voir le code',
    note: 'Sans abonnement, sans pub, sans paywall.',
    chipAnalyzing: 'Je traque les sucres cachés…',
    chipRule: 'Sucres ajoutés ≤ 25 g par jour',
    altLight: "L'écran Aujourd'hui de Symbiose, centré sur les sucres ajoutés face à une limite de 25 g",
    altDark: "L'écran Tendances en mode sombre : moyenne de sucres ajoutés et d'où ils viennent",
  },
  facts: [
    { value: '2', label: 'gestes pour noter un repas' },
    { value: '≤ 1', label: 'question, seulement si elle change le calcul' },
    { value: '0', label: 'abonnement, pub ou paywall' },
    { value: '1', label: 'conteneur Docker, tes données chez toi' },
  ],
  how: {
    kicker: 'Comment ça marche',
    title: 'Trois étapes, puis tu n’y penses plus.',
    steps: [
      {
        title: 'Dis ce que tu veux changer.',
        body: "Avec tes mots, pas dans un formulaire. L'IA en fait un plan précis, que tu peux reformuler ou ajuster.",
        alt: "L'onboarding : l'objectif écrit avec ses propres mots",
      },
      {
        title: 'Photographie, écris ou scanne.',
        body: "Deux gestes. Une photo, une phrase (la dictée marche) ou un code-barres Open Food Facts. Le repas apparaît tout de suite, pendant que l'IA l'analyse.",
        alt: 'Un repas décrit en texte, prêt à être analysé',
      },
      {
        title: 'Vois ce qui compte pour toi.',
        body: "L'accueil affiche le chiffre de ton objectif : les sucres ajoutés si tu veux réduire le sucre, les calories si tu vises ton poids. Chaque repas reçoit un retour d'une ligne, sans morale.",
        alt: "Le détail d'un repas : les sucres ajoutés, la part de la limite du jour et un conseil",
      },
    ],
    extras: {
      quote: '« Je veux réduire le sucre ajouté, j’en prends souvent par réflexe l’après-midi au bureau. »',
      result: ['Sucres ajoutés ≤ 25 g par jour, repère OMS', 'Une habitude qui vise le réflexe de l’après-midi'],
      status: 'Je traque les sucres cachés…',
      feedback: '≈ 8 g de sucres ajoutés dans ce repas.',
      tip: '34 % de ta limite du jour',
    },
  },
  goals: {
    kicker: 'Piloté par ton objectif',
    title: 'Un objectif, un écran.',
    body: "Un compteur de calories pour tout le monde, quel que soit le but ? Symbiose met en avant le chiffre qui compte pour toi, et adapte le ton de ses retours.",
    pick: 'Choisis un objectif',
    yourWords: 'Tes mots',
    yourPlan: 'Ton plan',
    eaten: 'Mangé',
    caption: 'Exemple de journée, chiffres illustratifs.',
    options: {
      sugar: {
        label: 'Réduire le sucre',
        words: '« Je veux réduire le sucre ajouté, j’en prends souvent par réflexe. »',
        metric: 'Sucres ajoutés',
        limit: 'À ne pas dépasser',
        unitLeft: 'g restants',
        secondary: 'kcal',
        plan: ['Sucres ajoutés ≤ 25 g par jour · repère OMS', 'Quand l’envie arrive, attendre 10 minutes avec un verre d’eau'],
        voice: 'Encore 7 g de marge côté sucres ajoutés. Tu gères.',
      },
      weight: {
        label: 'Perdre du poids',
        words: '« Je veux perdre du poids progressivement, sans frustration. »',
        metric: 'Énergie',
        limit: 'Objectif',
        unitLeft: 'kcal restantes',
        secondary: 'g protéines',
        plan: ['Déficit de 15 %, jamais sous ton métabolisme de base', 'Protéines 1,6 g/kg pour garder ton muscle'],
        voice: '610 kcal pour finir la journée en douceur.',
      },
      muscle: {
        label: 'Prendre du muscle',
        words: '« Je veux prendre du muscle, une prise de masse propre. »',
        metric: 'Protéines',
        limit: 'À atteindre',
        unitLeft: 'g à atteindre',
        secondary: 'kcal',
        plan: ['Surplus de 10 %, plafonné à 20 %', 'Protéines 1,8 g/kg par jour'],
        voice: 'Encore 44 g à trouver côté protéines. Pense œufs, légumineuses, yaourt nature.',
      },
      fiber: {
        label: 'Plus de fibres',
        words: '« Je veux manger plus de fibres. »',
        metric: 'Fibres',
        limit: 'À atteindre',
        unitLeft: 'g à atteindre',
        secondary: 'kcal',
        plan: ['Fibres ≥ 30 g par jour · satiété et digestion', 'Le reste suit les repères OMS et EFSA'],
        voice: 'Encore 8 g à trouver côté fibres. Pense légumineuses et fruits entiers.',
      },
    } satisfies Record<GoalId, unknown>,
  },
  features: {
    kicker: 'Au quotidien',
    title: 'Des envies au bilan de la semaine.',
    craving: {
      title: 'J’ai une envie.',
      body: "Un bouton pour le moment critique : un conseil tout de suite et une alternative. Les envies que tu surmontes sont comptées, sans culpabilité.",
      what: 'Envie de',
      choice: 'Chocolat · forte',
      tipLabel: 'Aide-moi',
      tip: 'Bois un grand verre d’eau, puis sors marcher 5 minutes : l’envie retombe souvent en 10 minutes.',
      altLabel: 'Alternative',
      alt: 'Un carré de chocolat noir 85 % et une poignée d’amandes.',
      resisted: 'J’ai tenu 💪',
      gaveIn: 'J’ai craqué',
      celebrate: 'Envie surmontée',
      celebrateBody: 'Chaque fois compte. Ton cerveau apprend.',
      screenAlt: "L'écran « J'ai une envie » avec un conseil et une alternative",
    },
    trends: {
      title: 'D’où vient ton sucre, et à quelle heure.',
      body: "Les Tendances montrent tes vraies sources, du café sucré au yaourt aux fruits, et l'heure où ça arrive. Le réflexe de 16 h devient visible.",
      chartLabel: 'Sucres ajoutés par heure, sur 7 jours',
      sources: 'D’où ça vient',
      items: [
        { name: 'Café sucré', count: '×9', grams: 16 },
        { name: 'Yaourt aux fruits', count: '×4', grams: 11 },
        { name: 'Biscuits', count: '×3', grams: 7 },
      ],
      screenAlt: "L'écran Tendances : les sources de sucres ajoutés",
    },
    coach: {
      title: 'Un coach qui connaît ta journée.',
      body: "Il sait ce que tu vises et ce que tu as mangé. Ses réponses s'écrivent en direct, et il peut te proposer d'ajuster ton plan. Chaque semaine, un bilan IA : ce qui marche, ce qu'il remarque, quoi essayer.",
      question: 'Pourquoi j’ai envie de sucre l’après-midi ?',
      answer:
        "Ton déjeuner était léger en protéines (12 g) et tes envies arrivent surtout vers 16 h. Ajoute un œuf ou un yaourt nature à midi, et garde un fruit pour 16 h.",
      suggestion: 'Proposition de nouveaux objectifs',
      suggestionBody: 'Ajouter un repère fibres aide à la satiété et réduit les envies de sucre.',
      apply: 'Voir le plan',
      reviewLabel: 'Bilan IA de la semaine',
      review: ['Ce qui marche', 'Ce que je remarque', 'À essayer'],
      screenAlt: 'Le coach répond en direct à une question sur les envies de sucre',
    },
    fix: {
      title: 'Corriger avec l’IA.',
      body: 'Une phrase suffit, et le repas est ré-analysé.',
      example: '« Pas de sucre dans le café, la moitié des frites. »',
    },
    barcode: {
      title: 'Code-barres.',
      body: "Via Open Food Facts. Si l'étiquette n'indique pas les sucres ajoutés, Symbiose les déduit de la liste d'ingrédients.",
    },
    calm: {
      title: 'Sans chiffres de calories.',
      body: 'Une option masque les calories pour te concentrer sur tes repères. Remange un repas récent ou favori en un tap.',
    },
  },
  precision: {
    kicker: 'Précis par construction',
    title: 'L’IA propose, les maths décident.',
    lead: "Une photo seule donne un brouillon : testées sur des repas pesés, des apps photo ont sous-estimé l'énergie d'environ un tiers. Dans Symbiose, aucun chiffre que tu vois ne sort de l'IA sans passer par un calcul déterministe.",
    source: 'Chercheurs du NIH, NUTRITION 2026 (résultats préliminaires)',
    per100: {
      title: 'Tout est stocké pour 100 g.',
      body: 'Change la portion : les valeurs sont recalculées exactement, sans nouvelle estimation.',
      food: 'Yaourt aux fruits',
      portion: 'Portion',
      rows: { kcal: 'Énergie', protein: 'Protéines', carbs: 'Glucides', sugar: 'dont sucres', added: 'dont ajoutés', fat: 'Lipides' },
      nested: 'Sucres ajoutés ⊂ sucres ⊂ glucides',
      atwater: 'Contrôle Atwater',
      atwaterOk: 'cohérent',
    },
    checks: {
      title: 'Des valeurs vérifiées.',
      body: "Bornes physiques, sucres ajoutés ⊂ sucres ⊂ glucides, saturés ⊂ lipides, et un contrôle d'énergie Atwater : si les calories s'écartent des macros de plus de 35 %, elles sont recalculées.",
      items: ['Sucres ajoutés ⊂ sucres ⊂ glucides', 'Saturés ⊂ lipides', 'Énergie ≈ Atwater, à 35 % près'],
    },
    question: {
      title: 'Une question, pas un interrogatoire.',
      body: "Au plus une question par repas, et seulement quand la réponse change vraiment l'estimation.",
      ask: 'Combien de sucres dans le café ?',
      options: ['Aucun', '1 sucre', '2 sucres'],
    },
    targets: {
      title: 'Des cibles calculées, pas devinées.',
      body: "Métabolisme de base (Mifflin-St Jeor), repères OMS et EFSA, puis les règles de ton plan. Avec des garde-fous : déficit ≤ 25 %, jamais sous ton métabolisme de base ni sous 1 200 ou 1 500 kcal.",
      chips: ['Mifflin-St Jeor', 'OMS', 'EFSA', 'Déficit ≤ 25 %', '≥ 1 200 / 1 500 kcal'],
      screenAlt: 'Le plan : énergie par jour, repères et petites habitudes',
    },
  },
  watch: {
    kicker: 'Ta montre',
    title: 'Branché sur Apple Santé et Health Connect.',
    body: 'Pas de compte en plus, pas de cloud tiers : Symbiose lit ce que ta montre envoie déjà à ton téléphone.',
    items: [
      {
        title: 'Pas et énergie active',
        body: 'Ton budget suit ta journée : métabolisme × 1,2 + 80 % de l’énergie active mesurée, car les montres surestiment.',
      },
      {
        title: 'Historique de poids',
        body: 'Ta courbe et sa tendance, avec une balance connectée ou une pesée à la main. Le coach en tient compte.',
      },
      {
        title: 'Repas réécrits dans Santé',
        body: 'Énergie, protéines, glucides, sucres, lipides, fibres et sodium, visibles par tes autres apps.',
      },
    ],
    controlsTitle: 'Bouton Action et Centre de contrôle',
    controlsBody: 'Sur iPhone, deux commandes ouvrent Symbiose au bon endroit.',
    controls: ['Photographier un repas', 'J’ai une envie'],
    controlsList: '« Photographier un repas » et « J’ai une envie ».',
    wipLabel: 'Nouveau',
    wip: "L'activité physique : les séances de ta montre (ou ajoutées en 2 taps), des repères adaptés à ton plan, et une IA qui en tient compte. En option : le suivi de ta tension.",
    compat: 'Apple Watch, Wear OS, Garmin, Fitbit, Samsung, Withings, Oura… tout ce qui se synchronise avec Apple Santé ou Health Connect.',
    screenAlt: "L'historique de poids et sa courbe de tendance dans les Tendances",
    weightLabel: 'Poids · 30 jours',
    weightTrend: '−1,8 kg',
  },
  privacy: {
    kicker: 'Vie privée',
    title: 'Tes données restent chez toi.',
    body: "Symbiose tourne sur ton serveur : une image Docker, un volume. Pas de compte chez nous. D'ailleurs, il n'y a pas de « chez nous ».",
    steps: [
      { title: 'Lance le serveur', body: 'Une commande. Ta clé Anthropic active les photos, les plans, le coach et les bilans.' },
      { title: 'Ouvre sa page', body: 'http://ton-serveur:3000 affiche un QR code.' },
      { title: 'Scanne-le avec l’app', body: '« Scanner le QR du serveur », puis crée ton compte. Le premier compte est administrateur.' },
    ],
    facts: [
      'Une base SQLite et un dossier de photos, dans un seul volume. Sauvegarde-le, c’est tout.',
      'Export de toutes tes données en JSON. Suppression du compte quand tu veux.',
      "Les photos et descriptions de repas ne partent que chez le fournisseur d'IA (Anthropic, Claude), pour l'analyse. Rien d'autre ne quitte ton serveur.",
      'Sans clé API, l’app reste utilisable : codes-barres, saisie manuelle, plan par mots-clés.',
      'Mise à jour : docker pull et redémarrage. Les migrations se font toutes seules.',
    ],
    terminal: 'Terminal',
    copy: 'Copier la commande',
    copied: 'Copié',
    compose: 'Ou avec Compose : docker compose up -d',
    readme: 'Toutes les variables dans le README',
    screenAlt: "L'écran de connexion : adresse du serveur et scan du QR code",
  },
  open: {
    kicker: 'Open source',
    title: 'Le code est à toi aussi.',
    body: 'Licence MIT. Pas d’abonnement, pas de pub, pas de paywall : tu paies seulement ce que tu consommes chez Anthropic.',
    stack: [
      { name: 'Expo · React Native', role: 'L’app iOS et Android' },
      { name: 'Hono · SQLite', role: 'L’API et tes données, en un fichier' },
      { name: 'Claude', role: 'Vision et sorties structurées' },
      { name: 'TypeScript', role: 'Les mêmes maths nutritionnelles côté app et serveur' },
    ],
    github: 'Voir sur GitHub',
    contribute: 'Contribuer',
    architecture: 'Lire l’architecture',
  },
  roadmap: {
    kicker: 'Feuille de route',
    title: 'Où on va.',
    groups: [
      {
        status: 'done',
        label: 'Disponible',
        items: [
          'Repas en photo, texte ou code-barres',
          'Un plan à partir de tes mots',
          'Envies et tendances',
          'Coach en direct et bilan de la semaine',
          'Apple Santé et Health Connect, historique de poids',
          'Commandes iPhone : bouton Action, Centre de contrôle',
          'Activité physique : séances de la montre, repères adaptés à ton plan',
          'Suivi optionnel de la tension, lié à Santé dans les deux sens',
          'Mode gaucher',
        ],
      },
      {
        status: 'wip',
        label: 'En cours',
        items: [
          'Le coach ajoute, corrige ou retire un repas pour toi, après ta confirmation',
          'App montre : ton chiffre clé en complication, remanger en un tap, dictée au poignet',
          'Widgets et Live Activities',
        ],
      },
      {
        status: 'next',
        label: 'Ensuite',
        items: [
          'File hors ligne pour les repas pris sans réseau',
          'Base CIQUAL (ANSES) et fournisseurs d’IA au choix, modèles locaux compris',
          'Dépense énergétique adaptative, à partir de la tendance du poids',
          'D’autres modules de vie : sommeil, hydratation, entraînement, humeur',
        ],
      },
    ],
  },
  faq: {
    kicker: 'Questions',
    title: 'En bref.',
    items: [
      {
        q: 'C’est gratuit ?',
        a: "Oui. Le code est sous licence MIT et tu héberges le serveur. La seule dépense, c'est ton usage de l'API Anthropic pour l'analyse.",
      },
      {
        q: 'Où télécharger l’app ?',
        a: "Elle n'est pas encore sur l'App Store ni sur le Play Store. Pour l'instant, on la compile depuis le dépôt avec Expo (build de développement, en local ou sur EAS). Les étapes sont dans le README.",
      },
      {
        q: 'Faut-il une clé API ?',
        a: "Pour l'IA, oui : une clé Anthropic. Sans elle, Symbiose reste utilisable avec les codes-barres, la saisie manuelle et un plan établi à partir de mots-clés.",
      },
      {
        q: 'Qui voit mes photos ?',
        a: "Ton serveur, et le fournisseur d'IA le temps de l'analyse. Rien d'autre : pas de traqueur, pas de pub, pas de revente.",
      },
      {
        q: 'Et sans montre ?',
        a: "Tout marche sans. La montre affine ton budget d'énergie et suit ton poids, mais l'app ne bloque jamais dessus.",
      },
      {
        q: 'Plusieurs personnes sur un serveur ?',
        a: 'Oui. Le premier compte est administrateur ; ALLOW_SIGNUP=true ouvre les inscriptions, pour un serveur de famille par exemple.',
      },
      {
        q: 'C’est un dispositif médical ?',
        a: "Non. Les plans sont prudents par construction (planchers caloriques, déficit plafonné). Si tu as une pathologie, si tu es enceinte ou si tu as des antécédents de troubles alimentaires, demande d'abord l'avis d'un professionnel.",
      },
    ],
  },
  footer: {
    title1: 'Mange en conscience,',
    title2: 'pas en comptant.',
    cta: 'Héberger mon serveur',
    github: 'GitHub',
    license: 'Licence MIT',
    architecture: 'Architecture',
    contributing: 'Contribuer',
    top: 'Haut de page',
    disclaimer:
      "Symbiose n'est pas un dispositif médical et ne remplace pas l'avis d'un professionnel de santé.",
    made: 'Open source, fait avec soin.',
  },
};

export type Dict = typeof fr;

const en: Dict = {
  meta: {
    title: 'Symbiose · Eat mindfully, not by counting.',
    description:
      'Symbiose is an open-source, AI-first meal companion. State your goal in your own words, snap your plate: it works out what matters for you, on your own server.',
  },
  nav: {
    skip: 'Skip to content',
    how: 'How it works',
    features: 'Features',
    precision: 'Precision',
    privacy: 'Privacy',
    faq: 'FAQ',
    github: 'GitHub',
    githubLabel: 'Symbiose on GitHub',
    darkMode: 'Dark mode',
    language: 'Language',
    home: 'Symbiose, home',
    primary: 'Main navigation',
  },
  hero: {
    eyebrow: ['Open source', 'Self-hosted', 'MIT licence'],
    title1: 'Eat mindfully,',
    title2: 'not by counting.',
    lead: 'Say what you want to change, in your own words. Snap your meal. Symbiose works out the rest for your goal, on your own server.',
    ctaPrimary: 'Host my server',
    ctaSecondary: 'View the code',
    note: 'No subscription, no ads, no paywall.',
    chipAnalyzing: 'Hunting for hidden sugars…',
    chipRule: 'Added sugar ≤ 25 g a day',
    altLight: 'The Symbiose Today screen, centred on added sugar against a 25 g limit',
    altDark: 'The Trends screen in dark mode: average added sugar and where it comes from',
  },
  facts: [
    { value: '2', label: 'gestures to log a meal' },
    { value: '≤ 1', label: 'question, only when it changes the numbers' },
    { value: '0', label: 'subscriptions, ads or paywalls' },
    { value: '1', label: 'Docker container, your data at home' },
  ],
  how: {
    kicker: 'How it works',
    title: 'Three steps, then you stop thinking about it.',
    steps: [
      {
        title: 'Say what you want to change.',
        body: 'In your own words, not in a form. The AI turns them into a precise plan you can rephrase or adjust.',
        alt: 'Onboarding: the goal written in your own words',
      },
      {
        title: 'Snap, type or scan.',
        body: 'Two gestures. A photo, a sentence (dictation works) or an Open Food Facts barcode. The meal shows up at once while the AI analyses it.',
        alt: 'A meal described in text, ready to be analysed',
      },
      {
        title: 'See what matters to you.',
        body: 'The home screen shows the number for your goal: added sugar if you want to cut sugar, calories if you are working on your weight. Every meal gets one line of feedback, no lecture.',
        alt: 'A meal detail: added sugar, share of the daily limit and a tip',
      },
    ],
    extras: {
      quote: '“I want to cut added sugar, I often eat it by reflex in the afternoon at work.”',
      result: ['Added sugar ≤ 25 g a day, WHO guidance', 'A habit aimed at the afternoon reflex'],
      status: 'Hunting for hidden sugars…',
      feedback: '≈ 8 g of added sugar in this meal.',
      tip: '34 % of your daily limit',
    },
  },
  goals: {
    kicker: 'Driven by your goal',
    title: 'One goal, one screen.',
    body: 'A calorie counter for everyone, whatever they want? Symbiose puts the number that matters to you first, and adapts the tone of its feedback.',
    pick: 'Pick a goal',
    yourWords: 'Your words',
    yourPlan: 'Your plan',
    eaten: 'Eaten',
    caption: 'Sample day, illustrative numbers.',
    options: {
      sugar: {
        label: 'Cut sugar',
        words: '“I want to cut added sugar, I often eat it by reflex.”',
        metric: 'Added sugar',
        limit: 'Stay under',
        unitLeft: 'g left',
        secondary: 'kcal',
        plan: ['Added sugar ≤ 25 g a day · WHO guidance', 'When a craving hits, wait 10 minutes with a glass of water'],
        voice: '7 g of room left on added sugar. You’ve got this.',
      },
      weight: {
        label: 'Lose weight',
        words: '“I want to lose weight gradually, without frustration.”',
        metric: 'Energy',
        limit: 'Goal',
        unitLeft: 'kcal left',
        secondary: 'g protein',
        plan: ['15 % deficit, never below your basal metabolism', 'Protein 1.6 g/kg to keep your muscle'],
        voice: '610 kcal to end the day gently.',
      },
      muscle: {
        label: 'Build muscle',
        words: '“I want to build muscle, a clean bulk.”',
        metric: 'Protein',
        limit: 'Reach',
        unitLeft: 'g to go',
        secondary: 'kcal',
        plan: ['10 % surplus, capped at 20 %', 'Protein 1.8 g/kg a day'],
        voice: '44 g of protein still to find. Think eggs, legumes, plain yoghurt.',
      },
      fiber: {
        label: 'More fibre',
        words: '“I want to eat more fibre.”',
        metric: 'Fibre',
        limit: 'Reach',
        unitLeft: 'g to go',
        secondary: 'kcal',
        plan: ['Fibre ≥ 30 g a day · satiety and digestion', 'Everything else follows WHO and EFSA guidance'],
        voice: '8 g of fibre still to find. Think legumes and whole fruit.',
      },
    },
  },
  features: {
    kicker: 'Day to day',
    title: 'From cravings to your weekly review.',
    craving: {
      title: 'I have a craving.',
      body: 'One button for the critical moment: a tip right now and an alternative. The cravings you ride out are counted, guilt-free.',
      what: 'Craving',
      choice: 'Chocolate · strong',
      tipLabel: 'Help me',
      tip: 'Drink a big glass of water, then walk for 5 minutes: cravings often fade within 10 minutes.',
      altLabel: 'Alternative',
      alt: 'A square of 85 % dark chocolate and a handful of almonds.',
      resisted: 'I held on 💪',
      gaveIn: 'I gave in',
      celebrate: 'Craving beaten',
      celebrateBody: 'Every time counts. Your brain is learning.',
      screenAlt: 'The “I have a craving” screen with a tip and an alternative',
    },
    trends: {
      title: 'Where your sugar comes from, and when.',
      body: 'Trends show your real sources, from sweet coffee to fruit yoghurt, and the hour it happens. The 4 pm reflex becomes visible.',
      chartLabel: 'Added sugar by hour, over 7 days',
      sources: 'Where it comes from',
      items: [
        { name: 'Sweet coffee', count: '×9', grams: 16 },
        { name: 'Fruit yoghurt', count: '×4', grams: 11 },
        { name: 'Biscuits', count: '×3', grams: 7 },
      ],
      screenAlt: 'The Trends screen: where added sugar comes from',
    },
    coach: {
      title: 'A coach that knows your day.',
      body: 'It knows what you aim for and what you ate. Answers stream in live, and it can suggest adjusting your plan. Every week, an AI review: what works, what it notices, what to try.',
      question: 'Why do I crave sugar in the afternoon?',
      answer:
        'Your lunch was light on protein (12 g) and your cravings mostly hit around 4 pm. Add an egg or a plain yoghurt at lunch, and keep a piece of fruit for 4 pm.',
      suggestion: 'Suggested new goals',
      suggestionBody: 'Adding a fibre marker helps satiety and curbs sugar cravings.',
      apply: 'See the plan',
      reviewLabel: 'Weekly AI review',
      review: ['What works', 'What I notice', 'Try next'],
      screenAlt: 'The coach answering live about sugar cravings',
    },
    fix: {
      title: 'Fix with AI.',
      body: 'One sentence is enough, and the meal is re-analysed.',
      example: '“No sugar in the coffee, half the fries.”',
    },
    barcode: {
      title: 'Barcodes.',
      body: 'Through Open Food Facts. When a label doesn’t list added sugar, Symbiose infers it from the ingredients.',
    },
    calm: {
      title: 'No calorie numbers.',
      body: 'One setting hides calories so you can focus on your markers. Re-log a recent or favourite meal in one tap.',
    },
  },
  precision: {
    kicker: 'Precise by design',
    title: 'The AI proposes, the math decides.',
    lead: 'A photo alone is a draft: tested against weighed meals, photo apps underestimated energy by about a third. In Symbiose, no number you see comes from the AI without a deterministic pass.',
    source: 'NIH researchers, NUTRITION 2026 (preliminary results)',
    per100: {
      title: 'Everything is stored per 100 g.',
      body: 'Change the portion and the values are rescaled exactly, with no new guess.',
      food: 'Fruit yoghurt',
      portion: 'Portion',
      rows: { kcal: 'Energy', protein: 'Protein', carbs: 'Carbs', sugar: 'of which sugar', added: 'of which added', fat: 'Fat' },
      nested: 'Added sugar ⊂ sugar ⊂ carbs',
      atwater: 'Atwater check',
      atwaterOk: 'consistent',
    },
    checks: {
      title: 'Checked values.',
      body: 'Physical bounds, added sugar ⊂ sugar ⊂ carbs, saturated ⊂ fat, and an Atwater energy check: when calories are more than 35 % off the macros, they are recomputed.',
      items: ['Added sugar ⊂ sugar ⊂ carbs', 'Saturated ⊂ fat', 'Energy ≈ Atwater, within 35 %'],
    },
    question: {
      title: 'One question, not an interrogation.',
      body: 'At most one question per meal, and only when the answer really changes the estimate.',
      ask: 'How many sugars in the coffee?',
      options: ['None', '1 sugar', '2 sugars'],
    },
    targets: {
      title: 'Targets computed, not guessed.',
      body: 'Basal metabolism (Mifflin-St Jeor), WHO and EFSA guidance, then your plan’s rules. With guard rails: deficit ≤ 25 %, never below your basal metabolism or 1,200 / 1,500 kcal.',
      chips: ['Mifflin-St Jeor', 'WHO', 'EFSA', 'Deficit ≤ 25 %', '≥ 1,200 / 1,500 kcal'],
      screenAlt: 'The plan: daily energy, markers and small habits',
    },
  },
  watch: {
    kicker: 'Your watch',
    title: 'Connected to Apple Health and Health Connect.',
    body: 'No extra account, no third-party cloud: Symbiose reads what your watch already sends to your phone.',
    items: [
      {
        title: 'Steps and active energy',
        body: 'Your budget follows your day: basal metabolism × 1.2 + 80 % of measured active energy, because watches overestimate.',
      },
      {
        title: 'Weight history',
        body: 'Your curve and its trend, from a connected scale or a manual weigh-in. The coach takes it into account.',
      },
      {
        title: 'Meals written back to Health',
        body: 'Energy, protein, carbs, sugar, fat, fibre and sodium, visible to your other apps.',
      },
    ],
    controlsTitle: 'Action Button and Control Center',
    controlsBody: 'On iPhone, two controls open Symbiose right where you need it.',
    controls: ['Photograph a meal', 'I have a craving'],
    controlsList: '“Photograph a meal” and “I have a craving”.',
    wipLabel: 'New',
    wip: 'Physical activity: workouts from your watch (or added in 2 taps), guardrails adapted to your plan, and an AI that takes them into account. Optional: blood pressure tracking.',
    compat: 'Apple Watch, Wear OS, Garmin, Fitbit, Samsung, Withings, Oura… anything that syncs to Apple Health or Health Connect.',
    screenAlt: 'Weight history and its trend line in Trends',
    weightLabel: 'Weight · 30 days',
    weightTrend: '−1.8 kg',
  },
  privacy: {
    kicker: 'Privacy',
    title: 'Your data stays with you.',
    body: 'Symbiose runs on your server: one Docker image, one volume. No account with us. In fact, there is no “us” to hold it.',
    steps: [
      { title: 'Start the server', body: 'One command. Your Anthropic key enables photos, plans, the coach and reviews.' },
      { title: 'Open its page', body: 'http://your-server:3000 shows a QR code.' },
      { title: 'Scan it with the app', body: '“Scan the server QR code”, then create your account. The first account is the admin.' },
    ],
    facts: [
      'One SQLite database and a photos folder, in a single volume. Back it up and you’re done.',
      'Export all your data as JSON. Delete your account whenever you want.',
      'Meal photos and descriptions only go to the AI provider (Anthropic, Claude), for analysis. Nothing else leaves your server.',
      'Without an API key the app still works: barcodes, manual logging, keyword-based plans.',
      'Updating is docker pull and a restart. Migrations run on their own.',
    ],
    terminal: 'Terminal',
    copy: 'Copy the command',
    copied: 'Copied',
    compose: 'Or with Compose: docker compose up -d',
    readme: 'Every variable is in the README',
    screenAlt: 'The sign-in screen: server address and QR code scan',
  },
  open: {
    kicker: 'Open source',
    title: 'The code is yours too.',
    body: 'MIT licence. No subscription, no ads, no paywall: you only pay for what you use at Anthropic.',
    stack: [
      { name: 'Expo · React Native', role: 'The iOS and Android app' },
      { name: 'Hono · SQLite', role: 'The API and your data, in one file' },
      { name: 'Claude', role: 'Vision and structured outputs' },
      { name: 'TypeScript', role: 'The same nutrition math in the app and on the server' },
    ],
    github: 'View on GitHub',
    contribute: 'Contribute',
    architecture: 'Read the architecture',
  },
  roadmap: {
    kicker: 'Roadmap',
    title: 'Where we’re going.',
    groups: [
      {
        status: 'done',
        label: 'Available',
        items: [
          'Meals by photo, text or barcode',
          'A plan from your own words',
          'Cravings and trends',
          'Live coach and weekly review',
          'Apple Health and Health Connect, weight history',
          'iPhone controls: Action Button, Control Center',
          'Physical activity: workouts from your watch, guardrails adapted to your plan',
          'Optional blood pressure tracking, synced both ways with Health',
          'Left-handed mode',
        ],
      },
      {
        status: 'wip',
        label: 'In progress',
        items: [
          'The coach adds, fixes or removes a meal for you, once you confirm',
          'Watch app: your key number as a complication, one-tap re-log, voice logging from the wrist',
          'Widgets and Live Activities',
        ],
      },
      {
        status: 'next',
        label: 'Next',
        items: [
          'Offline queue for meals taken without network',
          'CIQUAL (ANSES) food data and pluggable AI providers, local models included',
          'Adaptive energy expenditure from your weight trend',
          'More life modules: sleep, hydration, training, mood',
        ],
      },
    ],
  },
  faq: {
    kicker: 'Questions',
    title: 'In short.',
    items: [
      {
        q: 'Is it free?',
        a: 'Yes. The code is MIT-licensed and you host the server. Your only cost is your Anthropic API usage for analysis.',
      },
      {
        q: 'Where do I get the app?',
        a: 'It isn’t on the App Store or Play Store yet. For now you build it from the repository with Expo (a development build, locally or on EAS). The steps are in the README.',
      },
      {
        q: 'Do I need an API key?',
        a: 'For the AI, yes: an Anthropic key. Without it, Symbiose still works with barcodes, manual logging and a keyword-based plan.',
      },
      {
        q: 'Who sees my photos?',
        a: 'Your server, and the AI provider while it analyses them. Nobody else: no trackers, no ads, no data resale.',
      },
      {
        q: 'What if I don’t have a watch?',
        a: 'Everything works without one. A watch refines your energy budget and tracks your weight, but the app never depends on it.',
      },
      {
        q: 'Several people on one server?',
        a: 'Yes. The first account is the admin; ALLOW_SIGNUP=true opens sign-ups, for a family server for instance.',
      },
      {
        q: 'Is it a medical device?',
        a: 'No. Plans are conservative by design (calorie floors, capped deficits). If you have a medical condition, are pregnant or have a history of eating disorders, ask a professional first.',
      },
    ],
  },
  footer: {
    title1: 'Eat mindfully,',
    title2: 'not by counting.',
    cta: 'Host my server',
    github: 'GitHub',
    license: 'MIT licence',
    architecture: 'Architecture',
    contributing: 'Contributing',
    top: 'Back to top',
    disclaimer: 'Symbiose is not a medical device and does not replace advice from a health professional.',
    made: 'Open source, made with care.',
  },
};

/**
 * Typographic spaces: French puts a non-breaking space before : ; ? ! and inside
 * « », and no language wants "25" and "g" on two lines.
 */
function typeset<T>(value: T, lang: Lang): T {
  if (typeof value === 'string') {
    let out = value
      .replace(/(\d) (?=(g|kcal|kg|%|min|h|j|am|pm)\b|%|g\/)/g, '$1\u00a0')
      .replace(/(\d) (\d{3})\b/g, '$1\u202f$2')
      .replace(/([≤≥≈×−→]) /g, '$1\u00a0');
    if (lang === 'fr') out = out.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
    return out as T;
  }
  if (Array.isArray(value)) return value.map((item) => typeset(item, lang)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeset(item, lang)])) as T;
  }
  return value;
}

export const dictionaries: Record<Lang, Dict> = { fr: typeset(fr, 'fr'), en: typeset(en, 'en') };

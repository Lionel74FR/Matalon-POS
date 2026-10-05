import { TVA, type Catalogue } from "../types.js";

const { RESTAURATION, NORMAL } = TVA;

/**
 * Carte automne 2026, transcrite du PDF « Charles_Carte_v5 » fourni le 5 octobre 2026.
 * Prix TTC en centimes, service compris. Taux de TVA sur place.
 *
 * Points marqués `aCompleter` : à fournir avant la mise en caisse.
 */
export const CARTE_AUTOMNE_2026: Catalogue = {
  id: "carte-automne-2026",
  nom: "Carte automne 2026",
  source: "Charles_Carte_v5.pdf",
  etablissementId: "moka",
  categories: [
    // ───────────── Boissons ─────────────
    {
      id: "cafes",
      nom: "Cafés",
      rayon: "Boissons",
      articles: [
        { id: "espresso", nom: "Espresso", prixTTC: 250, tauxTVA: RESTAURATION },
        { id: "double-espresso", nom: "Double espresso", prixTTC: 350, tauxTVA: RESTAURATION },
        { id: "cortado", nom: "Cortado", prixTTC: 350, tauxTVA: RESTAURATION },
        { id: "cappuccino", nom: "Cappuccino", prixTTC: 400, tauxTVA: RESTAURATION },
        { id: "flat-white", nom: "Flat white", prixTTC: 450, tauxTVA: RESTAURATION },
        { id: "latte", nom: "Latte", prixTTC: 500, tauxTVA: RESTAURATION },
        { id: "mocaccino", nom: "Mocaccino", prixTTC: 550, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "latte-creations",
      nom: "Latte créations",
      rayon: "Boissons",
      articles: [
        { id: "chai-latte", nom: "Chai latte maison", prixTTC: 500, tauxTVA: RESTAURATION },
        { id: "golden-latte", nom: "Golden latte", prixTTC: 500, tauxTVA: RESTAURATION },
        { id: "matcha-bio", nom: "Matcha BIO", prixTTC: 550, tauxTVA: RESTAURATION },
        { id: "chocolat-chaud", nom: "Chocolat chaud signature", prixTTC: 500, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "thes",
      nom: "Thés & infusions",
      rayon: "Boissons",
      articles: [
        {
          id: "the",
          nom: "Thé / infusion",
          prixTTC: 450,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "earl-grey", nom: "Earl Grey" },
            { id: "gunpowder-bio", nom: "Gunpowder BIO" },
            { id: "rooibos-vanille", nom: "Rooibos vanille" },
            { id: "remede-grand-mere", nom: "Remède de grand-mère" },
          ],
        },
      ],
    },
    {
      id: "bubble-tea",
      nom: "Bubble tea",
      rayon: "Boissons",
      articles: [
        {
          id: "bubble-tea",
          nom: "Bubble tea",
          prixTTC: 650,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "classique", nom: "Classique" },
            { id: "matcha", nom: "Matcha" },
            { id: "taro", nom: "Taro" },
            { id: "fraise", nom: "Fraise" },
          ],
          supplements: [
            { id: "lait-avoine", nom: "Lait d'avoine", prixTTC: 50 },
            { id: "perles-popping", nom: "Perles popping", prixTTC: 50 },
            { id: "sirop-maison", nom: "Sirop maison", prixTTC: 50 },
          ],
        },
      ],
    },
    {
      id: "jus",
      nom: "Jus & boissons fraîches",
      rayon: "Boissons",
      articles: [
        { id: "orange-pressee", nom: "Orange pressée", prixTTC: 500, tauxTVA: RESTAURATION },
        { id: "jus-pomme", nom: "Pomme", prixTTC: 400, tauxTVA: RESTAURATION },
        { id: "carotte-pomme-gingembre", nom: "Carotte-pomme-gingembre", prixTTC: 600, tauxTVA: RESTAURATION },
        { id: "smoothie-du-moment", nom: "Smoothie du moment", prixTTC: 600, tauxTVA: RESTAURATION },
        { id: "limonade-hibiscus", nom: "Limonade hibiscus", prixTTC: 550, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "softs",
      nom: "Softs & eaux",
      rayon: "Boissons",
      articles: [
        {
          id: "coca",
          nom: "Coca-Cola",
          prixTTC: 400,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "original", nom: "Original", libelle: "Coca-Cola" },
            { id: "zero", nom: "Zero", libelle: "Coca zero" },
          ],
        },
        {
          id: "san-pellegrino",
          nom: "San Pellegrino",
          prixTTC: 450,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "limonata", nom: "Limonata" },
            { id: "aranciata", nom: "Aranciata" },
          ],
        },
        { id: "ginger-beer", nom: "Ginger beer Fever-Tree", prixTTC: 450, tauxTVA: RESTAURATION },
        { id: "perrier", nom: "Perrier 25 cl", prixTTC: 350, tauxTVA: RESTAURATION },
        {
          id: "eau-minerale",
          nom: "Eau minérale",
          prixTTC: 350,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "50cl", nom: "50 cl", prixTTC: 350 },
            { id: "100cl", nom: "100 cl", prixTTC: 550 },
          ],
        },
        { id: "sirop-eau", nom: "Sirop à l'eau", prixTTC: 250, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "smoothies-glaces",
      nom: "Smoothies & glacés",
      rayon: "Boissons",
      articles: [
        {
          id: "smoothie",
          nom: "Smoothie",
          prixTTC: 650,
          tauxTVA: RESTAURATION,
          variantes: [
            { id: "tropical", nom: "Tropical" },
            { id: "forest", nom: "Forest" },
            { id: "green", nom: "Green" },
          ],
        },
        { id: "iced-latte", nom: "Iced latte", prixTTC: 550, tauxTVA: RESTAURATION },
        { id: "iced-matcha", nom: "Iced matcha", prixTTC: 550, tauxTVA: RESTAURATION },
      ],
    },

    // ───────────── Bar (18 h — tard) ─────────────
    {
      id: "cocktails-signature",
      nom: "Cocktails signature",
      rayon: "Bar",
      articles: [
        { id: "golden-hour", nom: "Golden Hour", description: "Bourbon, abricot, citron, miel, romarin brûlé", prixTTC: 1300, tauxTVA: NORMAL },
        { id: "disco-sour", nom: "Disco Sour", description: "Patrón Silver, citron vert, hibiscus, blanc d'œuf", prixTTC: 1300, tauxTVA: NORMAL },
        { id: "le-refuge", nom: "Le Refuge", description: "Bombay Sapphire, camomille infusée, citron, tonic", prixTTC: 1300, tauxTVA: NORMAL },
        { id: "cafe-charles", nom: "Café Charles", description: "Grey Goose, liqueur de café, espresso maison", prixTTC: 1300, tauxTVA: NORMAL },
        { id: "perles-rhum", nom: "Perles & Rhum", description: "Bacardí Carta Blanca, fraise, citron vert, perles popping", prixTTC: 1300, tauxTVA: NORMAL },
      ],
    },
    {
      id: "spritz",
      nom: "Spritz",
      rayon: "Bar",
      articles: [
        { id: "charles-spritz", nom: "Charles Spritz St-Germain", description: "St-Germain, prosecco, sureau maison, écorce d'orange", prixTTC: 1100, tauxTVA: NORMAL },
        { id: "martini-fiero-spritz", nom: "Martini Fiero Spritz", prixTTC: 1100, tauxTVA: NORMAL },
        { id: "limoncello-spritz", nom: "Limoncello Spritz", prixTTC: 1100, tauxTVA: NORMAL },
        { id: "martini-bianco-spritz", nom: "Martini Bianco Spritz", prixTTC: 1100, tauxTVA: NORMAL },
        { id: "spritz-aperol", nom: "Spritz Aperol", prixTTC: 1100, tauxTVA: NORMAL },
        { id: "virgin-martini-spritz", nom: "Virgin Martini Spritz", description: "Sans alcool", prixTTC: 900, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "classiques",
      nom: "Les classiques",
      rayon: "Bar",
      articles: [
        { id: "negroni", nom: "Negroni", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "margarita", nom: "Margarita Patrón", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "old-fashioned", nom: "Old Fashioned", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "gin-tonic", nom: "Gin Tonic Bombay", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "mojito", nom: "Mojito Bacardí", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "daiquiri", nom: "Daiquiri Bacardí", prixTTC: 1200, tauxTVA: NORMAL },
        { id: "moscow-mule", nom: "Moscow Mule Grey Goose", prixTTC: 1300, tauxTVA: NORMAL },
      ],
    },
    {
      id: "mocktails",
      nom: "Mocktails",
      rayon: "Bar",
      articles: [
        { id: "sundown", nom: "Sundown", description: "Martini Vibrante, pamplemousse, soda", prixTTC: 900, tauxTVA: RESTAURATION },
        { id: "garden", nom: "Garden", description: "Martini Floréale, tonic, concombre", prixTTC: 900, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "vins",
      nom: "Vins",
      rayon: "Bar",
      articles: [
        {
          id: "vin-verre",
          nom: "Vin au verre 12 cl",
          prixTTC: null,
          tauxTVA: NORMAL,
          fourchette: { min: 600, max: 900 },
          aCompleter: "Liste des 8 vins au verre (3 blancs, 3 rouges, 1 rosé, 1 pétillant) et prix de chacun",
        },
        {
          id: "vin-bouteille",
          nom: "Vin bouteille",
          prixTTC: null,
          tauxTVA: NORMAL,
          fourchette: { min: 2800, max: 6500 },
          aCompleter: "Liste des bouteilles et prix de chacune",
        },
      ],
    },
    {
      id: "bieres",
      nom: "Bières",
      rayon: "Bar",
      articles: [
        {
          id: "funambules-ipa",
          nom: "Funambules Hazy IPA",
          prixTTC: 500,
          tauxTVA: NORMAL,
          variantes: [
            { id: "25cl", nom: "25 cl", prixTTC: 500 },
            { id: "50cl", nom: "50 cl", prixTTC: 850 },
          ],
        },
        {
          id: "blonde-de-la-cour",
          nom: "Blonde de la Cour",
          prixTTC: 450,
          tauxTVA: NORMAL,
          variantes: [
            { id: "25cl", nom: "25 cl", prixTTC: 450 },
            { id: "50cl", nom: "50 cl", prixTTC: 750 },
          ],
        },
        {
          id: "biere-artisanale",
          nom: "Bière artisanale bouteille",
          prixTTC: null,
          tauxTVA: NORMAL,
          fourchette: { min: 550, max: 700 },
          aCompleter: "Liste des bières artisanales en bouteille et prix de chacune",
        },
      ],
    },

    // ───────────── Cuisine (9 h — 15 h) ─────────────
    {
      id: "viennoiseries",
      nom: "Viennoiseries",
      rayon: "Cuisine",
      articles: [
        { id: "croissant", nom: "Croissant pur beurre", prixTTC: 200, tauxTVA: RESTAURATION },
        { id: "pain-au-chocolat", nom: "Pain au chocolat", prixTTC: 220, tauxTVA: RESTAURATION },
        { id: "brioche-tranchee", nom: "Brioche tranchée", prixTTC: 400, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "oeufs",
      nom: "Œufs & egg muffins",
      rayon: "Cuisine",
      articles: [
        { id: "egg-muffin-charles", nom: "Egg muffin Charles", description: "Muffin toasté, œuf poché, bacon grillé, cheddar affiné", prixTTC: 950, tauxTVA: RESTAURATION },
        { id: "egg-muffin-vege", nom: "Egg muffin végétarien", description: "Muffin toasté, œuf poché, avocat, épinards, graines", prixTTC: 850, tauxTVA: RESTAURATION },
        { id: "oeufs-poches-saumon", nom: "Œufs pochés, saumon fumé", description: "Deux œufs pochés, saumon fumé, crème d'aneth, pain de campagne", prixTTC: 1400, tauxTVA: RESTAURATION },
        { id: "oeufs-brouilles", nom: "Œufs brouillés & pain de campagne", description: "Ciboulette, beurre demi-sel", prixTTC: 1100, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "bowls-tartines",
      nom: "Bowls & tartines",
      rayon: "Cuisine",
      articles: [
        { id: "granola-bowl", nom: "Granola bowl", description: "Granola maison, yaourt brassé, fruits du moment, miel d'acacia", prixTTC: 900, tauxTVA: RESTAURATION },
        { id: "avocado-toast", nom: "Avocado toast", description: "Pain de campagne grillé, avocat, graines, citron, fleur de sel", prixTTC: 1100, tauxTVA: RESTAURATION },
        { id: "tartine-ricotta-miel", nom: "Tartine ricotta-miel", prixTTC: 900, tauxTVA: RESTAURATION },
        { id: "tartine-saumon", nom: "Tartine saumon fumé", prixTTC: 1300, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "salades",
      nom: "Salades",
      rayon: "Cuisine",
      articles: [
        { id: "salade-charles", nom: "Salade Charles", description: "Comté affiné, noix, pomme verte, sucrine, vinaigrette au miel", prixTTC: 1400, tauxTVA: RESTAURATION },
        { id: "cesar", nom: "César revisitée", description: "Poulet fermier grillé, sucrine, parmesan, croûtons de focaccia", prixTTC: 1500, tauxTVA: RESTAURATION },
        { id: "salade-du-lac", nom: "Salade du Lac", description: "Truite fumée, avocat, quinoa, aneth, citron", prixTTC: 1600, tauxTVA: RESTAURATION },
        { id: "bowl-vegetal", nom: "Bowl végétal", description: "Céréales, légumes de saison, houmous, graines torréfiées", prixTTC: 1300, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "chauds-midi",
      nom: "Les chauds du midi",
      rayon: "Cuisine",
      articles: [
        { id: "plat-du-jour", nom: "Plat du jour", description: "À l'ardoise", prixTTC: 1500, tauxTVA: RESTAURATION },
        { id: "croque-monsieur", nom: "Croque-monsieur maison", prixTTC: 1100, tauxTVA: RESTAURATION },
        { id: "croque-madame", nom: "Croque-madame", prixTTC: 1300, tauxTVA: RESTAURATION },
        { id: "quiche-du-jour", nom: "Quiche du jour, mesclun", prixTTC: 1200, tauxTVA: RESTAURATION },
        { id: "focaccia-tomate-mozza", nom: "Focaccia tomate-mozza", prixTTC: 800, tauxTVA: RESTAURATION },
        { id: "veloute", nom: "Velouté du moment", prixTTC: 800, tauxTVA: RESTAURATION },
      ],
    },

    // ───────────── Goûter (14 h — tard) ─────────────
    {
      id: "gouter",
      nom: "Le goûter",
      rayon: "Goûter",
      articles: [
        { id: "pain-perdu", nom: "Pain perdu brioché", description: "Caramel beurre salé, chantilly vanille, éclats de noisette", prixTTC: 900, tauxTVA: RESTAURATION },
        { id: "cookie", nom: "Cookie chocolat noir", prixTTC: 350, tauxTVA: RESTAURATION },
        { id: "brownie", nom: "Brownie chocolat-pécan", prixTTC: 450, tauxTVA: RESTAURATION },
        { id: "cheesecake", nom: "Cheesecake citron", prixTTC: 550, tauxTVA: RESTAURATION },
        { id: "carrot-cake", nom: "Carrot cake", prixTTC: 550, tauxTVA: RESTAURATION },
        { id: "banana-bread", nom: "Banana bread", prixTTC: 450, tauxTVA: RESTAURATION },
        { id: "cinnamon-roll", nom: "Cinnamon roll", prixTTC: 450, tauxTVA: RESTAURATION },
        { id: "financier", nom: "Financier amande", prixTTC: 250, tauxTVA: RESTAURATION },
      ],
    },

    // ───────────── À partager ─────────────
    {
      id: "planches",
      nom: "Planches pour deux",
      rayon: "À partager",
      articles: [
        { id: "planche-charles", nom: "Planche Charles", description: "Charcuterie de Savoie, comté affiné, focaccia, olives, pickles maison", prixTTC: 2200, tauxTVA: RESTAURATION },
        { id: "planche-bergere", nom: "Planche Bergère", description: "Trois fromages, confiture maison, noix, pain de campagne", prixTTC: 1800, tauxTVA: RESTAURATION },
        { id: "planche-mer", nom: "Planche Mer", description: "Saumon fumé, truite, terrine de poisson, focaccia, citron", prixTTC: 2400, tauxTVA: RESTAURATION },
      ],
    },
    {
      id: "a-l-unite",
      nom: "À l'unité",
      rayon: "À partager",
      articles: [
        { id: "olives", nom: "Olives marinées maison", prixTTC: 500, tauxTVA: RESTAURATION },
        { id: "houmous-focaccia", nom: "Houmous & focaccia", prixTTC: 700, tauxTVA: RESTAURATION },
        { id: "stracciatella", nom: "Stracciatella, tomate, basilic", prixTTC: 1100, tauxTVA: RESTAURATION },
        { id: "tartare-boeuf", nom: "Tartare de bœuf au couteau", description: "Servi avec ses condiments", prixTTC: 1400, tauxTVA: RESTAURATION },
      ],
    },

    // ───────────── Formules ─────────────
    {
      id: "formules",
      nom: "Formules",
      rayon: "Formules",
      articles: [
        {
          id: "brunch-charles",
          nom: "Brunch Charles",
          description: "9 h — 14 h",
          prixTTC: 1600,
          tauxTVA: RESTAURATION,
          formule: [
            { id: "boisson-chaude", nom: "Boisson chaude", categories: ["cafes", "latte-creations", "thes"] },
            { id: "jus-presse", nom: "Jus pressé", articles: ["orange-pressee", "carotte-pomme-gingembre"] },
            { id: "viennoiserie", nom: "Viennoiserie", categories: ["viennoiseries"] },
            { id: "bowl-tartine", nom: "Bowl ou tartine", categories: ["bowls-tartines"] },
          ],
        },
        {
          id: "french-ptit-dej",
          nom: "French ptit'dej",
          description: "Baguette, beurre & confiture",
          prixTTC: 700,
          tauxTVA: RESTAURATION,
          formule: [{ id: "boisson-chaude", nom: "Boisson chaude", categories: ["cafes", "latte-creations", "thes"] }],
        },
        {
          id: "dejeuner-charles",
          nom: "Déjeuner Charles",
          description: "12 h — 15 h",
          prixTTC: 1900,
          tauxTVA: RESTAURATION,
          formule: [
            { id: "plat", nom: "Plat du jour ou salade", articles: ["plat-du-jour"], categories: ["salades"] },
            { id: "dessert", nom: "Dessert de la vitrine", categories: ["gouter"] },
            { id: "boisson-chaude", nom: "Boisson chaude", categories: ["cafes", "latte-creations", "thes"] },
          ],
        },
        {
          id: "afternoon-tea",
          nom: "Afternoon Tea",
          prixTTC: 1400,
          tauxTVA: RESTAURATION,
          formule: [
            { id: "the", nom: "Thé d'exception", categories: ["thes"] },
            { id: "boisson-fraiche", nom: "Boisson fraîche", categories: ["jus", "softs"] },
            { id: "mignardise-1", nom: "Mignardise 1", categories: ["gouter"] },
            { id: "mignardise-2", nom: "Mignardise 2", categories: ["gouter"] },
            { id: "mignardise-3", nom: "Mignardise 3", categories: ["gouter"] },
          ],
        },
      ],
    },

    // ───────────── Ateliers ─────────────
    {
      id: "ateliers",
      nom: "Ateliers",
      rayon: "Ateliers",
      articles: [
        {
          id: "atelier-cocktails",
          nom: "Atelier Cocktails (par personne)",
          description: "Format 2 h, 6 à 8 personnes",
          prixTTC: 7000,
          tauxTVA: NORMAL,
          aCompleter: "Taux de TVA à valider avec Audrex (prestation incluant de l'alcool : 20 % retenu par défaut)",
        },
      ],
    },
  ],
};

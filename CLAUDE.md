# Consignes pour Claude

## En début de session, avant toute modification

1. Lire `docs/avancement.md` : état des lots, décisions à ne pas défaire, actions en attente.
2. Lire `docs/cahier-des-charges.md` en entier, et le relire à chaque étape. C'est une copie : le document Claude Docs (lien en tête du fichier) fait foi.
3. Ne pas commencer un lot ni proposer le suivant tant que le précédent n'est pas terminé.
4. Mettre `docs/avancement.md` à jour dans le commit qui fait avancer un lot.

## Règles du code

- Langue du code métier, des commentaires et des messages : français.
- `packages/noyau-fiscal` est sous attestation ISCA. Avant toute modification : expliquer le besoin, ajouter un test de non-régression, incrémenter `VERSION_NOYAU_FISCAL` dans `src/version.ts`. Ne jamais ajouter de méthode qui modifie ou supprime un enregistrement, ni de champ technique dans un enregistrement scellé.
- Les applications ne créent d'enregistrement fiscal que via `Registre`.
- Montants : entiers en centimes, jamais de flottants.
- Lancer `pnpm typecheck && pnpm test` avant chaque commit.

# Consignes pour Claude

- Langue du code métier, des commentaires et des messages : français.
- `packages/noyau-fiscal` est sous attestation ISCA. Avant toute modification : expliquer le besoin, ajouter un test de non-régression, incrémenter `VERSION_NOYAU_FISCAL` dans `src/version.ts`. Ne jamais ajouter de méthode qui modifie ou supprime un enregistrement, ni de champ technique dans un enregistrement scellé.
- Les applications ne créent d'enregistrement fiscal que via `Registre`.
- Montants : entiers en centimes, jamais de flottants.
- Lancer `pnpm typecheck && pnpm test` avant chaque commit.

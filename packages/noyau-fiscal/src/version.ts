/**
 * Version du noyau fiscal.
 *
 * Elle figure sur chaque ticket, chaque événement, chaque clôture et dans
 * l'attestation individuelle de l'éditeur (proIA Conseil, modèle
 * BOI-LETTRE-000242). Toute modification du code de ce paquet impose :
 *   1. d'incrémenter cette version,
 *   2. de tagger le dépôt `noyau-fiscal-v<version>` (GitHub refuse « @ » depuis le navigateur),
 *   3. de mettre l'attestation à jour.
 *
 * Versions 0.x : développement, avant attestation. La 1.0.0 sera la première
 * version attestée, mise en service au Moka.
 */
export const VERSION_NOYAU_FISCAL = "0.6.0";

export const NOM_LOGICIEL = "Matalon POS";

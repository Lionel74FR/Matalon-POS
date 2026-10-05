/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" sur le déploiement de test (préversion Vercel). */
  readonly VITE_MODE_TEST?: string;
}

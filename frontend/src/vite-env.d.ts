/// <reference types="vite/client" />

declare module '*.svg' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_AUTH_CLIENT_ID: string;
  readonly VITE_AUTH_AUTHORITY: string;
  readonly VITE_API_SCOPE: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_DEV_AUTH_BYPASS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

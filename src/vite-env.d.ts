/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Hash del commit del build (estampado por vite.config.ts). */
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'qrcode' {
  const QRCode: {
    toDataURL(text: string, options?: any): Promise<string>;
  };
  export default QRCode;
}


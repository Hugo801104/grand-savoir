// Configuration lue au moment du build (aucun secret ici : la clé « publishable » est publique par conception).
export const APP_VERSION: string = __APP_VERSION__;
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
export const hasBackend = (): boolean => !!SUPABASE_URL && !!SUPABASE_KEY;

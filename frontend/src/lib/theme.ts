export const THEME_STORAGE_KEY = "tatar-upload:theme";
export type Theme = "dark" | "light";

/** Inline <head> script: applies the saved theme before first paint. Dark by default. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

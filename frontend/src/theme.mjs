export const palettes = ['blue', 'iris', 'clay', 'graphite'];
const validMode = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
const validPalette = value => palettes.includes(value) ? value : 'blue';
// Preserve the original mode enum/key. Palette is an independent local preference.
export function createTheme({storage, media, apply}) {
 let id = null, preference = 'system', palette = 'blue';
 const key = () => id === null ? 'norns.theme.anonymous' : `norns.theme.user.${id}`;
 const paletteKey = () => key() + '.palette';
 const read = k => {try {return storage?.getItem(k)} catch {return null}};
 const save = (k, value) => {try {storage?.setItem(k, value)} catch { /* in-memory selection remains usable */ }};
 const render = () => apply(preference === 'system' ? (media.matches ? 'dark' : 'light') : preference, preference, palette);
 function load() {preference = validMode(read(key())); palette = validPalette(read(paletteKey())); render()}
 const change = () => {if (preference === 'system') render()};
 media.addEventListener('change', change); load();
 return {
  identity(value) {id = value; load()},
  set(value) {preference = validMode(value); save(key(), preference); render()},
  setPalette(value) {palette = validPalette(value); save(paletteKey(), palette); render()},
  external(k, v) {
   if (k === null) load();
   else if (k === key()) {preference = validMode(v); render()}
   else if (k === paletteKey()) {palette = validPalette(v); render()}
  },
  stop() {media.removeEventListener('change', change)}
 };
}

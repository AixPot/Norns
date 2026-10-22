// Development-only asset generation. Requires ImageMagick `convert`; no runtime dependency.
// Geometry masters: public/brand/norns-{b2,c2}.svg, traced from the approved raster.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pub=path.join(root,'public'),dir=path.join(pub,'brand'),css=fs.readFileSync(path.join(root,'src/style.css'),'utf8');
function tokens(selector){const match=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(m=>m[1].trim()===selector);if(!match)throw Error('Missing palette '+selector);return Object.fromEntries([...match[2].matchAll(/(--[\w-]+):([^;{}]+)/g)].map(m=>[m[1],m[2].trim()]))}
const defaults=tokens(':root');
for(const palette of ['blue','iris','clay','graphite']){
 const light={...defaults,...(palette==='blue'?{}:tokens(`:root[data-palette="${palette}"]`))};
 for(const mode of ['light','dark']){
  const colors={ink:mode==='light'?light['--accent']:light['--selection'],thread:mode==='light'?light['--selection']:light['--accent'],face:mode==='light'?'#ffffff':light['--selection-text']};if(palette==='graphite'){colors[mode==='light'?'thread':'ink']=defaults['--selection'];if(mode==='dark')colors.thread=tokens(':root[data-theme="dark"]')['--border-strong']}
  for(const name of ['b2','c2']){
   let svg=fs.readFileSync(path.join(dir,`norns-${name}.svg`),'utf8');
   for(const [role,color] of Object.entries(colors))svg=svg.replaceAll(new RegExp(`var\\(--brand-${role},#[0-9a-f]+\\)`,'g'),color);
   fs.writeFileSync(path.join(dir,`${name}-${palette}-${mode}.svg`),svg);
   if(name==='b2'){
    const favicon=path.join(dir,`favicon-${palette}-${mode}.svg`);fs.writeFileSync(favicon,svg.replace('viewBox="0 0 270 230"','viewBox="-15 -35 300 300"'));
    for(const size of [16,32,180])execFileSync('convert',['-background','none',favicon,'-resize',`${size}x${size}`,path.join(dir,`favicon-${palette}-${mode}-${size}.png`)]);
   }
  }
 }
}
const master=fs.readFileSync(path.join(dir,'norns-b2.svg'),'utf8'),body=master.slice(master.indexOf('>')+1,master.lastIndexOf('</svg>'));
fs.writeFileSync(path.join(root,'src/BrandMark.svelte'),'<script lang="ts">\n let {size=28}: {size?:number} = $props();\n</script>\n<svg class="norns-logo" width={size} height={size} viewBox="0 0 270 230" aria-hidden="true" focusable="false">'+body+'</svg>\n');
execFileSync('convert',[path.join(dir,'favicon-blue-light-16.png'),path.join(dir,'favicon-blue-light-32.png'),path.join(pub,'favicon.ico')]);fs.copyFileSync(path.join(dir,'favicon-blue-light-180.png'),path.join(pub,'apple-touch-icon.png'));
console.log('Regenerated B2/C2 palette variants, BrandMark, favicon and touch icon from canonical geometry.');

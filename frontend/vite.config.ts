import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import {onlinePwa} from './pwa-build.mjs';
export default defineConfig({plugins:[svelte(),onlinePwa()],build:{outDir:'dist'}});

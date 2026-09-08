import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import thirdPartyLicenses from './scripts/third-party-licenses.mjs';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [vinext(), thirdPartyLicenses()],
});

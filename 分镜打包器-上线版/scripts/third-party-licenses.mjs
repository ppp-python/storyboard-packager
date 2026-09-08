import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

/** Include the complete licenses of packages actually bundled into each output. */
export default function thirdPartyLicenses() {
  let projectRoot = process.cwd();
  return {
    configResolved(config) { projectRoot = config.root; },
    name: 'third-party-license-texts',
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const normalised = id.replaceAll('\\', '/').split('?')[0];
          const marker = normalised.lastIndexOf('/node_modules/');
          if (marker < 0 || normalised.startsWith('\0')) continue;
          const parts = normalised.slice(marker + 14).split('/');
          const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
          const directory = normalised.slice(0, marker + 14) + name;
          const metadataFile = path.join(directory, 'package.json');
          if (!existsSync(metadataFile)) continue;
          const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
          if (packages.has(metadata.name)) continue;
          const texts = readdirSync(directory).filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file));
          const fallback = metadata.name === '@vitejs/plugin-rsc'
            ? path.join(projectRoot, 'licenses', 'vite-plugin-rsc.txt') : null;
          if (!texts.length && !fallback) throw new Error(`缺少第三方许可原文：${metadata.name}`);
          const licenseText = texts.length
            ? texts.map(file => readFileSync(path.join(directory, file), 'utf8')).join('\n\n')
            : readFileSync(fallback, 'utf8');
          packages.set(metadata.name, `${metadata.name} ${metadata.version}\n` + licenseText);
        }
      }
      this.emitFile({type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source:
        '本文件收录本次静态打包实际包含的第三方软件许可原文。\n\n' +
        [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n----------------------------------------\n\n')});
    },
  };
}

import {spawnSync} from 'node:child_process';
import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = realpathSync(path.resolve(path.dirname(script), '..'));
function localPath(relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || (existsSync(target) && lstatSync(target).isSymbolicLink())) {
    throw new Error('构建目录无效，已停止清理');
  }
  return target;
}
function remove(relative) { rmSync(localPath(relative), {recursive: true, force: true}); }

if (process.argv.includes('--build-worker')) {
  process.argv = [process.execPath, script, 'build'];
  const nativeExit = process.exit;
  let requestedExit;
  const finished = new Promise(resolve => { requestedExit = resolve; });
  process.exit = (code = 0) => { process.exitCode = code; requestedExit(code); };
  try {
    await import(new URL('./cli.js', import.meta.resolve('vinext')).href);
    await finished;
    await new Promise(resolve => setTimeout(resolve, 250));
  } finally { process.exit = nativeExit; }
} else {
  const dist = localPath('dist');
  const backup = localPath('.release-previous-dist');
  if (existsSync(backup)) throw new Error('已有待恢复的构建备份，请先处理');
  const hadDist = existsSync(dist);
  if (hadDist) renameSync(dist, backup);
  try {
    const child = spawnSync(process.execPath, [script, '--build-worker'], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    if (child.error || child.status !== 0) throw new Error('生产构建失败');
    if (!existsSync(localPath('dist/client/index.html'))) throw new Error('缺少静态首页');
    remove('dist/server');
    remove('.next');
    remove('.vinext');
    const metadata = ['.vite', 'vinext-client-entry-manifest.json'];
    const pending = [localPath('dist/client')];
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('静态成品不能包含链接');
        if (entry.isDirectory()) { if (entry.name !== '.vite') pending.push(file); continue; }
        if (entry.name.endsWith('.map')) throw new Error('静态成品不能包含源码映射');
        if (/\.(js|html|rsc)$/.test(entry.name)) {
          const content = readFileSync(file, 'utf8');
          if (metadata.some(name => content.includes(name))) throw new Error('静态页面仍依赖构建映射，已停止清理');
        }
      }
    }
    for (const name of metadata) remove('dist/client/' + name);
    if (readdirSync(dist).some(name => name !== 'client')) throw new Error('构建存在多余输出');
    if (hadDist) remove('.release-previous-dist');
    console.log('构建完成：仅保留 dist/client 静态成品。');
  } catch (error) {
    remove('dist');
    if (hadDist && existsSync(backup)) renameSync(backup, dist);
    throw error;
  }
}

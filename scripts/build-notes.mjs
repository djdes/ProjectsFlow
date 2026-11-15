// Сборка приложения «ProjectsFlow Заметки» (desktop/notes) и выкладка в client/dist/downloads:
//   ProjectsFlowNotes.exe — то, что скачивают со страницы /desktop-notes;
//   notes-version.txt     — по нему установленные приложения узнают об обновлении.
// Запускать ПОСЛЕ build:client — Vite очищает client/dist. Нужен .NET SDK (в CI — setup-dotnet).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'desktop', 'notes', 'ProjectsFlowNotes.csproj');
const out = join(root, '.notes-build');
const downloads = join(root, 'client', 'dist', 'downloads');

const version = /<Version>([^<]+)<\/Version>/.exec(readFileSync(project, 'utf8'))?.[1];
if (!version) throw new Error('Version not found in ProjectsFlowNotes.csproj');

rmSync(out, { recursive: true, force: true });
execFileSync('dotnet', ['build', project, '-c', 'Release', '-o', out, '--nologo'], { stdio: 'inherit' });

mkdirSync(downloads, { recursive: true });
copyFileSync(join(out, 'ProjectsFlowNotes.exe'), join(downloads, 'ProjectsFlowNotes.exe'));
writeFileSync(join(downloads, 'notes-version.txt'), `${version}\n`);
rmSync(out, { recursive: true, force: true });
console.log(`notes ${version} -> client/dist/downloads`);

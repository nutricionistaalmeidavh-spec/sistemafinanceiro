import fs from 'node:fs';

function replaceOnce(file, before, after) {
  const current = fs.readFileSync(file, 'utf8');
  if (!current.includes(before)) throw new Error(`Patch anchor not found in ${file}`);
  fs.writeFileSync(file, current.replace(before, after), 'utf8');
}

replaceOnce('electron/services/workspace-service.cjs', `  async function importFiles(targetPath, sourcePaths = []) {
    requireDirectory(targetPath);
    const imported = [];
    for (const sourceValue of sourcePaths) {
      const source = path.resolve(String(sourceValue || ''));
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
      const destination = uniqueDestination(targetPath, path.basename(source));
      fs.copyFileSync(source, destination.full, fs.constants.COPYFILE_EXCL);
      imported.push(fileInfo(destination.full, destination.rel));
    }
    return imported;
  }
`, `  async function importFiles(targetPath, sourcePaths = []) {
    requireDirectory(targetPath);
    const imported = [];
    for (const sourceValue of sourcePaths) {
      const source = path.resolve(String(sourceValue || ''));
      if (!sourceValue || !fs.existsSync(source)) continue;
      if (source === root || source.startsWith(\`${root}\${path.sep}\`)) continue;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) continue;
      const destination = uniqueDestination(targetPath, path.basename(source));
      if (stat.isDirectory()) {
        fs.cpSync(source, destination.full, {
          recursive: true,
          errorOnExist: true,
          force: false,
          filter: (entry) => !fs.lstatSync(entry).isSymbolicLink(),
        });
      } else {
        fs.copyFileSync(source, destination.full, fs.constants.COPYFILE_EXCL);
      }
      imported.push(fileInfo(destination.full, destination.rel));
    }
    return imported;
  }
`);

replaceOnce('electron/preload.cjs', `const { contextBridge, ipcRenderer } = require('electron');`, `const { contextBridge, ipcRenderer, webUtils } = require('electron');`);
replaceOnce('electron/preload.cjs', `    importFiles: (token, targetPath) => ipcRenderer.invoke('workspace:import-select', token, targetPath),`, `    importFiles: (token, targetPath) => ipcRenderer.invoke('workspace:import-select', token, targetPath),
    importDropped: (token, targetPath, files) => {
      const sourcePaths = Array.from(files || []).map((file) => webUtils.getPathForFile(file)).filter(Boolean);
      return ipcRenderer.invoke('workspace:import-paths', token, targetPath, sourcePaths);
    },`);

replaceOnce('electron/ipc-handlers.cjs', `  ipcMain.handle('workspace:create-file', (_event, token, parentPath, name, content) => { auth.require(token, 'finance.manage'); return workspace.createFile(parentPath || '', name, content || ''); });
  ipcMain.handle('workspace:rename',`, `  ipcMain.handle('workspace:create-file', (_event, token, parentPath, name, content) => { auth.require(token, 'finance.manage'); return workspace.createFile(parentPath || '', name, content || ''); });
  ipcMain.handle('workspace:import-paths', (_event, token, targetPath, sourcePaths) => {
    auth.require(token, 'finance.manage');
    if (!Array.isArray(sourcePaths)) throw new TypeError('sourcePaths must be an array');
    const paths = sourcePaths.filter((value) => typeof value === 'string' && value.trim()).slice(0, 200);
    return workspace.importFiles(targetPath || '', paths);
  });
  ipcMain.handle('workspace:rename',`);

replaceOnce('src/pages/WorkspacePage.tsx', `import { type DragEvent, type FormEvent, type MouseEvent, useEffect, useMemo, useState } from 'react';`, `import { type DragEvent, type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';`);
replaceOnce('src/pages/WorkspacePage.tsx', `  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);`, `  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [externalDropActive, setExternalDropActive] = useState(false);
  const externalDragDepth = useRef(0);`);

replaceOnce('src/pages/WorkspacePage.tsx', `  function dropOnFolder(event: DragEvent, folderPath: string) {
    if (!canManage) return;
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData('application/x-artisys-workspace-path');
    if (!sourcePath || sourcePath === folderPath) return;
    const source = items.find((item) => item.path === sourcePath) || searchResults?.find((item) => item.path === sourcePath);
    if (source) void moveItem(source, folderPath);
  }
`, `  function hasExternalFiles(event: DragEvent) {
    const types = Array.from(event.dataTransfer.types || []);
    return types.includes('Files') && !types.includes('application/x-artisys-workspace-path');
  }

  async function importDropped(event: DragEvent, targetPath = currentPath) {
    if (!canManage || mode !== 'files') return;
    event.preventDefault();
    event.stopPropagation();
    externalDragDepth.current = 0;
    setExternalDropActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    setError('');
    try {
      await api.importDropped(token, targetPath, files);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function handleExternalDragEnter(event: DragEvent) {
    if (!canManage || mode !== 'files' || !hasExternalFiles(event)) return;
    event.preventDefault();
    externalDragDepth.current += 1;
    setExternalDropActive(true);
  }

  function handleExternalDragOver(event: DragEvent) {
    if (!canManage || mode !== 'files' || !hasExternalFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setExternalDropActive(true);
  }

  function handleExternalDragLeave(event: DragEvent) {
    if (!externalDropActive) return;
    event.preventDefault();
    externalDragDepth.current = Math.max(0, externalDragDepth.current - 1);
    if (externalDragDepth.current === 0) setExternalDropActive(false);
  }

  function dropOnFolder(event: DragEvent, folderPath: string) {
    if (!canManage) return;
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = event.dataTransfer.getData('application/x-artisys-workspace-path');
    if (sourcePath) {
      if (sourcePath === folderPath) return;
      const source = items.find((item) => item.path === sourcePath) || searchResults?.find((item) => item.path === sourcePath);
      if (source) void moveItem(source, folderPath);
      return;
    }
    if (event.dataTransfer.files?.length) void importDropped(event, folderPath);
  }
`);

replaceOnce('src/pages/WorkspacePage.tsx', `      <div className="workspace-main">`, `      <div
        className={\`workspace-main \${externalDropActive ? 'external-drop-active' : ''}\`}
        onDragEnter={handleExternalDragEnter}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={(event) => { if (hasExternalFiles(event)) void importDropped(event, currentPath); }}
      >
        {externalDropActive && canManage && mode === 'files' && <div className="workspace-drop-overlay" data-testid="workspace-external-drop-overlay"><Upload size={34}/><strong>Solte para adicionar</strong><span>Arquivos e pastas serão copiados para esta pasta do Workspace.</span></div>}`);

replaceOnce('src/vite-env.d.ts', `importFiles(token:string,targetPath:string):Promise<{canceled:boolean;items:WorkspaceItem[]}>; rename`, `importFiles(token:string,targetPath:string):Promise<{canceled:boolean;items:WorkspaceItem[]}>; importDropped(token:string,targetPath:string,files:File[]):Promise<WorkspaceItem[]>; rename`);

const cssFile = 'src/workspace.css';
const css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('workspace-drop-overlay')) {
  fs.appendFileSync(cssFile, `

/* External Windows drag-and-drop */
.workspace-main { position: relative; }
.workspace-main.external-drop-active { outline: 2px dashed var(--primary, #2563eb); outline-offset: -6px; }
.workspace-drop-overlay { position: absolute; inset: 8px; z-index: 30; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 2px dashed currentColor; border-radius: 12px; background: color-mix(in srgb, Canvas 94%, transparent); color: inherit; pointer-events: none; text-align: center; }
.workspace-drop-overlay strong { font-size: 1rem; }
.workspace-drop-overlay span { max-width: 440px; font-size: .86rem; opacity: .72; }
`, 'utf8');
}

console.log('Workspace external drag-and-drop patch applied.');

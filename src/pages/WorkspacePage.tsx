import { type DragEvent, type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  Move,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { can } from '../lib/format';

type WorkspacePageProps = { token: string; session: FinanceiroSession };
type ViewMode = 'list' | 'grid';
type SortBy = 'name' | 'modifiedAt' | 'size' | 'type';
type SortDirection = 'asc' | 'desc';

type WorkspaceItem = {
  name: string;
  path: string;
  parentPath: string;
  type: 'folder' | 'file';
  extension: string;
  size: number;
  modifiedAt: string;
  createdAt: string;
};

type WorkspaceTreeNode = { name: string; path: string; children: WorkspaceTreeNode[] };
type TrashItem = { id: string; name: string; originalPath: string; deletedAt: string; type: 'folder' | 'file' };
type Preferences = { viewMode: ViewMode; sortBy: SortBy; sortDirection: SortDirection };
type ContextMenu = { x: number; y: number; item: WorkspaceItem } | null;

const DEFAULT_PREFS: Preferences = { viewMode: 'list', sortBy: 'name', sortDirection: 'asc' };

function formatSize(bytes: number) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function iconFor(item: WorkspaceItem, size = 20) {
  return item.type === 'folder' ? <Folder size={size} aria-hidden="true"/> : <File size={size} aria-hidden="true"/>;
}

export default function WorkspacePage({ token, session }: WorkspacePageProps) {
  const api = window.financeiro!.workspace;
  const canManage = can(session, 'finance.manage');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [tree, setTree] = useState<WorkspaceTreeNode | null>(null);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [mode, setMode] = useState<'files' | 'trash'>('files');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceItem[] | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [externalDropActive, setExternalDropActive] = useState(false);
  const externalDragDepth = useRef(0);

  async function loadTree() {
    setTree(await api.tree(token));
  }

  async function loadCurrent() {
    const listing = await api.list(token, currentPath);
    setItems(listing.items);
  }

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      if (mode === 'trash') setTrash(await api.listTrash(token));
      else await loadCurrent();
      const [nextTree, nextPrefs] = await Promise.all([api.tree(token), api.preferences(token)]);
      setTree(nextTree);
      setPrefs(nextPrefs);
      if (query.trim()) setSearchResults(await api.search(token, query.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentPath, mode]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  function navigate(nextPath: string) {
    setMode('files');
    setSearchResults(null);
    setQuery('');
    setHistory((previous) => [...previous.slice(0, historyIndex + 1), nextPath]);
    setHistoryIndex((index) => index + 1);
    setCurrentPath(nextPath);
  }

  function goBack() {
    if (historyIndex <= 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    setCurrentPath(history[next]);
    setMode('files');
    setSearchResults(null);
  }

  function goForward() {
    if (historyIndex >= history.length - 1) return;
    const next = historyIndex + 1;
    setHistoryIndex(next);
    setCurrentPath(history[next]);
    setMode('files');
    setSearchResults(null);
  }

  async function createFolder() {
    const name = window.prompt('Nome da nova pasta:');
    if (!name) return;
    await api.createFolder(token, currentPath, name);
    await refresh();
  }

  async function createFile() {
    const name = window.prompt('Nome do novo arquivo:', 'Novo arquivo.txt');
    if (!name) return;
    await api.createFile(token, currentPath, name, '');
    await refresh();
  }

  async function importFiles() {
    await api.importFiles(token, currentPath);
    await refresh();
  }

  async function renameItem(item: WorkspaceItem) {
    const name = window.prompt('Novo nome:', item.name);
    if (!name || name === item.name) return;
    await api.rename(token, item.path, name);
    await refresh();
  }

  async function moveItem(item: WorkspaceItem, targetOverride?: string) {
    const target = targetOverride ?? window.prompt('Mover para qual pasta? Deixe vazio para a raiz.', item.parentPath);
    if (target === null) return;
    await api.move(token, item.path, target);
    await refresh();
  }

  async function copyItem(item: WorkspaceItem) {
    const target = window.prompt('Copiar para qual pasta? Deixe vazio para a raiz.', item.parentPath);
    if (target === null) return;
    await api.copy(token, item.path, target);
    await refresh();
  }

  async function trashItem(item: WorkspaceItem) {
    if (!window.confirm(`Mover “${item.name}” para a lixeira?`)) return;
    await api.trash(token, item.path);
    await refresh();
  }

  async function restoreItem(item: TrashItem) {
    await api.restore(token, item.id);
    await refresh();
  }

  async function deleteForever(item: TrashItem) {
    if (!window.confirm(`Excluir “${item.name}” permanentemente? Esta ação não pode ser desfeita.`)) return;
    await api.deleteForever(token, item.id);
    await refresh();
  }

  async function savePreferences(next: Partial<Preferences>) {
    const saved = await api.setPreferences(token, next);
    setPrefs(saved);
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) { setSearchResults(null); return; }
    setSearchResults(await api.search(token, trimmed));
  }

  function openItem(item: WorkspaceItem) {
    if (item.type === 'folder') navigate(item.path);
    else void api.open(token, item.path);
  }

  function startDrag(event: DragEvent, item: WorkspaceItem) {
    if (!canManage) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-artisys-workspace-path', item.path);
  }

  function hasExternalFiles(event: DragEvent) {
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

  function showContext(event: MouseEvent, item: WorkspaceItem) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, item });
  }

  const visibleItems = useMemo(() => {
    const source = searchResults ?? items;
    return [...source].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      let result = 0;
      if (prefs.sortBy === 'size') result = a.size - b.size;
      else if (prefs.sortBy === 'modifiedAt') result = a.modifiedAt.localeCompare(b.modifiedAt);
      else if (prefs.sortBy === 'type') result = (a.extension || a.type).localeCompare(b.extension || b.type, 'pt-BR');
      else result = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      return prefs.sortDirection === 'desc' ? -result : result;
    });
  }, [items, searchResults, prefs]);

  const crumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    return [{ name: 'Workspace', path: '' }, ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }))];
  }, [currentPath]);

  function TreeNode({ node, depth = 0 }: { node: WorkspaceTreeNode; depth?: number }) {
    const active = mode === 'files' && node.path === currentPath;
    return <div className="workspace-tree-node">
      <button
        type="button"
        className={active ? 'active' : ''}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => navigate(node.path)}
        onDragOver={(event) => canManage && event.preventDefault()}
        onDrop={(event) => dropOnFolder(event, node.path)}
      >
        {node.path ? <Folder size={16}/> : <Home size={16}/>}<span>{node.name}</span>
      </button>
      {node.children.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1}/>)}
    </div>;
  }

  return <section className="workspace-page" data-testid="workspace-page">
    <div className="page-heading workspace-heading">
      <div><p className="eyebrow">Arquivos pessoais</p><h1>Workspace</h1><p className="muted">Organize documentos, comprovantes, planilhas e outros arquivos em pastas locais.</p></div>
      <div className="workspace-heading-actions">
        <button type="button" className="secondary-button" onClick={() => void refresh()} title="Atualizar"><RefreshCw size={17}/> Atualizar</button>
        {canManage && <button type="button" className="primary-button" onClick={() => void importFiles()}><Upload size={17}/> Adicionar arquivos</button>}
      </div>
    </div>

    {error && <div className="workspace-error" role="alert">{error}</div>}

    <div className="workspace-explorer">
      <aside className="workspace-tree" aria-label="Pastas do Workspace">
        <div className="workspace-tree-title">Pastas</div>
        {tree && <TreeNode node={tree}/>} 
        <button type="button" className={`workspace-trash-link ${mode === 'trash' ? 'active' : ''}`} onClick={() => { setMode('trash'); setSearchResults(null); }}><Trash2 size={16}/> Lixeira</button>
      </aside>

      <div
        className={`workspace-main ${externalDropActive ? 'external-drop-active' : ''}`}
        onDragEnter={handleExternalDragEnter}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={(event) => { if (hasExternalFiles(event)) void importDropped(event, currentPath); }}
      >
        {externalDropActive && canManage && mode === 'files' && <div className="workspace-drop-overlay" data-testid="workspace-external-drop-overlay"><Upload size={34}/><strong>Solte para adicionar</strong><span>Arquivos e pastas serão copiados para esta pasta do Workspace.</span></div>}
        <div className="workspace-commandbar">
          <div className="workspace-history">
            <button type="button" aria-label="Voltar" disabled={historyIndex <= 0} onClick={goBack}><ArrowLeft size={17}/></button>
            <button type="button" aria-label="Avançar" disabled={historyIndex >= history.length - 1} onClick={goForward}><ArrowRight size={17}/></button>
          </div>

          {mode === 'files' ? <div className="workspace-breadcrumbs" aria-label="Caminho atual">
            {crumbs.map((crumb, index) => <span key={crumb.path || 'root'}>{index > 0 && <ChevronRight size={14}/>}<button type="button" onClick={() => navigate(crumb.path)}>{crumb.name}</button></span>)}
          </div> : <div className="workspace-breadcrumbs"><span><Trash2 size={15}/> Lixeira</span></div>}

          <form className="workspace-search" onSubmit={(event) => void submitSearch(event)}>
            <Search size={16}/><input aria-label="Buscar no Workspace" value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value) setSearchResults(null); }} placeholder="Buscar no Workspace"/>
          </form>
        </div>

        {mode === 'files' && <div className="workspace-toolbar">
          <div className="workspace-toolbar-left">
            {canManage && <>
              <button type="button" onClick={() => void createFolder()}><FolderPlus size={16}/> Nova pasta</button>
              <button type="button" onClick={() => void createFile()}><FilePlus2 size={16}/> Novo arquivo</button>
            </>}
            {searchResults && <span className="workspace-search-label">Resultados para “{query}”</span>}
          </div>
          <div className="workspace-view-controls">
            <select aria-label="Ordenar Workspace" value={prefs.sortBy} onChange={(event) => void savePreferences({ sortBy: event.target.value as SortBy })}>
              <option value="name">Nome</option><option value="modifiedAt">Data</option><option value="size">Tamanho</option><option value="type">Tipo</option>
            </select>
            <button type="button" aria-label="Inverter ordenação" onClick={() => void savePreferences({ sortDirection: prefs.sortDirection === 'asc' ? 'desc' : 'asc' })}>{prefs.sortDirection === 'asc' ? 'A–Z' : 'Z–A'}</button>
            <button type="button" aria-label="Visualização em lista" className={prefs.viewMode === 'list' ? 'active' : ''} onClick={() => void savePreferences({ viewMode: 'list' })}><List size={17}/></button>
            <button type="button" aria-label="Visualização em grade" className={prefs.viewMode === 'grid' ? 'active' : ''} onClick={() => void savePreferences({ viewMode: 'grid' })}><LayoutGrid size={17}/></button>
          </div>
        </div>}

        {loading ? <div className="workspace-empty">Carregando Workspace…</div> : mode === 'trash' ? <div className="workspace-trash-view">
          {trash.length === 0 ? <div className="workspace-empty"><Trash2 size={28}/><strong>Lixeira vazia</strong><span>Itens excluídos aparecerão aqui antes da exclusão definitiva.</span></div> : <div className="workspace-list">
            <div className="workspace-list-head"><span>Nome</span><span>Local original</span><span>Excluído em</span><span>Ações</span></div>
            {trash.map((item) => <div className="workspace-list-row trash-row" key={item.id}>
              <div className="workspace-name">{item.type === 'folder' ? <Folder size={18}/> : <File size={18}/>}<span>{item.name}</span></div>
              <span>{item.originalPath}</span><span>{formatDate(item.deletedAt)}</span>
              <div className="workspace-row-actions"><button type="button" onClick={() => void restoreItem(item)} title="Restaurar"><RotateCcw size={16}/></button>{canManage && <button type="button" onClick={() => void deleteForever(item)} title="Excluir permanentemente"><Trash2 size={16}/></button>}</div>
            </div>)}
          </div>}
        </div> : visibleItems.length === 0 ? <div className="workspace-empty" data-testid="workspace-empty"><FolderOpen size={34}/><strong>{searchResults ? 'Nenhum resultado' : 'Esta pasta está vazia'}</strong><span>{searchResults ? 'Tente outro termo de busca.' : 'Crie uma pasta ou adicione arquivos para começar.'}</span></div> : prefs.viewMode === 'grid' ? <div className="workspace-grid">
          {visibleItems.map((item) => <button
            type="button"
            className="workspace-grid-item"
            key={item.path}
            draggable={canManage}
            onDragStart={(event) => startDrag(event, item)}
            onDragOver={(event) => item.type === 'folder' && canManage && event.preventDefault()}
            onDrop={(event) => item.type === 'folder' && dropOnFolder(event, item.path)}
            onDoubleClick={() => openItem(item)}
            onContextMenu={(event) => showContext(event, item)}
          >
            {iconFor(item, 38)}<strong>{item.name}</strong><span>{item.type === 'folder' ? 'Pasta' : formatSize(item.size)}</span>
          </button>)}
        </div> : <div className="workspace-list">
          <div className="workspace-list-head"><span>Nome</span><span>Modificado</span><span>Tipo</span><span>Tamanho</span></div>
          {visibleItems.map((item) => <div
            className="workspace-list-row"
            key={item.path}
            draggable={canManage}
            onDragStart={(event) => startDrag(event, item)}
            onDragOver={(event) => item.type === 'folder' && canManage && event.preventDefault()}
            onDrop={(event) => item.type === 'folder' && dropOnFolder(event, item.path)}
            onDoubleClick={() => openItem(item)}
            onContextMenu={(event) => showContext(event, item)}
          >
            <div className="workspace-name">{iconFor(item, 18)}<button type="button" onClick={() => openItem(item)}>{item.name}</button></div>
            <span>{formatDate(item.modifiedAt)}</span><span>{item.type === 'folder' ? 'Pasta' : (item.extension || 'Arquivo')}</span><span>{formatSize(item.size)}</span>
          </div>)}
        </div>}
      </div>
    </div>

    {contextMenu && <div className="workspace-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => { openItem(contextMenu.item); setContextMenu(null); }}>{contextMenu.item.type === 'folder' ? <FolderOpen size={15}/> : <ExternalLink size={15}/>} Abrir</button>
      <button type="button" onClick={() => { void api.reveal(token, contextMenu.item.path); setContextMenu(null); }}><ExternalLink size={15}/> Mostrar no Explorer</button>
      {canManage && <>
        <button type="button" onClick={() => { void renameItem(contextMenu.item); setContextMenu(null); }}><Pencil size={15}/> Renomear</button>
        <button type="button" onClick={() => { void moveItem(contextMenu.item); setContextMenu(null); }}><Move size={15}/> Mover</button>
        <button type="button" onClick={() => { void copyItem(contextMenu.item); setContextMenu(null); }}><Copy size={15}/> Copiar</button>
        <button type="button" className="danger" onClick={() => { void trashItem(contextMenu.item); setContextMenu(null); }}><Trash2 size={15}/> Excluir</button>
      </>}
    </div>}
  </section>;
}

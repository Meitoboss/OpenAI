// Electronのメインプロセス。ウィンドウを作り、画面からの依頼(IPC)を処理する。
// Ollamaへの通信をここで行うのは、画面から直接つなぐとCORSで拒否されるため。
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HistoryStore } from './history';
import { PDF_EXTENSIONS, readMaterial, TEXT_EXTENSIONS } from './materials';
import { listModels, materialBudget, streamChat } from './ollama';
import type {
  ChatRequest,
  ChatResult,
  Conversation,
  PickMaterialsResult,
  Settings,
  SettingsInfo,
} from '../shared/types';

const DEFAULT_SETTINGS: Settings = {
  host: 'http://127.0.0.1:11434',
  model: '',
  numCtx: 8192,
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let history: HistoryStore;
const runningChats = new Map<string, AbortController>();

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings(): Promise<void> {
  try {
    const saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<Settings>;
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...saved });
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function sanitizeSettings(value: Settings): Settings {
  const numCtx = Number(value.numCtx);
  return {
    host: typeof value.host === 'string' && value.host.trim() ? value.host.trim() : DEFAULT_SETTINGS.host,
    model: typeof value.model === 'string' ? value.model : '',
    numCtx: Number.isFinite(numCtx) ? Math.min(Math.max(Math.round(numCtx), 2048), 262144) : DEFAULT_SETTINGS.numCtx,
  };
}

function settingsInfo(): SettingsInfo {
  return { settings, materialBudget: materialBudget(settings.numCtx) };
}

function registerIpc(): void {
  ipcMain.handle('models:list', () => listModels(settings.host));

  ipcMain.handle('settings:get', () => settingsInfo());
  ipcMain.handle('settings:set', async (_event, patch: Partial<Settings>) => {
    settings = sanitizeSettings({ ...settings, ...patch });
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
    return settingsInfo();
  });

  ipcMain.handle('materials:pick', async (event): Promise<PickMaterialsResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '教材を選ぶ',
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [
        { name: '教材(テキスト・PDF)', extensions: [...TEXT_EXTENSIONS, ...PDF_EXTENSIONS] },
        { name: 'すべてのファイル', extensions: ['*'] },
      ],
    };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);

    const result: PickMaterialsResult = { materials: [], errors: [] };
    if (picked.canceled) return result;
    for (const filePath of picked.filePaths) {
      try {
        result.materials.push(await readMaterial(filePath));
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return result;
  });

  ipcMain.handle('history:list', () => history.list());
  ipcMain.handle('history:load', (_event, id: string) => history.load(id));
  ipcMain.handle('history:save', (_event, conversation: Conversation) => history.save(conversation));
  ipcMain.handle('history:delete', (_event, id: string) => history.delete(id));

  ipcMain.handle('chat:start', async (event, requestId: string, request: ChatRequest): Promise<ChatResult> => {
    const controller = new AbortController();
    runningChats.set(requestId, controller);
    try {
      for await (const chunk of streamChat(settings.host, request, settings.numCtx, controller.signal)) {
        if (event.sender.isDestroyed()) break;
        event.sender.send('chat:chunk', requestId, chunk);
      }
      return { ok: true, aborted: controller.signal.aborted };
    } catch (error) {
      if (controller.signal.aborted) return { ok: true, aborted: true };
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      runningChats.delete(requestId);
    }
  });

  ipcMain.on('chat:abort', (_event, requestId: string) => {
    runningChats.get(requestId)?.abort();
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Local Study AI',
    backgroundColor: '#f6f5f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.setMenuBarVisibility(false);
  // このアプリは自分の画面だけを表示する。外部ページへの遷移や新規ウィンドウは許可しない
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  void window.loadFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
}

void app.whenReady().then(async () => {
  history = new HistoryStore(path.join(app.getPath('userData'), 'conversations'));
  await loadSettings();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 画面(レンダラー)に公開する機能の窓口。
// 画面からNode.jsを直接触らせず、ここに書いた関数だけを `window.api` として渡す。
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { Api, ChatChunk } from '../shared/types';

const api: Api = {
  listModels: () => ipcRenderer.invoke('models:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  pickMaterials: () => ipcRenderer.invoke('materials:pick'),

  listConversations: () => ipcRenderer.invoke('history:list'),
  loadConversation: (id) => ipcRenderer.invoke('history:load', id),
  saveConversation: (conversation) => ipcRenderer.invoke('history:save', conversation),
  deleteConversation: (id) => ipcRenderer.invoke('history:delete', id),

  startChat: (requestId, request) => ipcRenderer.invoke('chat:start', requestId, request),
  abortChat: (requestId) => ipcRenderer.send('chat:abort', requestId),
  onChatChunk: (listener) => {
    const handler = (_event: IpcRendererEvent, requestId: string, chunk: ChatChunk) => listener(requestId, chunk);
    ipcRenderer.on('chat:chunk', handler);
    return () => ipcRenderer.removeListener('chat:chunk', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

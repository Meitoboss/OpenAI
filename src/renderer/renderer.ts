// 画面の動き。Node.jsの機能は使えないので、必要なことは window.api(プリロード)経由で頼む。
//
// このファイルは <script> でそのまま読み込むため、import / export は書かない。
// 型だけが必要なときは下のように import('...') 形式で参照する(実行時には消える)。
type Conversation = import('../shared/types').Conversation;
type ConversationSummary = import('../shared/types').ConversationSummary;
type Role = import('../shared/types').Role;
type SettingsInfo = import('../shared/types').SettingsInfo;

const api = window.api;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} が見つかりません`);
  return node as T;
}

const statusBox = el<HTMLDivElement>('status');
const statusText = el<HTMLSpanElement>('status-text');
const modelSelect = el<HTMLSelectElement>('model');
const numCtxSelect = el<HTMLSelectElement>('num-ctx');
const reloadButton = el<HTMLButtonElement>('reload-models');
const newChatButton = el<HTMLButtonElement>('new-chat');
const conversationList = el<HTMLUListElement>('conversation-list');
const addMaterialButton = el<HTMLButtonElement>('add-material');
const materialList = el<HTMLUListElement>('material-list');
const materialNote = el<HTMLParagraphElement>('material-note');
const messagesBox = el<HTMLElement>('messages');
const composer = el<HTMLFormElement>('composer');
const input = el<HTMLTextAreaElement>('input');
const sendButton = el<HTMLButtonElement>('send');

// ---- 状態 ----
let info: SettingsInfo;
let conversation: Conversation = emptyConversation();
let summaries: ConversationSummary[] = [];
/** 生成中の応答。null なら待機中 */
let running: { requestId: string; bubble: HTMLElement; text: string } | null = null;

function emptyConversation(): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新しい会話',
    model: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    materials: [],
  };
}

const formatNumber = (value: number): string => value.toLocaleString('ja-JP');

// ---- メッセージ表示 ----
function scrollToBottom(): void {
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function appendMessage(kind: Role | 'error', text: string): HTMLElement {
  messagesBox.querySelector('.welcome')?.remove();
  const bubble = document.createElement('div');
  bubble.className = `message ${kind}`;
  // textContent で入れるので、AIの出力にHTMLが混ざっていても実行されない
  bubble.textContent = text;
  messagesBox.append(bubble);
  scrollToBottom();
  return bubble;
}

function setPending(bubble: HTMLElement, label: string): void {
  const pending = document.createElement('span');
  pending.className = 'pending';
  pending.textContent = label;
  bubble.replaceChildren(pending);
}

function renderMessages(): void {
  messagesBox.replaceChildren();
  if (conversation.messages.length === 0) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome';
    const heading = document.createElement('h1');
    heading.textContent = '何を勉強しますか?';
    const body = document.createElement('p');
    body.textContent =
      '質問を入力するか、「教材を追加」でノートやPDFを読み込ませてください。やり取りはすべてこのPCの中で処理されます。';
    welcome.append(heading, body);
    messagesBox.append(welcome);
    return;
  }
  for (const message of conversation.messages) appendMessage(message.role, message.content);
}

// ---- 教材 ----
function renderMaterials(): void {
  materialList.replaceChildren();
  let total = 0;
  let clipped = false;

  conversation.materials.forEach((material, index) => {
    total += material.text.length;
    clipped ||= material.clipped;

    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = material.name;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${formatNumber(material.text.length)}文字`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `${material.name} を外す`;
    remove.addEventListener('click', () => {
      conversation.materials.splice(index, 1);
      renderMaterials();
      void persistIfStarted();
    });
    item.append(name, count, remove);
    materialList.append(item);
  });

  const budget = info.materialBudget;
  if (conversation.materials.length === 0) {
    materialNote.textContent = '';
    materialNote.dataset.warn = 'false';
  } else if (total > budget) {
    materialNote.textContent =
      `教材は合計${formatNumber(total)}文字ありますが、今の設定でAIに渡るのは先頭の約${formatNumber(budget)}文字です。` +
      'コンテキスト長を上げると増やせます(メモリ使用量が増え、遅くなることがあります)。';
    materialNote.dataset.warn = 'true';
  } else {
    materialNote.textContent =
      `教材${formatNumber(total)}文字をAIに渡します。` + (clipped ? '(長すぎるファイルは一部だけ読み込みました)' : '');
    materialNote.dataset.warn = 'false';
  }
}

async function addMaterials(): Promise<void> {
  addMaterialButton.disabled = true;
  try {
    const result = await api.pickMaterials();
    for (const material of result.materials) {
      // 同じ名前のファイルは入れ替える
      const existing = conversation.materials.findIndex((m) => m.name === material.name);
      if (existing >= 0) conversation.materials[existing] = material;
      else conversation.materials.push(material);
    }
    renderMaterials();
    for (const error of result.errors) appendMessage('error', error);
    await persistIfStarted();
  } finally {
    addMaterialButton.disabled = false;
  }
}

// ---- 履歴 ----
function renderConversationList(): void {
  conversationList.replaceChildren();
  if (summaries.length === 0) {
    const note = document.createElement('li');
    note.className = 'empty-note';
    note.textContent = 'まだ会話はありません';
    conversationList.append(note);
    return;
  }

  for (const summary of summaries) {
    const item = document.createElement('li');
    if (summary.id === conversation.id) item.setAttribute('aria-current', 'true');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open';
    open.textContent = summary.title;
    open.title = `${summary.title}(${new Date(summary.updatedAt).toLocaleString('ja-JP')})`;
    open.addEventListener('click', () => void openConversation(summary.id));

    // 削除は2回押しで確定(1回目で「削除する」に変わる)
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = '×';
    remove.title = 'この会話を削除';
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm === 'true') void deleteConversation(summary.id);
      else {
        remove.dataset.confirm = 'true';
        remove.textContent = '削除する';
      }
    });
    remove.addEventListener('blur', () => {
      remove.dataset.confirm = 'false';
      remove.textContent = '×';
    });

    item.append(open, remove);
    conversationList.append(item);
  }
}

async function refreshConversationList(): Promise<void> {
  summaries = await api.listConversations();
  renderConversationList();
}

function showConversation(next: Conversation): void {
  conversation = next;
  if (next.model && [...modelSelect.options].some((option) => option.value === next.model)) {
    modelSelect.value = next.model;
  }
  renderMessages();
  renderMaterials();
  renderConversationList();
  input.focus();
}

async function openConversation(id: string): Promise<void> {
  if (running || id === conversation.id) return;
  const loaded = await api.loadConversation(id);
  if (loaded) showConversation(loaded);
  else await refreshConversationList();
}

async function deleteConversation(id: string): Promise<void> {
  if (running) return;
  await api.deleteConversation(id);
  if (id === conversation.id) showConversation(emptyConversation());
  await refreshConversationList();
}

async function persist(): Promise<void> {
  conversation.updatedAt = Date.now();
  await api.saveConversation(conversation);
  await refreshConversationList();
}

/** まだ1通も送っていない会話は保存しない(空の履歴を増やさないため) */
async function persistIfStarted(): Promise<void> {
  if (conversation.messages.length > 0) await persist();
}

// ---- モデルと設定 ----
function setStatus(state: 'checking' | 'ok' | 'error', text: string): void {
  statusBox.dataset.state = state;
  statusText.textContent = text;
}

async function refreshModels(): Promise<void> {
  setStatus('checking', 'Ollamaを確認中…');
  const result = await api.listModels();
  modelSelect.replaceChildren();

  if (!result.ok) {
    setStatus('error', result.error);
    return;
  }
  if (result.models.length === 0) {
    setStatus(
      'error',
      'モデルがまだありません。ターミナルで「ollama pull qwen3.5:4b」を実行してから「再接続」を押してください。',
    );
    return;
  }

  for (const model of result.models) modelSelect.append(new Option(model, model));
  const preferred = [conversation.model, info.settings.model].find((name) => name && result.models.includes(name));
  modelSelect.value = preferred ?? result.models[0] ?? '';
  setStatus('ok', `接続中: ${info.settings.host}`);
}

function applyNumCtx(): void {
  const value = String(info.settings.numCtx);
  if (![...numCtxSelect.options].some((option) => option.value === value)) {
    numCtxSelect.append(new Option(formatNumber(info.settings.numCtx), value));
  }
  numCtxSelect.value = value;
}

// ---- 送信 ----
function setBusy(busy: boolean): void {
  sendButton.textContent = busy ? '停止' : '送信';
  newChatButton.disabled = busy;
  addMaterialButton.disabled = busy;
}

async function send(): Promise<void> {
  if (running) {
    api.abortChat(running.requestId);
    return;
  }

  const text = input.value.trim();
  if (!text) return;
  const model = modelSelect.value;
  if (!model) {
    appendMessage('error', '使えるモデルがありません。Ollamaの起動とモデルの有無を確認して「再接続」を押してください。');
    return;
  }

  input.value = '';
  resizeInput();
  if (conversation.messages.length === 0) {
    const firstLine = text.split('\n')[0] ?? text;
    conversation.title = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
  }
  conversation.model = model;
  conversation.messages.push({ role: 'user', content: text });
  appendMessage('user', text);

  const bubble = appendMessage('assistant', '');
  setPending(bubble, '応答を待っています…');
  const current = { requestId: crypto.randomUUID(), bubble, text: '' };
  running = current;
  setBusy(true);

  try {
    await persist();
    const result = await api.startChat(current.requestId, {
      model,
      messages: conversation.messages,
      materials: conversation.materials,
    });

    if (current.text) {
      conversation.messages.push({ role: 'assistant', content: current.text });
      await persist();
    } else {
      bubble.remove();
      if (result.ok && !result.aborted) appendMessage('error', 'AIから空の応答が返りました。もう一度試してください。');
    }
    if (!result.ok) appendMessage('error', result.error);
  } catch (error) {
    if (!current.text) bubble.remove();
    appendMessage('error', error instanceof Error ? error.message : String(error));
  } finally {
    running = null;
    setBusy(false);
    input.focus();
  }
}

function resizeInput(): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, 200)}px`;
}

// ---- イベント ----
api.onChatChunk((requestId, chunk) => {
  if (!running || running.requestId !== requestId) return;
  if (chunk.content) {
    running.text += chunk.content;
    running.bubble.textContent = running.text;
    scrollToBottom();
  } else if (chunk.thinking && !running.text) {
    setPending(running.bubble, '考えています…');
  }
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  void send();
});

input.addEventListener('keydown', (event) => {
  // 日本語入力の変換確定のEnterでは送信しない
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
});
input.addEventListener('input', resizeInput);

newChatButton.addEventListener('click', () => {
  if (!running) showConversation(emptyConversation());
});
addMaterialButton.addEventListener('click', () => void addMaterials());
reloadButton.addEventListener('click', () => void refreshModels());

modelSelect.addEventListener('change', () => {
  void api.setSettings({ model: modelSelect.value }).then((next) => (info = next));
});
numCtxSelect.addEventListener('change', () => {
  void api.setSettings({ numCtx: Number(numCtxSelect.value) }).then((next) => {
    info = next;
    renderMaterials();
  });
});

async function init(): Promise<void> {
  info = await api.getSettings();
  applyNumCtx();
  renderMessages();
  renderMaterials();
  await Promise.all([refreshModels(), refreshConversationList()]);
  input.focus();
}

void init();

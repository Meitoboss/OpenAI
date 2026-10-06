// メインプロセスと画面の両方で使う型定義。
// 画面側からは `import type` でのみ読み込むこと(実行時コードは置かない)。

export type Role = 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** 読み込んだ教材1件ぶんのテキスト */
export interface Material {
  name: string;
  text: string;
  /** 元ファイルが長すぎて保存時に切り詰めた場合 true */
  clipped: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  materials: Material[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface Settings {
  /** Ollamaのアドレス。外部サーバーに移すときはここを変える */
  host: string;
  /** 既定で使うモデル名(空なら一覧の先頭) */
  model: string;
  /** コンテキスト長(トークン)。大きいほど長い教材を扱えるがメモリを使う */
  numCtx: number;
}

export interface SettingsInfo {
  settings: Settings;
  /** 現在のコンテキスト長でAIに渡せる教材の目安(文字数) */
  materialBudget: number;
}

export type ModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  materials: Material[];
}

export interface ChatChunk {
  /** 回答本文の断片 */
  content?: string;
  /** 思考型モデルが考えている最中の断片(画面には状態だけ出す) */
  thinking?: string;
}

export type ChatResult =
  | { ok: true; aborted: boolean }
  | { ok: false; error: string };

export interface PickMaterialsResult {
  materials: Material[];
  /** 読み込めなかったファイルの説明 */
  errors: string[];
}

/** プリロードが `window.api` として画面に公開する機能 */
export interface Api {
  listModels(): Promise<ModelsResult>;
  getSettings(): Promise<SettingsInfo>;
  setSettings(patch: Partial<Settings>): Promise<SettingsInfo>;

  pickMaterials(): Promise<PickMaterialsResult>;

  listConversations(): Promise<ConversationSummary[]>;
  loadConversation(id: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  startChat(requestId: string, request: ChatRequest): Promise<ChatResult>;
  abortChat(requestId: string): void;
  /** 生成中の断片を受け取る。戻り値を呼ぶと購読解除 */
  onChatChunk(listener: (requestId: string, chunk: ChatChunk) => void): () => void;
}

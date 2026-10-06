// Ollama とのやり取り。Electron には依存しないので、単体でテストできる。
import type { ChatChunk, ChatMessage, ChatRequest, ModelsResult } from '../shared/types';

const SYSTEM_PROMPT = [
  'あなたは学習を手伝うアシスタントです。',
  '日本語で、要点から順にわかりやすく説明してください。',
  '確信がないことは推測で断定せず、わからないと伝えてください。',
].join('\n');

/**
 * 現在のコンテキスト長でAIに渡す教材の上限(文字数の目安)。
 * 日本語はおおよそ1文字=1トークン前後なので、コンテキストの半分までに抑えて
 * 会話と回答のための余裕を残す。
 */
export function materialBudget(numCtx: number): number {
  return Math.max(500, Math.floor(numCtx * 0.5));
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** システムプロンプト+教材+会話履歴を、Ollamaに送る形に組み立てる */
export function buildMessages(request: ChatRequest, numCtx: number): OllamaMessage[] {
  let system = SYSTEM_PROMPT;
  let remaining = materialBudget(numCtx);
  const parts: string[] = [];

  for (const material of request.materials) {
    if (remaining <= 0) break;
    const text = material.text.slice(0, remaining);
    remaining -= text.length;
    const note = text.length < material.text.length ? '(長いため途中まで)' : '';
    parts.push(`### ${material.name}${note}\n${text}`);
  }

  if (parts.length > 0) {
    system +=
      '\n\n以下は学習者が用意した教材です。質問にはまずこの教材の内容に基づいて答え、' +
      '教材に書かれていないことはその旨を伝えてください。\n\n' +
      parts.join('\n\n');
  }

  const history: ChatMessage[] = request.messages;
  return [{ role: 'system', content: system }, ...history];
}

function baseUrl(host: string): string {
  return host.trim().replace(/\/+$/, '');
}

function describeError(error: unknown, host: string): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (error.name === 'TimeoutError' || cause?.code === 'ECONNREFUSED' || error.message === 'fetch failed') {
      return `Ollama(${host})に接続できません。Ollamaが起動しているか確認してください。`;
    }
    return error.message;
  }
  return String(error);
}

async function readHttpError(response: Response, model?: string): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: string };
    detail = body.error ?? '';
  } catch {
    // JSONでない応答は無視
  }
  if (response.status === 404 && model) {
    return `モデル「${model}」が見つかりません。ターミナルで \`ollama pull ${model}\` を実行してください。`;
  }
  return `Ollamaがエラーを返しました(${response.status})${detail ? `: ${detail}` : ''}`;
}

/** インストール済みモデルの一覧 */
export async function listModels(host: string): Promise<ModelsResult> {
  try {
    const response = await fetch(`${baseUrl(host)}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, error: await readHttpError(response) };
    const body = (await response.json()) as { models?: { name: string }[] };
    const models = (body.models ?? []).map((m) => m.name).sort();
    return { ok: true, models };
  } catch (error) {
    return { ok: false, error: describeError(error, host) };
  }
}

interface StreamLine {
  message?: { content?: string; thinking?: string };
  error?: string;
  done?: boolean;
}

/**
 * チャットをストリーミングで実行し、届いた断片を順に返す。
 * Ollamaは1行1JSON(NDJSON)で返すので、行単位に区切って読む。
 */
export async function* streamChat(
  host: string,
  request: ChatRequest,
  numCtx: number,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(host)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: buildMessages(request, numCtx),
        stream: true,
        options: { num_ctx: numCtx },
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(describeError(error, host));
  }

  if (!response.ok) throw new Error(await readHttpError(response, request.model));
  if (!response.body) throw new Error('Ollamaから応答本文が返りませんでした。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parse = (line: string): ChatChunk | null => {
    if (!line.trim()) return null;
    const data = JSON.parse(line) as StreamLine;
    if (data.error) throw new Error(`Ollamaがエラーを返しました: ${data.error}`);
    const content = data.message?.content;
    const thinking = data.message?.thinking;
    if (!content && !thinking) return null;
    return { ...(content ? { content } : {}), ...(thinking ? { thinking } : {}) };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const chunk = parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (chunk) yield chunk;
      }
    }
    const last = parse(buffer + decoder.decode());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

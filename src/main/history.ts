// 会話履歴の保存。1会話=1つのJSONファイル。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Conversation, ConversationSummary } from '../shared/types';

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export class HistoryStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    // idはファイル名になるので、想定外の文字(../ など)を弾く
    if (!ID_PATTERN.test(id)) throw new Error(`不正な会話IDです: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const summaries: ConversationSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const conversation = await this.load(name.slice(0, -'.json'.length)).catch(() => null);
      if (conversation) {
        summaries.push({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt });
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Conversation | null> {
    try {
      const raw = await fs.readFile(this.file(id), 'utf8');
      return JSON.parse(raw) as Conversation;
    } catch {
      return null;
    }
  }

  async save(conversation: Conversation): Promise<void> {
    const target = this.file(conversation.id);
    await fs.mkdir(this.dir, { recursive: true });
    // 書き込み途中で落ちても壊れないよう、一時ファイルに書いてから差し替える
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, JSON.stringify(conversation, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true });
  }
}

// 教材ファイル(テキスト/PDF)を読み込んで、プレーンテキストにする。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Material } from '../shared/types';

/** ファイル選択ダイアログに出す拡張子 */
export const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'tsv', 'json', 'tex', 'html', 'xml', 'yaml', 'yml'];
export const PDF_EXTENSIONS = ['pdf'];

const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 履歴ファイルが巨大にならないよう、保存するテキストの上限 */
const MAX_STORED_CHARS = 200_000;

function decodeText(buffer: Buffer): string {
  // まずUTF-8として厳密に読み、だめならShift_JIS(古い日本語のテキスト)を試す
  for (const encoding of ['utf-8', 'shift_jis']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      // 次の文字コードを試す
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdfjs-dist はESモジュールなので動的importで読み込む
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // 日本語PDFの文字を正しく取り出すために必要な対応表
    cMapUrl: path.join(packageDir, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(packageDir, 'standard_fonts') + path.sep,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
      }
      pages.push(text.trim());
    }
    return pages.filter(Boolean).join('\n\n');
  } finally {
    await loadingTask.destroy();
  }
}

export async function readMaterial(filePath: string): Promise<Material> {
  const name = path.basename(filePath);
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${name}: ファイルが大きすぎます(30MBまで)`);
  }

  const buffer = await fs.readFile(filePath);
  const isPdf = path.extname(filePath).toLowerCase() === '.pdf';
  const text = (isPdf ? await extractPdfText(buffer) : decodeText(buffer)).trim();

  if (!text) {
    throw new Error(
      isPdf
        ? `${name}: テキストを取り出せませんでした(スキャン画像のPDFかもしれません)`
        : `${name}: 中身が空です`,
    );
  }

  return {
    name,
    text: text.slice(0, MAX_STORED_CHARS),
    clipped: text.length > MAX_STORED_CHARS,
  };
}

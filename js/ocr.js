// 本地文字识别（OCR）适配层。
//
// 识别引擎（tesseract.js + 中文/英文语言包）是随 App 一起放在 ./vendor/tesseract/ 里的本地文件，
// 识别全程在这台手机上完成：图片不会离开设备，也不会请求任何网络地址。
// 如果 vendor 里没有这些文件（`npm run fetch-ocr` 会把它们放进来），isOcrAvailable() 返回 false，
// 界面会改用「系统自带的 实况文本 / 提取文字 + 粘贴」流程。
//
// 注意：这一层依赖第三方库的接口，开发环境里没有联网安装的条件，所以这里无法做真实识别测试。
// 解析出的文字之后全部进入「预览校对页」，识别错了也不会直接写入账本。

import { OCR_INSTALLED } from './features.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url);
const MAX_EDGE = 2800;

let availability = null;

export async function ocrStatus({ force = false } = {}) {
  if (availability && !force) return availability;
  if (!OCR_INSTALLED) {
    availability = { available: false };
    return availability;
  }
  try {
    const res = await fetch(new URL('manifest.json', BASE));
    if (!res.ok) throw new Error(String(res.status));
    const m = await res.json();
    availability = { available: true, manifest: m };
  } catch {
    availability = { available: false };
  }
  return availability;
}

export async function isOcrAvailable() {
  return (await ocrStatus()).available;
}

/** 缩放过大的照片，并转成灰度，识别更快、更省内存。失败时直接用原图。 */
export async function prepareImage(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/png'));
  } catch {
    return file;
  }
}

/** tesseract.js 5 / 6 两种输出形态都兼容，统一成 [{text, words:[{text, confidence}]}] */
export function normalizeOcrResult(data) {
  const lines = [];
  const pushLine = (ln) => {
    const text = String(ln.text ?? '').replace(/\s+$/g, '');
    if (!text.trim()) return;
    lines.push({ text, words: (ln.words ?? []).map((w) => ({ text: String(w.text ?? ''), confidence: Number.isFinite(w.confidence) ? w.confidence : 100 })) });
  };
  if (Array.isArray(data?.lines) && data.lines.length) data.lines.forEach(pushLine);
  else if (Array.isArray(data?.blocks)) {
    for (const b of data.blocks) for (const p of b.paragraphs ?? []) for (const ln of p.lines ?? []) pushLine(ln);
  }
  if (!lines.length && typeof data?.text === 'string') data.text.split(/\r?\n/).forEach((t) => pushLine({ text: t }));
  return lines;
}

/** 识别一张图片。onProgress(0..1, 状态文字) */
export async function recognizeImage(file, { onProgress } = {}) {
  const st = await ocrStatus();
  if (!st.available) throw new Error('这个版本没有包含本地文字识别组件');
  onProgress?.(0.02, '正在准备图片…');
  const input = await prepareImage(file);
  onProgress?.(0.06, '正在加载识别引擎…');
  const mod = await import(new URL(st.manifest.module ?? 'tesseract.esm.min.js', BASE).href);
  const T = mod.default ?? mod;
  const worker = await T.createWorker(st.manifest.langs ?? 'chi_sim+eng', 1, {
    workerPath: new URL(st.manifest.worker ?? 'worker.min.js', BASE).href,
    corePath: new URL(st.manifest.core ?? 'core/', BASE).href,
    langPath: new URL(st.manifest.langPath ?? 'lang/', BASE).href,
    workerBlobURL: false,
    gzip: st.manifest.gzip !== false,
    cacheMethod: 'none',
    logger: (m) => {
      if (m?.status === 'recognizing text') onProgress?.(0.15 + 0.8 * (m.progress ?? 0), '正在识别文字…');
      else if (m?.status) onProgress?.(0.08, '正在加载语言包…');
    },
  });
  try {
    let result;
    try {
      result = await worker.recognize(input, {}, { blocks: true });
    } catch {
      result = await worker.recognize(input);
    }
    onProgress?.(1, '识别完成');
    return normalizeOcrResult(result.data);
  } finally {
    await worker.terminate().catch(() => {});
  }
}

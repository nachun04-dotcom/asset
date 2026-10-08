// 导入入口：相册图片、粘贴文本、CSV / Excel 文件、导入模板。
// 无论从哪里来，都只生成「草稿」，进入预览校对页，由你确认后才写入。
import { h } from '../dom.js';
import { alertDialog, button, noteBox, openSheet, toast } from '../components.js';
import { openImportPreview } from './importPreview.js';
import { draftFromTable, draftFromText } from '../../core/importPlan.js';
import { parseTextRecords } from '../../core/textImport.js';
import { parseTable } from '../../core/tabular.js';
import { decodeBytes, parseCSV } from '../../core/csv.js';
import { readXlsx } from '../../core/xlsx.js';
import { TEMPLATE_HELP, templateCSV, templateXlsx } from '../../core/csvExport.js';
import { MIME, pickFile, readBytes, saveFile } from '../../platform.js';
import { isOcrAvailable, recognizeImage } from '../../ocr.js';

const MAX_FILE = 25 * 1024 * 1024;
const EXAMPLE = '7月28日 12.3+4.5+2.1+0.8=19.7';

/* ------------------------------ 文本 / 图片文字 → 预览 ------------------------------ */

function previewFromText(ctx, input, { kind, imageFile = null }) {
  const parsed = parseTextRecords(input, { ocr: kind === 'image' });
  if (!parsed.records.length) {
    const hint = parsed.unparsed.length ? `有 ${parsed.unparsed.length} 行以日期开头，但没认出金额：「${parsed.unparsed[0].text}」…` : '';
    return { ok: false, message: `没有找到可导入的记录。每条记录需要以日期开头并带金额，例如「${EXAMPLE}」。${hint}` };
  }
  const draft = draftFromText(parsed, { kind });
  openImportPreview(ctx, draft, { imageUrl: imageFile ? URL.createObjectURL(imageFile) : null });
  return { ok: true };
}

export function openTextImport(ctx, { initialText = '', title = '粘贴文本', imageFile = null, kind = 'text' } = {}) {
  const area = h('textarea', { rows: '10', placeholder: `把备忘录里的记录粘贴到这里，例如：\n${EXAMPLE}`, 'aria-label': '要导入的文本', style: 'min-height:200px' });
  area.value = initialText;
  const err = h('div', { class: 'err', role: 'alert' });
  const go = () => {
    err.textContent = '';
    const r = previewFromText(ctx, area.value, { kind, imageFile });
    if (!r.ok) err.textContent = r.message;
  };
  const pasteBtn = button('从剪贴板粘贴', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) area.value = t;
      else toast('剪贴板是空的');
    } catch {
      toast('无法读取剪贴板，请长按输入框选择「粘贴」');
    }
  }, { kind: 'secondary', sm: true });
  return openSheet({
    title,
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted small' }, '支持类似「7月28日 12.3+4.5+2.1+0.8=19.7」的写法，一行一条。App 只拆分文字，不会猜哪个数是哪一类、也不会猜单位和年份，这些都在下一步由你确认。'),
      area,
      h('div', { class: 'row' }, pasteBtn),
      err,
    ),
    footer: button('解析并预览', go, { block: true }),
  });
}

/* ------------------------------ 图片 ------------------------------ */

export async function openImageImport(ctx, file) {
  const url = URL.createObjectURL(file);
  const ocrOk = await isOcrAvailable();
  const status = h('div', { class: 'stack', 'aria-live': 'polite' });
  const bar = h('progress', { max: '1', value: '0', style: 'width:100%;height:10px;accent-color:var(--pine)', hidden: true });
  const area = h('textarea', { rows: '7', placeholder: ocrOk ? '识别出的文字会出现在这里，可以修改后重新解析' : '把从图片里提取的文字粘贴到这里', 'aria-label': '图片中的文字', style: 'min-height:150px' });
  const err = h('div', { class: 'err', role: 'alert' });
  let lastLines = null;

  const sheet = openSheet({
    title: '图片导入',
    onClose: () => URL.revokeObjectURL(url),
    body: h(
      'div',
      { class: 'stack' },
      h('img', { class: 'thumb', src: url, alt: '你选择的图片' }),
      status,
      bar,
      h('div', { class: 'field' }, h('label', {}, ocrOk ? '识别结果（可修改）' : '图片里的文字'), area),
      err,
    ),
    footer: button('解析并预览', () => {
      err.textContent = '';
      const useLines = lastLines && area.value.trim() === lastLines.map((l) => l.text).join('\n').trim();
      const r = previewFromText(ctx, useLines ? lastLines : area.value, { kind: 'image', imageFile: file });
      if (!r.ok) err.textContent = r.message;
    }, { block: true }),
  });

  const runOcr = async () => {
    status.replaceChildren(h('p', { class: 'small' }, '正在这台手机上识别文字，图片不会上传。第一次可能要几十秒。'));
    bar.hidden = false;
    try {
      const lines = await recognizeImage(file, { onProgress: (p, t) => { bar.value = p; bar.title = t; status.firstChild.textContent = `${t}（图片不会上传）`; } });
      bar.hidden = true;
      if (!lines.length) {
        status.replaceChildren(noteBox('warn', '没有识别出文字。可以换一张更清晰的图，或者用系统自带的提取文字功能后粘贴到下面。'));
        return;
      }
      lastLines = lines;
      area.value = lines.map((l) => l.text).join('\n');
      status.replaceChildren(noteBox('info', '识别完成。识别可能有误，请在预览页对照原图逐项核对。'));
      const r = previewFromText(ctx, lines, { kind: 'image', imageFile: file });
      if (!r.ok) err.textContent = r.message;
    } catch (e) {
      bar.hidden = true;
      status.replaceChildren(noteBox('bad', [`识别失败：${e.message}`, h('div', { class: 'small' }, '可以用系统自带的提取文字功能，再把文字粘贴到下面。')], [button('重试', runOcr, { sm: true, kind: 'secondary' })]));
    }
  };

  if (ocrOk) {
    runOcr();
  } else {
    status.replaceChildren(
      noteBox('info', [
        h('b', {}, '这个版本没有内置本地文字识别组件'),
        h('div', { class: 'small' }, '图片不会被上传。请先用手机系统自带的功能把图里的文字提取出来，再粘贴到下面的框里：'),
        h('div', { class: 'small' }, 'iPhone：在「照片」里打开这张图，长按文字 → 全选 → 拷贝（实况文本）。'),
        h('div', { class: 'small' }, '安卓：在相册或 Google 相机/Lens 里选「提取文字 / 复制文字」。'),
      ], [button('从剪贴板粘贴', async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (t) area.value = t;
          else toast('剪贴板是空的');
        } catch {
          toast('无法读取剪贴板，请长按输入框选择「粘贴」');
        }
      }, { sm: true, kind: 'secondary' })]),
    );
  }
  return sheet;
}

/* ------------------------------ 文件 ------------------------------ */

export async function importFile(ctx, file) {
  const { store } = ctx;
  if (file.size > MAX_FILE) return alertDialog({ title: '文件太大', message: '这个文件超过 25 MB，不像是资产记录表。' });
  let bytes;
  try {
    bytes = await readBytes(file);
  } catch {
    return alertDialog({ title: '无法读取这个文件', message: '请确认文件还在，并且有读取权限。' });
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let kind;
  let rows;
  let text = null;
  try {
    if (isZip || ext === 'xlsx') {
      kind = 'xlsx';
      rows = (await readXlsx(bytes)).rows;
    } else if (ext === 'xls') {
      return alertDialog({ title: '不支持旧版 .xls', message: '请在 Excel 里把它「另存为」.xlsx 或 CSV 后再导入。' });
    } else {
      kind = 'csv';
      text = decodeBytes(bytes).text;
      rows = parseCSV(text);
    }
  } catch (e) {
    return alertDialog({ title: '无法读取这个文件', message: e.message });
  }
  const table = parseTable(rows, store.state.categories);
  if (!table.ok) {
    if (text) {
      const parsed = parseTextRecords(text);
      if (parsed.records.length) return void openImportPreview(ctx, draftFromText(parsed, { kind: 'text', fileName: file.name }));
    }
    return alertDialog({ title: '无法识别这个文件', message: `${table.error} 建议先下载「导入模板」，按模板填写。` });
  }
  if (table.rows.length === 0) return alertDialog({ title: '文件里没有数据', message: '找到了表头，但下面没有记录。' });
  openImportPreview(ctx, draftFromTable(table, { kind, fileName: file.name }));
}

export async function startFileImport(ctx) {
  const file = await pickFile('.csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (file) await importFile(ctx, file);
}

export async function startImageImport(ctx) {
  const file = await pickFile('image/*');
  if (file) await openImageImport(ctx, file);
}

/* ------------------------------ 模板 ------------------------------ */

export function openTemplates(ctx) {
  const { store } = ctx;
  const cats = store.state.categories;
  return openSheet({
    title: '导入模板',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted small' }, '模板的列名来自你现在的类别名称。填好后，用「CSV / Excel 文件」导入。'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, button('下载 Excel 模板', async () => {
        const r = await saveFile('资产账本-导入模板.xlsx', templateXlsx(cats), MIME.xlsx);
        if (r !== 'cancelled') toast(r === 'shared' ? '已打开分享面板' : '已下载');
      }, { block: true, iconName: 'download' })), h('div', { class: 'grow' }, button('下载 CSV 模板', async () => {
        const r = await saveFile('资产账本-导入模板.csv', templateCSV(cats), MIME.csv);
        if (r !== 'cancelled') toast(r === 'shared' ? '已打开分享面板' : '已下载');
      }, { block: true, kind: 'secondary', iconName: 'download' }))),
      h('div', { class: 'card flat' }, h('div', { class: 'card-title' }, '填写说明'), ...TEMPLATE_HELP.slice(2).map((t) => h('p', { class: 'small', style: 'margin:4px 0' }, t))),
    ),
  });
}

/* ------------------------------ 页面 ------------------------------ */

export function buildImport(ctx) {
  const root = h('div', {});
  const ocrNote = h('span', { class: 'meta' }, '识别截图 / 照片里的文字');
  const item = (iconName, title, meta, onClick) =>
    h('button', { type: 'button', class: 'item', onClick }, h('span', { class: 'glyph', style: 'width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--pine-soft);color:var(--pine-text);flex:none' }, iconEl(iconName)), h('span', { class: 'grow' }, h('div', { class: 'title' }, title), meta), iconEl('chevronR', 18));
  root.append(
    h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '导入')),
    noteBox('info', ['导入不会直接写入账本。', h('div', { class: 'small' }, '无论从哪里导入，都会先进入预览页，让你确认单位、年份、类别对应和每个金额。图片和文件只在这台手机上处理，不会上传。')]),
    h(
      'div',
      { class: 'list', style: 'margin-top:16px' },
      item('image', '相册图片', ocrNote, () => startImageImport(ctx)),
      item('clipboard', '粘贴文本', h('span', { class: 'meta' }, '粘贴备忘录里的记录'), () => openTextImport(ctx)),
      item('file', 'CSV / Excel 文件', h('span', { class: 'meta' }, '.csv  .xlsx'), () => startFileImport(ctx)),
      item('table', '下载导入模板', h('span', { class: 'meta' }, '按模板填写，导入最省心'), () => openTemplates(ctx)),
    ),
  );
  isOcrAvailable().then((ok) => {
    ocrNote.textContent = ok ? '在本机识别截图 / 照片里的文字，不上传' : '先用系统「提取文字」再粘贴（本版本未内置识别组件）';
  });
  return { el: root, destroy() {} };
}

import { icon as iconEl } from '../dom.js';

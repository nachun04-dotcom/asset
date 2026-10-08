// 文本记录解析：把「7月28资产记录：12.3+4.5+2.1+0.8=19.7」这类文字拆成结构化的行。
// 解析器只做「照原文拆分」，绝不推断：
//   - 不判断数字属于哪个类别（位置不等于类别）
//   - 不判断单位（万元/元）
//   - 不补全缺失的年份
// 这些都留给预览校对页由用户确认。

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const CHAIN_RE = new RegExp(String.raw`(${NUM}(?:\s*\+\s*${NUM})+)(?:\s*=\s*(${NUM}))?`);
const SINGLE_EQ_RE = new RegExp(String.raw`(${NUM})\s*=\s*(${NUM})`);
const THOUSANDS_OK = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

const DATE_PATTERNS = [
  { re: /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:\s*[日号])?/, parts: ['y', 'm', 'd'] },
  { re: /^(\d{1,2})\s*月\s*(\d{1,2})(?:\s*[日号])?/, parts: ['m', 'd'] },
  { re: /^(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/, parts: ['m', 'd'] },
];

export function normalizeLine(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/➕/g, '+')
    .replace(/[−–—]/g, '-')
    .replace(/ /g, ' ');
}

/** OCR 常见的误识别修正。每一处修正都会被记录并在预览页提示，用户必须看到。 */
export function applyOcrFixups(text) {
  const fixups = [];
  let out = text.replace(/(?<=[\d.])\s*十\s*(?=\d)/g, () => {
    fixups.push({ from: '十', to: '+' });
    return '+';
  });
  out = out.replace(/(?<=\d)[。·・](?=\d)/g, (m) => {
    fixups.push({ from: m, to: '.' });
    return '.';
  });
  out = out.replace(/(?<=\d),(?=\d{1,2}(?!\d))/g, () => {
    fixups.push({ from: ',', to: '.' });
    return '.';
  });
  return { text: out, fixups };
}

export function matchDate(s) {
  for (const { re, parts } of DATE_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    // 日期后面紧跟数字、小数点、加号、等号，说明其实是个算式而不是日期（如 1.5+2.5=4）
    if (/^[\d.+=\-/]/.test(s.slice(m[0].length))) continue;
    const v = {};
    parts.forEach((p, i) => (v[p] = Number(m[i + 1])));
    return { year: v.y ?? null, month: v.m, day: v.d, length: m[0].length, text: m[0].trim() };
  }
  return null;
}

function stripDecor(s) {
  return s.replace(/^[\s*＊•·\-–—>#]+/, '').replace(/[\s*＊]+$/, '').trim();
}

const META_TITLE_RE = /^(标题|无标题|未命名|备忘录)$/;
const META_STATUS_RE = /^\d{1,2}月\d{1,2}日.*\d+\s*字$/;
const TIME_ONLY_RE = /\d{1,2}:\d{2}/;

function wordConfidence(words, raw, threshold) {
  if (!words?.length) return { conf: null, low: false };
  let min = null;
  for (const w of words) {
    const t = normalizeLine(w.text).replace(/\s/g, '');
    if (t.includes(raw) || t.replace(/,/g, '').includes(raw.replace(/,/g, ''))) {
      const c = Number(w.confidence);
      if (Number.isFinite(c)) min = min == null ? c : Math.min(min, c);
    }
  }
  return { conf: min, low: min != null && min < threshold };
}

/**
 * @param {string | Array<{text:string, words?:Array<{text:string, confidence:number}>}>} input
 * @param {{ocr?:boolean, lowConfidence?:number}} opts
 */
export function parseTextRecords(input, opts = {}) {
  const { ocr = false, lowConfidence = 80 } = opts;
  const lines = Array.isArray(input)
    ? input.map((l) => (typeof l === 'string' ? { text: l } : l))
    : String(input ?? '').split(/\r?\n/).map((text) => ({ text }));

  const result = { headerLabels: null, records: [], looseNotes: [], unparsed: [], ignored: [] };
  let last = null;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const original = String(line.text ?? '');
    let text = normalizeLine(original).trim();
    if (!text) return;

    let fixups = [];
    if (ocr) {
      const fx = applyOcrFixups(text);
      text = fx.text;
      fixups = fx.fixups;
    }
    const core = stripDecor(text);
    if (!core) return;

    if (META_TITLE_RE.test(core) || META_STATUS_RE.test(core)) {
      result.ignored.push({ lineNo, text: original.trim(), reason: '备忘录标题或状态栏' });
      return;
    }

    // 类别表头：「支付宝+微信+货款+币安+银行卡」——没有数字、用加号连接的名称
    if (!/\d/.test(core) && core.includes('+')) {
      const parts = core.split('+').map((p) => p.trim());
      if (parts.length >= 2 && parts.every((p) => p.length >= 1 && p.length <= 10)) {
        if (!result.headerLabels) result.headerLabels = parts;
        else result.ignored.push({ lineNo, text: original.trim(), reason: '重复的类别表头' });
        return;
      }
    }

    const date = matchDate(core);
    if (date) {
      const rest = core.slice(date.length);
      let m = CHAIN_RE.exec(rest);
      let tokens;
      let totalTok = null;
      if (m) {
        tokens = m[1].split('+').map((t) => t.trim());
        totalTok = m[2] ?? null;
      } else if ((m = SINGLE_EQ_RE.exec(rest))) {
        tokens = [m[1]];
        totalTok = m[2];
      }
      if (tokens) {
        const label = rest.slice(0, m.index).replace(/[\s:：,，。]+$/g, '').trim();
        const trailing = rest.slice(m.index + m[0].length).replace(/^[\s:：,，。;；]+/, '').trim();
        const words = line.words ?? null;
        const values = tokens.map((raw) => {
          const { conf, low } = wordConfidence(words, raw, lowConfidence);
          return { raw: raw.replace(/\s/g, ''), bad: !THOUSANDS_OK.test(raw), conf, lowConf: low };
        });
        const rec = {
          lineNo,
          raw: original.trim(),
          year: date.year,
          month: date.month,
          day: date.day,
          dateText: date.text,
          labelText: label,
          values,
          statedTotalRaw: totalTok ? totalTok.replace(/\s/g, '') : null,
          notes: trailing ? [trailing] : [],
          fixups,
        };
        result.records.push(rec);
        last = rec;
        return;
      }
      if (TIME_ONLY_RE.test(core) && !/[=+]/.test(core)) {
        result.ignored.push({ lineNo, text: original.trim(), reason: '时间戳' });
        return;
      }
      if (/\d/.test(rest)) {
        result.unparsed.push({ lineNo, text: original.trim(), reason: '以日期开头，但没有找到「数+数=合计」形式的金额' });
        return;
      }
    }

    // 其余文字：当作备注，挂在它上面最近的一条记录下（预览页可以改）
    // 备注保留原文（不做全角/半角归一化），只去掉首尾的 * 等装饰符号
    const noteText = stripDecor(original.replace(/\u00a0/g, ' ')) || core;
    if (last) last.notes.push(noteText);
    else result.looseNotes.push({ lineNo, text: noteText });
  });

  return result;
}

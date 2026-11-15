#!/usr/bin/env node
/**
 * textcheck.cjs — 繁體中文稿件的一次性體檢。
 *
 * 為什麼要有這支：我（Cier）每一輪都要手動跑四個檢查（簡體、引號、粗體、空行），
 * 四個 PowerShell 區塊拼起來，跑完才敢動檔案。2026-11-15 一天之內，同一種內層引號
 * 的錯在四個地方各犯一次，每一次都是自己掃到再改。檢查有效，但它不該靠我記得。
 *
 * 用法：
 *   node .cier/tools/textcheck.cjs 檔案1.md 檔案2.md
 *   node .cier/tools/textcheck.cjs --dir .cier/notes/reading
 *
 * 檢查五種東西：
 *   1. 簡體字（含已查證的 Big5 假陽性白名單）
 *   2. 引號不平衡（「」、『』各算一組）
 *   3. 粗體記號不平衡（一行裡 ** 出現奇數次）
 *   4. 連續兩個以上空白行
 *   5. 中文句子裡混進半形標點（, . : ; ! ?）
 *
 * 有問題 exit 1，全部乾淨 exit 0。位置一律是「行：欄」。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const TABLE = path.join(__dirname, 'st-characters.txt');

let TABLE_MAP = null;
function table() {
  if (TABLE_MAP) return TABLE_MAP;
  TABLE_MAP = new Map();
  const raw = fs.readFileSync(TABLE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const simp = line.slice(0, tab).trim();
    const targs = line.slice(tab + 1).trim().split(/\s+/).filter(Boolean);
    if (!simp || targs.length === 0) continue;
    // 候選裡有自己 → 繁體也這樣寫，不報
    if (targs.includes(simp)) continue;
    TABLE_MAP.set(simp, targs);
  }
  return TABLE_MAP;
}

function check(text) {
  const map = table();
  const hits = [];
  let index = 0;
  for (const ch of text) {
    index += 1;
    if (ch < '\u3400' || ch > '\u9fff') continue;
    const targs = map.get(ch);
    if (!targs) continue;
    hits.push({ position: index, char: ch, traditional: targs.join(' / ') });
  }
  return hits;
}

// 已查證的 Big5 假陽性：OpenCC 把這四個字對到 羣/祕/牀/峯，但那四個字不在 Big5，
// 所以 群/秘/床/峰 是台灣標準寫法。掃到它們不算錯。
const FALSE_POSITIVE = new Set([
  String.fromCodePoint(0x7fa4), // 群
  String.fromCodePoint(0x79d8), // 秘
  String.fromCodePoint(0x5e8a), // 床
  String.fromCodePoint(0x5cf0), // 峰
]);

const STRICT_INNER = process.argv.includes('--strict-inner');
const HALF_PUNCT = new Set([',', '.', ':', ';', '!', '?']);
const CJK = /[\u3400-\u9fff]/;

function isCjk(ch) {
  return !!ch && CJK.test(ch);
}

function countOf(line, ch) {
  let n = 0;
  for (const c of line) if (c === ch) n += 1;
  return n;
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const report = {
    file,
    lines: lines.length,
    simplified: [],
    quotes: [],
    bold: [],
    halfPunct: [],
    blankRun: 0,
  };

  let blankStreak = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const no = i + 1;

    if (line.trim() === '') {
      blankStreak += 1;
      if (blankStreak === 2) report.blankRun += 1;
    } else {
      blankStreak = 0;
    }

    // 1. 簡體字
    for (const hit of check(line)) {
      if (FALSE_POSITIVE.has(hit.char)) continue;
      report.simplified.push({ no, col: hit.position, char: hit.char, to: hit.traditional });
    }

    // 2. 引號
    const open = countOf(line, '\u300c');
    const close = countOf(line, '\u300d');
    if (open !== close) report.quotes.push({ no, open, close, line });

    const innerOpen = countOf(line, '\u300e');
    const innerClose = countOf(line, '\u300f');
    if (innerOpen !== innerClose || (STRICT_INNER && innerOpen > 0)) {
      report.innerQuoteCount = (report.innerQuoteCount || 0) + innerOpen + innerClose;
      report.innerQuoteLines = report.innerQuoteLines || [];
      report.innerQuoteLines.push(no);
    }

    // 3. 粗體（先把行內程式碼去掉，裡面的星號不算）
    const isComment = /^\s*(\*|\/\*\*|\/\/)/.test(line);
    const stripped = isComment ? '' : line.replace(/`[^`]*`/g, '');
    const boldPairs = (stripped.match(/\*\*/g) || []).length;
    const singles = countOf(stripped.replace(/\*\*/g, ''), '*');
    if (boldPairs % 2 !== 0 || singles % 2 !== 0) {
      report.bold.push({ no, pairs: boldPairs, singles });
    }

    // 4. 半形標點夾在中文裡
    const chars = [...line];
    for (let k = 0; k < chars.length; k += 1) {
      if (!HALF_PUNCT.has(chars[k])) continue;
      if (isCjk(chars[k - 1]) && isCjk(chars[k + 1])) {
        report.halfPunct.push({ no, col: k + 1, char: chars[k] });
      }
    }
  }

  return report;
}

function format(report) {
  const out = [];
  const name = path.basename(report.file);
  const problems =
    report.simplified.length + report.quotes.length + report.bold.length +
    report.halfPunct.length + report.blankRun;

  out.push(`=== ${name}（${report.lines} 行）===`);
  if (problems === 0 && !report.innerQuoteCount) {
    out.push('  全部通過');
    out.push('');
    return out.join('\n');
  }

  if (report.simplified.length) {
    out.push(`  簡體字 ${report.simplified.length} 處`);
    for (const h of report.simplified) {
      out.push(`    L${h.no}:${h.col}  ${h.char} → ${h.to}`);
    }
  }
  if (report.quotes.length) {
    out.push(`  引號不平衡 ${report.quotes.length} 行`);
    for (const q of report.quotes) {
      out.push(`    L${q.no}  「${q.open} 」${q.close}`);
    }
  }
  if (report.innerQuoteCount) {
    const shownLines = report.innerQuoteLines.slice(0, 10).map((n) => `L${n}`).join(', ');
    const moreLines = report.innerQuoteLines.length > 10 ? ` 等 ${report.innerQuoteLines.length} 行` : '';
    out.push(`  內層引號（『』）${report.innerQuoteCount} 個，在 ${shownLines}${moreLines}`);
  }
  if (report.bold.length) {
    out.push(`  粗體不平衡 ${report.bold.length} 行`);
    for (const b of report.bold) {
      out.push(`    L${b.no}  ** ${b.pairs} 組、單星 ${b.singles} 個`);
    }
  }
  if (report.halfPunct.length) {
    out.push(`  中文裡混半形標點 ${report.halfPunct.length} 處`);
    for (const p of report.halfPunct.slice(0, 20)) {
      out.push(`    L${p.no}:${p.col}  ${p.char}`);
    }
    if (report.halfPunct.length > 20) out.push(`    ……還有 ${report.halfPunct.length - 20} 處`);
  }
  if (report.blankRun) out.push(`  連續空白行 ${report.blankRun} 處`);
  out.push('');
  return out.join('\n');
}

function collectFiles(args) {
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') {
      const dir = args[i + 1];
      i += 1;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.(md|txt)$/i.test(name)) continue;
        // st-characters.txt 是簡體字表本身，掃它一定是滿江紅
        if (name === 'st-characters.txt') continue;
        files.push(path.join(dir, name));
      }
    } else if (!args[i].startsWith('--')) {
      files.push(args[i]);
    }
  }
  return files;
}

if (require.main === module) {
  const files = collectFiles(process.argv.slice(2));
  if (files.length === 0) {
    console.log('用法：node textcheck.cjs 檔案.md [檔案2.md ...] 或 --dir 目錄');
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    let report;
    try {
      report = checkFile(file);
    } catch (error) {
      console.log(`=== ${path.basename(file)} ===`);
      console.log(`  讀取失敗：${error.message}`);
      total += 1;
      continue;
    }
    process.stdout.write(format(report));
    total +=
      report.simplified.length + report.quotes.length + report.bold.length +
      report.halfPunct.length + report.blankRun + (report.innerQuoteCount || 0);
  }
  if (files.length > 1) console.log(`合計 ${total} 個問題，檢查 ${files.length} 個檔案`);
  process.exit(total === 0 ? 0 : 1);
}

module.exports = { checkFile };

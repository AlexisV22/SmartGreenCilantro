#!/usr/bin/env node
'use strict';

/**
 * Verifies the evidence of Sprints 2-4 and writes the per-sprint indexes.
 *
 * For every task of the catalog: the document exists with the exact name, is
 * not empty, contains the text of each of its completion conditions, and its
 * attached files are not empty. Conditions marked "pending team input" are
 * reported separately. Writes evidence/Sprint N/Evidence/EVIDENCE_INDEX_Sprint_N
 * (.docx and .md) and prints the final report. Exit code 1 if anything is missing.
 *
 *   node tools/evidence/check_evidence.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');
const { catalog, dirOf, EVIDENCE } = require("./lib");
const { dataTable, h1, para, run, MAROON } = require('./build_docs');

function docxText(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(ptr + 10);
    const csize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const off = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString();
    if (name === 'word/document.xml') {
      const ln = buf.readUInt16LE(off + 26);
      const le = buf.readUInt16LE(off + 28);
      const data = buf.slice(off + 30 + ln + le, off + 30 + ln + le + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return '';
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function checkTask(t) {
  const problems = [];
  const pending = [];
  const dir = dirOf(t);
  const docs = [t.file];
  if (t.id === 'US08-T1' && t.sprint === 2) docs.push('US08-T1_API_Specification_SmartGreenAI_Verification.docx');
  for (const d of docs) {
    const file = path.join(dir, d);
    if (!fs.existsSync(file)) { problems.push(`missing ${d}`); continue; }
    if (fs.statSync(file).size < 2000) problems.push(`${d} is empty`);
  }
  // The conditions must be in the evidence document (for US08-T1: in the verification appendix).
  const condDoc = path.join(dir, docs[docs.length - 1]);
  if (fs.existsSync(condDoc)) {
    const text = norm(docxText(condDoc));
    t.conditions.forEach((c, i) => {
      if (!text.includes(norm(c).slice(0, 60))) problems.push(`condition ${i + 1} not found in the document`);
      if (text.includes(`Condition ${i + 1} (pending team input)`)) pending.push(`condition ${i + 1}`);
    });
    if (/No proof registered for this condition/.test(text)) problems.push('a condition has no proof');
    if (/Collector error/.test(text)) problems.push('collector error recorded in the document');
  }
  const attachments = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${t.base}_`) && !f.endsWith('.docx')) : [];
  for (const a of attachments) if (fs.statSync(path.join(dir, a)).size === 0) problems.push(`empty attachment ${a}`);
  return { problems, pending, attachments };
}

async function writeIndex(sprint, results) {
  const rows = results.map(({ t, r }) => [t.id, t.title, t.responsible, `${t.folder}/${t.file}`, String(r.attachments.length), r.problems.length ? 'MISSING' : r.pending.length ? `Done (${r.pending.join(', ')} pending team input)` : 'Done']);
  const dir = path.join(EVIDENCE, `Sprint ${sprint}`, 'Evidence');
  fs.mkdirSync(dir, { recursive: true });
  const md = [`# Evidence index — Sprint ${sprint}`, '', `SmartGreenAI: Cilantro Crop · generated ${new Date().toISOString()} by tools/evidence/check_evidence.js`, '',
    '| Task | Title | Responsible | Evidence file | Attachments | Status |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`), ''].join('\n');
  fs.writeFileSync(path.join(dir, `EVIDENCE_INDEX_Sprint_${sprint}.md`), md);
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [run('[ Insert official UPAEP logo ]', { italics: true, color: '5F6368', size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [run('UPAEP · Decanato de Ingenierías', { bold: true, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: `EVIDENCE INDEX — SPRINT ${sprint}`, bold: true, size: 36, color: MAROON, font: 'Arial' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run('SmartGreenAI: Cilantro Crop', { size: 22, color: '5F6368' })] }),
        h1('Evidence documents'),
        para(`${rows.length} tasks · ${rows.filter((r) => r[5].startsWith('Done')).length} with complete evidence · generated ${new Date().toUTCString()}.`),
        dataTable(['Task', 'Title', 'Responsible', 'Evidence file', 'Files', 'Status'], rows, [900, 2300, 1500, 2860, 600, 1200]),
      ],
    }],
  });
  fs.writeFileSync(path.join(dir, `EVIDENCE_INDEX_Sprint_${sprint}.docx`), await Packer.toBuffer(doc));
}

async function main() {
  let missing = 0;
  const pendingAll = [];
  console.log('Evidence check — SmartGreenAI: Cilantro Crop\n');
  for (const sprint of [2, 3, 4]) {
    const tasks = catalog.tasks.filter((t) => t.sprint === sprint);
    const results = tasks.map((t) => ({ t, r: checkTask(t) }));
    await writeIndex(sprint, results);
    const ok = results.filter(({ r }) => !r.problems.length).length;
    const files = results.reduce((s, { r }) => s + r.attachments.length, 0);
    console.log(`Sprint ${sprint}: ${ok}/${tasks.length} documents complete · ${files} attached files · index written`);
    for (const { t, r } of results) {
      if (r.problems.length) { missing += 1; console.log(`   ✖ ${t.id} ${t.file}: ${r.problems.join('; ')}`); }
      if (r.pending.length) pendingAll.push(`Sprint ${sprint} ${t.id}: ${r.pending.join(', ')}`);
    }
  }
  if (pendingAll.length) {
    console.log('\nConditions that need input from the team (not faked, marked in the documents):');
    pendingAll.forEach((p) => console.log(`   ⚠ ${p}`));
  }
  console.log(missing ? `\n✖ ${missing} document(s) missing or incomplete` : `\n✔ All ${catalog.tasks.length} evidence documents present and complete`);
  process.exitCode = missing ? 1 : 0;
}

if (require.main === module) main();
module.exports = { docxText, checkTask };

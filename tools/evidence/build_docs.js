#!/usr/bin/env node
'use strict';

/**
 * Builds every evidence .docx from the manifests in tools/evidence/manifests.
 *
 *   node tools/evidence/build_docs.js            # all tasks with a manifest entry
 *   node tools/evidence/build_docs.js 2:US01C-T1  # one task
 *
 * Style of the team documents: Arial, maroon #9E1B32 headings, light-pink key
 * cells #F6E8EA, Letter size.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  AlignmentType, ImageRun, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber,
} = require('docx');

const { catalog, dirOf, EVIDENCE, ROOT } = require('./lib');

const MAROON = '9E1B32';
const PINK = 'F6E8EA';
const GREY = '5F6368';
const CONTENT_WIDTH = 9360; // twips (6.5 in)
const MAX_IMG_PX = 620;

const PO = 'Alexis Enrique Valle Parra';

// ---------------------------------------------------------------------------
// Traceability: rows of docs/TRACEABILITY.md keyed by task id and sprint
// ---------------------------------------------------------------------------
// Sprint 3 rows of TRACEABILITY.md use the original 28-task numbering; the
// evidence uses the Scrum-board numbering (board_sprint3.js), except in the
// subsection written in board numbering.
const { OLD_TO_NEW } = require('./board_sprint3');

function loadTraceability() {
  const md = fs.readFileSync(path.join(ROOT, 'docs/TRACEABILITY.md'), 'utf8');
  const out = {};
  let sprint = null;
  let boardNumbering = false;
  for (const line of md.split(/\r?\n/)) {
    const s = line.match(/^## Sprint (\d)/);
    if (s) { sprint = Number(s[1]); boardNumbering = false; continue; }
    if (line.startsWith('## Functional')) sprint = null;
    if (line.startsWith('### ')) boardNumbering = /board numbering/i.test(line);
    const row = line.match(/^\| (US\d{2}C?-T\d+|SPR-T\d+) [^|]*\| (.+?) \| (.+?) \|$/);
    if (!row || !sprint) continue;
    const id = sprint === 3 && !boardNumbering ? (OLD_TO_NEW[row[1]] || row[1]) : row[1];
    out[`${sprint}:${id}`] = { implementation: row[2], verification: row[3] };
  }
  return out;
}
const TRACE = loadTraceability();

const STORY_REQ = {
  'US-01-C': 'FR-01, FR-02, FR-03, NFR-03, NFR-04',
  'US-06': 'FR-05, FR-24, NFR-05, NFR-08, NFR-09',
  'US-07': 'FR-06, FR-07, FR-08, FR-20, NFR-05',
  'US-08': 'FR-24, NFR-04, NFR-07, NFR-09',
  'US-10': 'FR-12, NFR-06',
  'US-14': 'FR-16, NFR-06',
  'US-25': 'FR-05, FR-06, FR-07, NFR-02, NFR-09',
  'US-11': 'FR-12, FR-13, FR-22',
  'US-12': 'FR-14',
  'US-13': 'FR-15, FR-22',
  'US-15': 'FR-16, FR-17',
  'US-16': 'FR-18, NFR-08',
  'US-17': 'FR-19, FR-23',
  'US-19': 'FR-27, NFR-08',
  'US-18': 'FR-20, FR-25, FR-26',
  'US-20': 'FR-28, FR-30',
  'US-21': 'FR-29, NFR-06',
  'US-26': 'FR-17, FR-28',
  'US-27': 'FR-09, FR-10, FR-11, FR-16, NFR-01, NFR-06',
  'US-28': 'FR-01 … FR-30, NFR-01 … NFR-09',
  Sprint: 'All requirements of the sprint',
};

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------
const run = (text, opts = {}) => new TextRun({ text: String(text ?? ''), font: 'Arial', size: opts.size || 20, ...opts });
const para = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [run(children)], spacing: { after: 120 }, ...opts });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 }, children: [run(text, { bold: true, size: 28, color: MAROON })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, children: [run(text, { bold: true, size: 24, color: MAROON })] });
const h3 = (text) => new Paragraph({ spacing: { before: 160, after: 80 }, children: [run(text, { bold: true, size: 21, color: MAROON })] });

function cellP(text, opts = {}) {
  const lines = String(text ?? '').split('\n');
  return lines.map((l) => new Paragraph({ spacing: { after: 20 }, children: [run(l, { size: opts.size || 17, bold: opts.bold, color: opts.color })] }));
}

function keyValueTable(rows) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2700, CONTENT_WIDTH - 2700],
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        new TableCell({ width: { size: 2700, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: PINK, color: 'auto' }, children: cellP(k, { bold: true, size: 19 }) }),
        new TableCell({ width: { size: CONTENT_WIDTH - 2700, type: WidthType.DXA }, children: cellP(v, { size: 19 }) }),
      ],
    })),
  });
}

function dataTable(columns, rows, widths = null) {
  const n = columns.length;
  const w = widths || columns.map(() => Math.floor(CONTENT_WIDTH / n));
  const size = n > 6 ? 14 : n > 4 ? 16 : 17;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: w,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c, i) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: MAROON, color: 'auto' }, children: cellP(c, { bold: true, color: 'FFFFFF', size }) })) }),
      ...rows.map((r) => new TableRow({ children: columns.map((_, i) => {
        const v = r[i] === undefined || r[i] === null ? '' : String(r[i]);
        const fill = v === 'PASS' ? 'E7F4E8' : v === 'FAIL' ? 'FDECEA' : undefined;
        return new TableCell({ width: { size: w[i], type: WidthType.DXA }, shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined, children: cellP(v, { size, bold: v === 'PASS' || v === 'FAIL' }) });
      }) })),
    ],
  });
}

function mono(content, maxLines = 60) {
  let lines = String(content).split('\n');
  if (lines.length > maxLines) lines = [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'F5F6F7', color: 'auto' },
      children: [new Paragraph({ children: lines.flatMap((l, i) => [new TextRun({ text: l.replace(/\t/g, '  ') || ' ', font: 'Consolas', size: 15, break: i ? 1 : 0 })]) })],
    })] })],
  });
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), data: b };
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------
function renderProofs(t, proofs, fig) {
  const out = [];
  for (const p of proofs || []) {
    if (!p) continue;
    if (p.type === 'heading') out.push(p.level === 3 ? h3(p.content) : h2(p.content));
    else if (p.type === 'text') out.push(para(p.content));
    else if (p.type === 'list') p.items.forEach((i) => out.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [run(i, { size: 19 })] })));
    else if (p.type === 'image') {
      const file = path.join(dirOf(t), p.file);
      if (!fs.existsSync(file)) { out.push(para(`[missing image ${p.file}]`)); continue; }
      const { width, height, data } = pngSize(file);
      // Screenshots are captured at 1x; charts and diagrams at 2x.
      let w = width; let h = height;
      const maxH = 820;
      if (w > MAX_IMG_PX) { h = Math.round(h * (MAX_IMG_PX / w)); w = MAX_IMG_PX; }
      if (h > maxH) { w = Math.round(w * (maxH / h)); h = maxH; }
      fig.n += 1;
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 }, children: [new ImageRun({ type: 'png', data, transformation: { width: w, height: h } })] }));
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(`Figure ${t.id}-${fig.n}. ${p.caption}`, { italics: true, size: 17, color: GREY }), run(`  (${p.file})`, { size: 15, color: GREY })] }));
    } else if (p.type === 'code') {
      out.push(para([run(`${p.path}`, { bold: true, size: 17 }), run(` — lines ${p.startLine}–${p.endLine}`, { size: 17, color: GREY })], { spacing: { before: 80, after: 40 } }));
      out.push(mono(p.content, 32));
      out.push(para(''));
    } else if (p.type === 'block') {
      if (p.title) out.push(para([run(p.title, { bold: true, size: 18 }), p.file ? run(`  (attached: ${p.file})`, { size: 16, color: GREY }) : run('')], { spacing: { before: 80, after: 40 } }));
      out.push(mono(p.content, p.maxLines || 70));
      out.push(para(''));
    } else if (p.type === 'table') {
      if (p.title) out.push(para([run(p.title, { bold: true, size: 18 })], { spacing: { before: 80, after: 40 } }));
      out.push(dataTable(p.columns, p.rows, p.widths));
      if (p.note) out.push(para([run(p.note, { size: 15, color: GREY, italics: true })], { spacing: { before: 40, after: 120 } }));
      else out.push(para(''));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
function attachedFiles(t) {
  if (!fs.existsSync(dirOf(t))) return [];
  return fs.readdirSync(dirOf(t))
    .filter((f) => f.startsWith(`${t.base}_`) && !f.endsWith('.docx'))
    .sort((a, b) => Number(a.match(/_(\d+)\.[^.]+$/)?.[1] || 0) - Number(b.match(/_(\d+)\.[^.]+$/)?.[1] || 0));
}

function buildDoc(t, m) {
  const fig = { n: 0 };
  const children = [];
  const header = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run('[ Insert official UPAEP logo ]', { italics: true, color: GREY, size: 18 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run('UPAEP · Decanato de Ingenierías', { bold: true, size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`EVIDENCE — ${t.id}`, { bold: true, size: 36, color: MAROON })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [run(m.docTitle || t.title, { bold: true, size: 26 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run('SmartGreenAI: Cilantro Crop', { size: 22, color: GREY })] }),
  ];
  children.push(...header);

  let n = 1;
  children.push(h1(`${n++}. Task information`));
  children.push(keyValueTable([
    ['Task ID', t.id],
    ['User Story', t.story === 'Sprint' ? 'Sprint-level task' : `${t.story} — ${t.storyTitle}`],
    ['Sprint', `Sprint ${t.sprint} (${catalog.sprints[t.sprint].start} – ${catalog.sprints[t.sprint].end})`],
    ['Week', t.weekLabel || `Week ${t.week}`],
    ['Responsible', t.responsible],
    ['Peer reviewer', t.reviewer || (t.story === 'Sprint' ? 'Whole team' : '—')],
    ['Planned / actual hours', t.hours ? `${t.plannedHours} h / ${t.hours} h${t.plannedHours !== t.hours ? ` (variance recorded in the ${t.sprint === 3 ? 'Sprint 3 burndown' : 'Sprint Review'})` : ''}${t.sprint === 2 && t.id === 'SPR-T1' ? ' (2 h per member)' : ''}${t.sprint === 2 && t.id === 'SPR-T2' ? ' (1 h Jorge, 1 h Alexis)' : ''}` : 'Sprint-level task (not estimated in hours)'],
    ['Completed on', t.completed],
    ['Status', 'Done'],
  ]));

  children.push(h1(`${n++}. Task description`));
  children.push(para(t.what));
  if (t.note) children.push(para([run('Note: ', { bold: true }), run(t.note)]));

  for (const s of m.sections || []) {
    if (s.level === 1) children.push(h1(`${n++}. ${s.title}`));
    else children.push(h2(s.title));
    children.push(...renderProofs(t, s.proofs, fig));
  }

  children.push(h1(`${n++}. Completion conditions`));
  t.conditions.forEach((text, i) => {
    const c = (m.conditions || [])[i];
    if (c && c.pending) {
      children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [run(`⚠ Condition ${i + 1} (pending team input): ${text}`, { bold: true, size: 21, color: 'B26A00' })] }));
      children.push(para([run('Pending: ', { bold: true, color: 'B26A00' }), run(c.pending)]));
    } else {
      children.push(h3(`✓ Condition ${i + 1}: ${text}`));
    }
    if (!c) { children.push(para([run('No proof registered for this condition.', { bold: true, color: 'C62828' })])); return; }
    children.push(para([run('How it was verified: ', { bold: true }), run(c.how)]));
    children.push(...renderProofs(t, c.proofs, fig));
  });

  if (m.testCases && m.testCases.rows.length) {
    const rows = m.testCases.rows;
    children.push(h1(`${n++}. ${m.testCases.title}`));
    children.push(dataTable(
      ['ID', 'Case', 'Steps', 'Input', 'Expected', 'Actual', 'Result'],
      rows.map((r) => [r.id, r.case, r.steps, r.input, r.expected, r.actual, r.result]),
      [700, 1350, 1700, 1350, 1600, 1760, 900],
    ));
    const pass = rows.filter((r) => r.result === 'PASS').length;
    children.push(para([run(`Totals: ${rows.length} cases · ${pass} PASS · ${rows.length - pass} FAIL`, { bold: true })], { spacing: { before: 100 } }));
  }

  children.push(h1(`${n++}. Attached files`));
  const files = attachedFiles(t);
  if (files.length) files.forEach((f) => children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [run(f, { size: 18 })] })));
  else children.push(para('This document is self-contained (no attached files).'));

  children.push(h1(`${n++}. Traceability`));
  const tr = TRACE[t.key];
  children.push(keyValueTable([
    ['Related requirements', STORY_REQ[t.story] || '—'],
    ['Implementation', tr ? tr.implementation.replace(/`/g, '') : 'See docs/TRACEABILITY.md'],
    ['Verification', tr ? tr.verification.replace(/`/g, '') : 'See docs/TRACEABILITY.md'],
  ]));

  if (m.notes && m.notes.length) {
    children.push(h1(`${n++}. Notes`));
    m.notes.forEach((x) => children.push(para(x)));
  }

  children.push(h1(`${n++}. Sign-off`));
  children.push(dataTable(['Role', 'Name', 'Date', 'Signature'], [
    ['Responsible', t.responsible, t.completed, ''],
    ['Peer reviewer', t.reviewer || 'Whole team', t.completed, ''],
    ['Product Owner acceptance', PO, t.completed, ''],
  ], [2400, 3300, 2000, 1660]));
  if (m.approval) children.push(para([run('Approval record: ', { bold: true }), run(m.approval)], { spacing: { before: 120 } }));

  return new Document({
    creator: 'SmartGreenAI Team 3',
    title: `EVIDENCE — ${t.id} ${t.title}`,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`SmartGreenAI: Cilantro Crop · Evidence ${t.id} · page `, { size: 15, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 15, color: GREY })] })] }) },
      children,
    }],
  });
}

async function main() {
  const manifests = {};
  const dir = path.join(__dirname, 'manifests');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
    Object.assign(manifests, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  const only = process.argv.slice(2);
  let built = 0;
  for (const t of catalog.tasks) {
    if (only.length && !only.includes(t.key) && !only.includes(t.id)) continue;
    const m = manifests[t.key];
    if (!m) continue;
    if (m.skipDoc) continue; // e.g. US08-T1 keeps the team's original document
    fs.mkdirSync(dirOf(t), { recursive: true });
    const doc = m.customDoc ? require(m.customDoc)(t, m, { buildDoc }) : buildDoc(t, m);
    fs.writeFileSync(path.join(dirOf(t), m.outFile || t.file), await Packer.toBuffer(doc));
    built += 1;
  }
  console.log(`OK  ${built} evidence document(s) built under ${path.relative(ROOT, EVIDENCE)}`);
}

module.exports = { buildDoc, renderProofs, dataTable, keyValueTable, mono, h1, h2, h3, para, run, MAROON, PINK };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

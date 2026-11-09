#!/usr/bin/env node
'use strict';

/**
 * Builds tools/evidence/catalog.json — the list of the 99 tasks of Sprints 2-4
 * with the exact evidence file names, people, hours, dates, description and
 * completion conditions — from the evidence prompt (section 5, task catalog).
 * Planned hours come from the Sprint Planning documents in docs/scrum.
 *
 *   node tools/evidence/make_catalog.js [path/to/PROMPT_2.md]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const source = process.argv[2] || path.join(ROOT, 'PROMPT_2_Generate_Evidence_Sprints_2-4.md');
const text = fs.readFileSync(source, 'utf8');

const SPRINTS = {
  2: { start: '2026-09-21', end: '2026-10-09' },
  3: { start: '2026-10-12', end: '2026-10-30' },
  4: { start: '2026-11-02', end: '2026-11-20' },
};

/** Minimal .docx text reader (the planning documents are zip files). */
function docxText(file) {
  const buf = fs.readFileSync(file);
  // Walk the zip central directory to find word/document.xml.
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(ptr + 10);
    const csize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString();
    if (name === 'word/document.xml') {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const data = buf.slice(localOffset + 30 + lNameLen + lExtraLen, localOffset + 30 + lNameLen + lExtraLen + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      return xml.replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return '';
}

/** Planned hours per task id from "<ID>\t<title>\t<responsible>\t<hours>" rows. */
function plannedHours(sprint) {
  const file = path.join(ROOT, 'docs/scrum', `Sprint ${sprint}`, `Sprint_${sprint}_Planning_SmartGreenAI_Cilantro.docx`);
  if (!fs.existsSync(file)) return {};
  // Table rows span several paragraphs: tokenise the whole text and take the
  // first small integer after each task id (the "Hours" column).
  const cells = docxText(file).split(/[\t\n]/).map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (let i = 0; i < cells.length; i += 1) {
    if (!/^(US\d{2}C?-T\d+|SPR-T\d+)$/.test(cells[i]) || out[cells[i]] !== undefined) continue;
    for (let k = i + 1; k <= i + 5 && k < cells.length; k += 1) {
      if (/^(US\d{2}C?-T\d+|SPR-T\d+)$/.test(cells[k])) break;
      if (/^\d{1,2}$/.test(cells[k])) { out[cells[i]] = Number(cells[k]); break; }
    }
  }
  return out;
}

function weekOf(sprint, dateText) {
  const d = new Date(`${dateText} 12:00 UTC`);
  const start = new Date(`${SPRINTS[sprint].start}T00:00:00Z`);
  const week = Math.floor((d - start) / (7 * 86400000)) + 1;
  return Math.max(1, Math.min(3, week));
}

const tasks = [];
let sprint = null;
let story = null;
let current = null;

for (const raw of text.split('\n')) {
  const line = raw.trimEnd();
  const sp = line.match(/^### Sprint (\d)/);
  if (sp) { sprint = Number(sp[1]); story = null; continue; }
  if (line.startsWith('## 6.')) break;
  const us = line.match(/^#### (.+?) — (.+?)\s+→\s+subfolder `([^`]+)\/`/);
  if (us) { story = { id: us[1].trim(), title: us[2].trim(), folder: us[3].trim() }; continue; }
  const sprintLevel = line.match(/^#### Sprint-level tasks\s+→\s+subfolder `([^`]+)\/`/);
  if (sprintLevel) { story = { id: 'Sprint', title: 'Sprint-level tasks', folder: sprintLevel[1] }; continue; }

  const t = line.match(/^- \*\*(\S+) — (.+?)\*\* \| File: `([^`]+)` \| Responsible: (.+?)(?: \| Reviewer: (.+?))?(?: \| Hours: (\d+))? \| Completed: (.+)$/);
  if (t && sprint) {
    current = {
      sprint,
      story: story.id,
      storyTitle: story.title,
      folder: story.folder,
      id: t[1],
      title: t[2],
      file: t[3],
      responsible: t[4].trim(),
      reviewer: t[5] ? t[5].trim() : null,
      hours: t[6] ? Number(t[6]) : null,
      completed: t[7].trim(),
      week: weekOf(sprint, t[7].trim()),
      what: '',
      note: null,
      conditions: [],
    };
    tasks.push(current);
    continue;
  }
  if (!current) continue;
  const what = line.match(/^\s+- What: (.+)$/);
  if (what) { current.what = what[1].trim(); continue; }
  const note = line.match(/^\s+- NOTE: (.+)$/);
  if (note) { current.note = note[1].trim(); continue; }
  const cond = line.match(/^\s+- Conditions: (.+)$/);
  if (cond) {
    current.conditions = cond[1].split(/\s*\(\d\)\s*/).map((c) => c.trim()).filter(Boolean);
  }
}

for (const s of [2, 3, 4]) {
  const planned = plannedHours(s);
  for (const task of tasks.filter((x) => x.sprint === s)) {
    task.plannedHours = planned[task.id] ?? task.hours;
    task.key = `${task.sprint}:${task.id}`; // SPR-T1 exists in every sprint
    task.base = task.file.replace(/\.docx$/, '');
  }
}

const out = path.join(__dirname, 'catalog.json');
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), sprints: SPRINTS, tasks }, null, 2));
const bySprint = [2, 3, 4].map((s) => `Sprint ${s}: ${tasks.filter((t) => t.sprint === s).length}`).join(' · ');
const badConditions = tasks.filter((t) => t.conditions.length !== 4).map((t) => t.key);
console.log(`OK  ${tasks.length} tasks (${bySprint}) -> ${path.relative(ROOT, out)}`);
if (badConditions.length) console.log('WARN tasks without 4 conditions:', badConditions.join(', '));

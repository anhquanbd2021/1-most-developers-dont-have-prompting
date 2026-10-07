import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeInstruction, auditPlacement, validateInstruction, SURFACES,
} from '../public/router.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(readFileSync(join(ROOT, 'examples', 'instructions.json'), 'utf8'));
const misrouted = JSON.parse(readFileSync(join(ROOT, 'examples', 'misrouted.json'), 'utf8'));
const byId = new Map(catalog.instructions.map(i => [i.id, i]));

test('catalog: every entry validates and routes to its expected surface', () => {
  assert.equal(catalog.instructions.length, 11);
  const seen = new Set();
  for (const instr of catalog.instructions) {
    assert.deepEqual(validateInstruction(instr), [], instr.id);
    assert.equal(routeInstruction(instr).surface, instr.expected, instr.id);
    seen.add(instr.expected);
  }
  // catalog covers all five config surfaces plus the prompt counter-example
  for (const s of ['claude-md', 'scoped-rule', 'skill', 'subagent', 'hook', 'prompt']) {
    assert.ok(seen.has(s), `catalog missing a ${s} example`);
  }
});

test('misrouted fixture: every placement produces its expected failure', () => {
  for (const p of misrouted.placements) {
    const instr = byId.get(p.id);
    assert.ok(instr, `unknown instruction ${p.id}`);
    assert.ok(SURFACES[p.placed], `unknown surface ${p.placed}`);
    const audit = auditPlacement(instr, p.placed);
    assert.equal(audit.verdict, 'misrouted', p.id);
    assert.equal(audit.failure, p.expectedFailure, p.id);
  }
});

test('misrouted fixture: every expected failure label exists', () => {
  const used = new Set(misrouted.placements.map(p => p.expectedFailure));
  for (const f of ['enforcement-gap', 'over-enforcement', 'context-tax', 'coverage-gap', 'context-pollution']) {
    assert.ok(used.has(f), `fixture missing a ${f} case`);
  }
});

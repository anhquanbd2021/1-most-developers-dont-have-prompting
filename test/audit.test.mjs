import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPlacement, simulatePlacement, FAILURES,
  ADVISORY_COMPLIANCE,
} from '../public/router.mjs';

const base = {
  id: 'x', text: 'x', scope: null, tokenCost: 10, relevance: 1,
  properties: { mustEnforce: false, needsIsolation: false, repeatable: false, scoped: false, alwaysTrue: false },
};
const mk = (props, extra = {}) => ({
  ...base, ...extra, properties: { ...base.properties, ...props },
});

test('correct placement audits clean', () => {
  assert.equal(auditPlacement(mk({ alwaysTrue: true }), 'claude-md').verdict, 'correct');
  assert.equal(auditPlacement(mk({ mustEnforce: true }), 'hook').verdict, 'correct');
  assert.equal(auditPlacement(mk({}), 'prompt').verdict, 'correct');
});

test('must-enforce on advisory surface → enforcement-gap', () => {
  for (const placed of ['claude-md', 'scoped-rule', 'skill', 'subagent', 'prompt']) {
    const audit = auditPlacement(mk({ mustEnforce: true }), placed);
    assert.equal(audit.verdict, 'misrouted');
    assert.equal(audit.failure, 'enforcement-gap', placed);
    assert.equal(audit.correct, 'hook');
  }
});

test('advisory rule on a hook → over-enforcement', () => {
  const audit = auditPlacement(mk({ alwaysTrue: true }), 'hook');
  assert.equal(audit.failure, 'over-enforcement');
  assert.ok(FAILURES['over-enforcement'].length > 0);
});

test('scoped/procedural/isolated content in claude-md', () => {
  assert.equal(
    auditPlacement(mk({ repeatable: true }), 'claude-md').failure, 'context-tax');
  assert.equal(
    auditPlacement(mk({ scoped: true }, { scope: 'a/**' }), 'claude-md').failure, 'context-tax');
  assert.equal(
    auditPlacement(mk({ needsIsolation: true }), 'claude-md').failure, 'context-pollution');
});

test('always-true behind narrower loading → coverage-gap', () => {
  for (const placed of ['scoped-rule', 'skill', 'subagent', 'prompt']) {
    assert.equal(auditPlacement(mk({ alwaysTrue: true }), placed).failure, 'coverage-gap', placed);
  }
});

test('simulation: hook guarantees, claude-md pays tax and still violates', () => {
  const instr = mk({ mustEnforce: true, alwaysTrue: true }, { tokenCost: 18 });
  const inMd = simulatePlacement(instr, 'claude-md');
  const inHook = simulatePlacement(instr, 'hook');
  assert.equal(inMd.loadedTurns, 100);
  assert.equal(inMd.tokensPaid, 1800);
  assert.ok(inMd.violations > 0, 'advisory surface leaks violations');
  assert.equal(inHook.violations, 0);
  assert.equal(inHook.tokensPaid, 0);
  assert.ok(inHook.guaranteed);
});

test('simulation: scoped content in claude-md loads on irrelevant turns', () => {
  const instr = mk({ scoped: true }, { scope: 'a/**', relevance: 0.3, tokenCost: 50 });
  const inMd = simulatePlacement(instr, 'claude-md');
  const scoped = simulatePlacement(instr, 'scoped-rule');
  assert.equal(inMd.tokensPaid, 5000); // paid all 100 turns for ~30 relevant
  assert.ok(scoped.tokensPaid < inMd.tokensPaid);
  assert.ok(scoped.loadedTurns < 100); // conditional loading, not always-on
});

test('simulation: seeded runs are deterministic', () => {
  const instr = mk({ mustEnforce: true });
  const a = simulatePlacement(instr, 'claude-md');
  const b = simulatePlacement(instr, 'claude-md');
  assert.deepEqual(a, b);
});

test('simulation: unloaded instructions are never followed', () => {
  const instr = mk({ mustEnforce: true }, { relevance: 1 });
  const sim = simulatePlacement(instr, 'subagent');
  assert.equal(sim.loadedTurns, 0);
  assert.equal(sim.violations, sim.neededTurns); // never sees it → always violates
});

test('advisory compliance constant is documented and sane', () => {
  assert.ok(ADVISORY_COMPLIANCE > 0 && ADVISORY_COMPLIANCE < 1);
});

test('unknown surface throws', () => {
  assert.throws(() => auditPlacement(mk({}), 'nowhere'), /unknown surface/);
  assert.throws(() => simulatePlacement(mk({}), 'nowhere'), /unknown surface/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { routeInstruction, validateInstruction, SURFACES, QUESTIONS } from '../public/router.mjs';

const base = {
  id: 'x', text: 'x', scope: null, tokenCost: 10, relevance: 1,
  properties: { mustEnforce: false, needsIsolation: false, repeatable: false, scoped: false, alwaysTrue: false },
};
const mk = (props, extra = {}) => ({
  ...base, ...extra, properties: { ...base.properties, ...props },
});

test('each surface is reachable by its answering property', () => {
  assert.equal(routeInstruction(mk({ mustEnforce: true })).surface, 'hook');
  assert.equal(routeInstruction(mk({ needsIsolation: true })).surface, 'subagent');
  assert.equal(routeInstruction(mk({ repeatable: true })).surface, 'skill');
  assert.equal(routeInstruction(mk({ scoped: true }, { scope: 'src/api/**' })).surface, 'scoped-rule');
  assert.equal(routeInstruction(mk({ alwaysTrue: true })).surface, 'claude-md');
  assert.equal(routeInstruction(mk({})).surface, 'prompt');
});

test('mustEnforce outranks alwaysTrue — enforcement is asked first', () => {
  const instr = mk({ mustEnforce: true, alwaysTrue: true });
  const { surface, trace } = routeInstruction(instr);
  assert.equal(surface, 'hook');
  // trace records all five answers in precedence order
  assert.equal(trace.length, QUESTIONS.length);
  assert.equal(trace[0].question, 'Must it happen every time?');
  assert.equal(trace[0].answer, true);
  assert.equal(trace.at(-1).answer, true); // alwaysTrue answered but shadowed
});

test('needsIsolation outranks repeatable and scoped', () => {
  assert.equal(
    routeInstruction(mk({ needsIsolation: true, repeatable: true, scoped: true }, { scope: 'a/**' })).surface,
    'subagent',
  );
});

test('repeatable outranks scoped and alwaysTrue', () => {
  assert.equal(
    routeInstruction(mk({ repeatable: true, scoped: true, alwaysTrue: true }, { scope: 'a/**' })).surface,
    'skill',
  );
});

test('scoped outranks alwaysTrue', () => {
  assert.equal(
    routeInstruction(mk({ scoped: true, alwaysTrue: true }, { scope: 'a/**' })).surface,
    'scoped-rule',
  );
});

test('all six surfaces are defined with the two axes', () => {
  for (const key of ['claude-md', 'scoped-rule', 'skill', 'subagent', 'hook', 'prompt']) {
    assert.ok(SURFACES[key], key);
    assert.ok(typeof SURFACES[key].loadTrigger === 'string');
    assert.ok(['advisory', 'deterministic'].includes(SURFACES[key].enforcement));
  }
  assert.equal(SURFACES['hook'].enforcement, 'deterministic');
});

test('validateInstruction rejects malformed input', () => {
  assert.ok(validateInstruction(null).length);
  assert.ok(validateInstruction(mk({ scoped: true })).some(p => p.includes('scope glob')));
  assert.ok(validateInstruction(mk({}, { tokenCost: 0 })).length);
  assert.ok(validateInstruction(mk({}, { relevance: 2 })).length);
  assert.ok(validateInstruction(mk({ bogus: true })).some(p => p.includes('unknown property')));
  assert.throws(() => routeInstruction(mk({}, { tokenCost: -1 })), /invalid instruction/);
});

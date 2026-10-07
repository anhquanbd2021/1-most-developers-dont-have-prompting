// Instruction Router — teaching model of the routing decision for coding-agent
// configuration (.claude/, CLAUDE.md, .cursor/rules/, etc.).
//
// The model: five surfaces differ on two axes — WHEN the instruction loads and
// WHETHER anything enforces it. routeInstruction() asks five questions in
// precedence order (enforcement first: only hooks can guarantee execution);
// auditPlacement() names the failure a misroute produces; simulatePlacement()
// runs N seeded turns to quantify the cost.
//
// Honest limits: advisory compliance is a simulated constant (0.92), not a
// measurement — the lab reproduces the SHAPE of each failure.

export const SURFACES = Object.freeze({
  'claude-md': {
    label: 'CLAUDE.md',
    loads: 'every turn',
    loadTrigger: 'always',
    enforcement: 'advisory',
    contextCost: true,
  },
  'scoped-rule': {
    label: 'scoped rule',
    loads: 'when a matching file is touched',
    loadTrigger: 'path-match',
    enforcement: 'advisory',
    contextCost: true,
  },
  'skill': {
    label: 'skill',
    loads: 'on invocation',
    loadTrigger: 'invocation',
    enforcement: 'advisory',
    contextCost: true,
  },
  'subagent': {
    label: 'subagent',
    loads: 'in a separate context',
    loadTrigger: 'delegation',
    enforcement: 'advisory',
    contextCost: false,
  },
  'hook': {
    label: 'hook',
    loads: 'as code around tool calls',
    loadTrigger: 'event',
    enforcement: 'deterministic',
    contextCost: false,
  },
  'prompt': {
    label: 'the prompt',
    loads: 'when you remember to say it',
    loadTrigger: 'manual',
    enforcement: 'advisory',
    contextCost: true,
  },
});

// Precedence order — enforcement first, because only one surface can satisfy
// it. Asking "always true?" first is how enforceable rules land in CLAUDE.md.
export const QUESTIONS = Object.freeze([
  { key: 'mustEnforce', text: 'Must it happen every time?', surface: 'hook' },
  { key: 'needsIsolation', text: 'Does it need its own context?', surface: 'subagent' },
  { key: 'repeatable', text: 'Is it a repeatable procedure?', surface: 'skill' },
  { key: 'scoped', text: 'Does it apply only to some files?', surface: 'scoped-rule' },
  { key: 'alwaysTrue', text: 'Is it true of every task?', surface: 'claude-md' },
]);

const PROPERTY_KEYS = QUESTIONS.map(q => q.key);

export function validateInstruction(instr) {
  const problems = [];
  if (!instr || typeof instr !== 'object') return ['instruction must be an object'];
  if (typeof instr.id !== 'string' || !instr.id) problems.push('id is required');
  if (typeof instr.text !== 'string' || !instr.text) problems.push('text is required');
  const props = instr.properties;
  if (!props || typeof props !== 'object') {
    problems.push('properties object is required');
  } else {
    for (const key of Object.keys(props)) {
      if (!PROPERTY_KEYS.includes(key)) problems.push(`unknown property: ${key}`);
      else if (typeof props[key] !== 'boolean') problems.push(`properties.${key} must be boolean`);
    }
    for (const key of PROPERTY_KEYS) {
      if (!(key in props)) problems.push(`properties.${key} is missing`);
    }
    if (props.scoped && (typeof instr.scope !== 'string' || !instr.scope)) {
      problems.push('scope glob is required when properties.scoped is true');
    }
  }
  if (typeof instr.tokenCost !== 'number' || instr.tokenCost <= 0) {
    problems.push('tokenCost must be a positive number');
  }
  if (typeof instr.relevance !== 'number' || instr.relevance < 0 || instr.relevance > 1) {
    problems.push('relevance must be a number in [0, 1]');
  }
  if (instr.scopeRate != null
      && (typeof instr.scopeRate !== 'number' || instr.scopeRate < 0 || instr.scopeRate > 1)) {
    problems.push('scopeRate, when present, must be a number in [0, 1]');
  }
  return problems;
}

// Route one instruction to the surface that answers its first "yes".
// Returns { surface, trace } — trace records all five answers so callers can
// show WHY a later property didn't win (e.g. always-true + must-enforce).
export function routeInstruction(instr) {
  const problems = validateInstruction(instr);
  if (problems.length) {
    throw new Error(`invalid instruction ${instr?.id || '?'}: ${problems.join('; ')}`);
  }
  const trace = QUESTIONS.map(q => ({
    question: q.text,
    answer: Boolean(instr.properties[q.key]),
    surface: q.surface,
  }));
  const hit = trace.find(t => t.answer);
  const surface = hit ? hit.surface : 'prompt';
  return { surface, trace };
}

// ---------------------------------------------------------------------------
// Audit: classify a placement as correct or name its failure.

export const FAILURES = Object.freeze({
  'enforcement-gap': 'Read every turn, guaranteed never — advisory text cannot enforce.',
  'over-enforcement': 'A deterministic slot spent on a rule that needs judgment, or context tax rewritten as code.',
  'context-tax': 'Always loaded, relevant occasionally — paid every turn whether or not it applies.',
  'coverage-gap': 'Needed broadly but loaded conditionally — correct where it applies, absent everywhere else.',
  'context-pollution': 'Delegated work inlined into the main context — the specialist job done by the generalist.',
  'misrouted': 'Placed on a surface whose load condition does not match the instruction.',
});

const MAIN_CONTEXT_SURFACES = new Set(['claude-md', 'scoped-rule', 'skill']);
const NARROW_LOAD_SURFACES = new Set(['scoped-rule', 'skill', 'subagent', 'prompt']);

export function auditPlacement(instr, placed) {
  if (!SURFACES[placed]) throw new Error(`unknown surface: ${placed}`);
  const { surface: correct } = routeInstruction(instr);
  if (placed === correct) {
    return { verdict: 'correct', failure: null, placed, correct };
  }
  const p = instr.properties;
  let failure = 'misrouted';
  if (p.mustEnforce && SURFACES[placed].enforcement !== 'deterministic') {
    failure = 'enforcement-gap';
  } else if (!p.mustEnforce && placed === 'hook') {
    failure = 'over-enforcement';
  } else if (p.needsIsolation && MAIN_CONTEXT_SURFACES.has(placed)) {
    failure = 'context-pollution';
  } else if (placed === 'claude-md' && !p.alwaysTrue) {
    failure = 'context-tax';
  } else if ((p.alwaysTrue || p.scoped) && NARROW_LOAD_SURFACES.has(placed)) {
    failure = 'coverage-gap';
  }
  return { verdict: 'misrouted', failure, placed, correct };
}

// ---------------------------------------------------------------------------
// Simulation: run `turns` seeded agent turns against one placement and count
// loads, misses, context tokens paid, and violations.
//
// Assumptions (documented in README):
//   - a turn "needs" the instruction with probability = instruction.relevance
//   - a scoped rule loads only when its glob matches — probability scopeRate
//     (defaults to instruction.relevance for scoped content, 0.5 for an
//     always-true fact squeezed behind a glob — that IS the coverage gap)
//   - a skill loads when invoked — probability = relevance (optimistic: the
//     trigger is assumed to fire exactly when needed)
//   - prompt loads with probability PROMPT_RECALL (you remember to say it)
//   - a loaded instruction on an advisory surface is followed with probability
//     ADVISORY_COMPLIANCE; an unloaded one is never followed
//   - hooks enforce deterministically and carry no context tokens; subagents
//     keep the instruction out of the main context entirely

export const ADVISORY_COMPLIANCE = 0.92;
export const PROMPT_RECALL = 0.5;
export const DEFAULT_SCOPE_RATE = 0.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatePlacement(instr, placed, { turns = 100, seed = 1337 } = {}) {
  if (!SURFACES[placed]) throw new Error(`unknown surface: ${placed}`);
  const rng = mulberry32(seed);
  const trigger = SURFACES[placed].loadTrigger;
  let neededTurns = 0;
  let loadedTurns = 0;
  let missedTurns = 0; // needed but not loaded
  let violations = 0; // needed but the rule was not upheld
  for (let t = 0; t < turns; t += 1) {
    const needed = rng() < instr.relevance;
    if (needed) neededTurns += 1;
    let loaded = false;
    if (trigger === 'always') loaded = true;
    else if (trigger === 'path-match') {
      const rate = instr.scopeRate ?? (instr.properties.scoped ? instr.relevance : DEFAULT_SCOPE_RATE);
      loaded = rng() < rate;
    }
    else if (trigger === 'invocation') loaded = rng() < instr.relevance;
    else if (trigger === 'manual') loaded = rng() < PROMPT_RECALL;
    // 'delegation' and 'event' never load text into the main context
    if (loaded) loadedTurns += 1;
    if (needed && !loaded) missedTurns += 1;
    if (needed && instr.properties.mustEnforce) {
      if (SURFACES[placed].enforcement === 'deterministic') {
        // hook blocks the violating call — zero violations
      } else if (!loaded || rng() > ADVISORY_COMPLIANCE) {
        violations += 1;
      }
    }
  }
  const tokensPaid = SURFACES[placed].contextCost ? loadedTurns * instr.tokenCost : 0;
  return {
    placed, turns, neededTurns, loadedTurns, missedTurns, violations, tokensPaid,
    guaranteed: SURFACES[placed].enforcement === 'deterministic',
  };
}

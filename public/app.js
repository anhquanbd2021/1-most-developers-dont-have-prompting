import {
  SURFACES, QUESTIONS, FAILURES,
  routeInstruction, auditPlacement, simulatePlacement,
} from './router.mjs';

const $ = id => document.getElementById(id);
const PROP_IDS = ['mustEnforce', 'needsIsolation', 'repeatable', 'scoped', 'alwaysTrue'];

const [catalogRes, misroutedRes] = await Promise.all([
  fetch('/instructions.json'), fetch('/misrouted.json'),
]);
const catalog = (await catalogRes.json()).instructions;
const misrouted = (await misroutedRes.json()).placements;
const byId = new Map(catalog.map(i => [i.id, i]));

// --- surface reference list -------------------------------------------------
for (const [key, s] of Object.entries(SURFACES)) {
  const li = document.createElement('li');
  li.innerHTML = `<strong>${s.label}</strong> <span class="muted">loads ${s.loads} · ${s.enforcement}</span>`;
  $('surface-list').append(li);
}

// --- panel A: route an instruction ------------------------------------------
const catalogSel = $('catalog');
catalogSel.append(new Option('— custom toggles —', ''));
for (const i of catalog) catalogSel.append(new Option(`${i.id} — ${SURFACES[i.expected].label}`, i.id));

function currentInstruction() {
  const id = catalogSel.value;
  if (id) return byId.get(id);
  const properties = Object.fromEntries(PROP_IDS.map(k => [k, $(`p-${k}`).checked]));
  return {
    id: 'custom', text: '(custom instruction)',
    properties, scope: properties.scoped ? 'src/example/**' : null,
    tokenCost: 40, relevance: properties.alwaysTrue || properties.mustEnforce ? 1.0 : 0.3,
  };
}

function renderRoute() {
  const instr = currentInstruction();
  const { surface, trace } = routeInstruction(instr);
  const badge = $('route-badge');
  badge.textContent = SURFACES[surface].label;
  badge.className = `badge ${surface === 'prompt' ? 'warn' : 'pass'}`;
  const ol = $('trace');
  ol.innerHTML = '';
  let decided = false;
  for (const t of trace) {
    const li = document.createElement('li');
    const hit = t.answer && !decided;
    if (t.answer) decided = true;
    li.className = hit ? 'hit' : (t.answer ? 'shadowed' : '');
    li.innerHTML = `<span>${t.question}</span><strong>${t.answer ? 'yes' : 'no'}</strong>` +
      `<em>${hit ? `→ ${SURFACES[t.surface].label}` : ''}</em>`;
    ol.append(li);
  }
  if (surface === 'prompt') {
    $('route-reason').textContent =
      'No surface claimed it — this belongs in the prompt, not the control plane.';
  } else {
    const s = SURFACES[surface];
    $('route-reason').textContent =
      `${s.label}: loads ${s.loads}; enforcement is ${s.enforcement}.` +
      (surface === 'hook' && instr.properties.alwaysTrue
        ? ' Always-true too — but enforcement outranks loading; the hook carries a matcher instead.'
        : '');
  }
}

catalogSel.addEventListener('change', () => {
  const instr = byId.get(catalogSel.value);
  if (instr) for (const k of PROP_IDS) $(`p-${k}`).checked = instr.properties[k];
  renderRoute();
});
for (const k of PROP_IDS) $(`p-${k}`).addEventListener('change', () => {
  catalogSel.value = '';
  renderRoute();
});

// --- panel B: audit a placement ---------------------------------------------
const aiSel = $('audit-instr');
const asSel = $('audit-surface');
for (const i of catalog) aiSel.append(new Option(i.id, i.id));
for (const [key, s] of Object.entries(SURFACES)) asSel.append(new Option(s.label, key));

function simRow(label, sim, isCorrect) {
  const tr = document.createElement('tr');
  tr.className = isCorrect ? 'row-fix' : '';
  tr.innerHTML = `<td>${label}</td><td>${sim.loadedTurns}</td><td>${sim.neededTurns}</td>` +
    `<td>${sim.missedTurns}</td><td>${sim.violations}</td><td>${sim.tokensPaid}</td>`;
  return tr;
}

function runAudit() {
  const instr = byId.get(aiSel.value);
  const placed = asSel.value;
  const audit = auditPlacement(instr, placed);
  const badge = $('audit-badge');
  badge.textContent = audit.verdict === 'correct' ? 'correct' : audit.failure;
  badge.className = `badge ${audit.verdict === 'correct' ? 'pass' : 'fail'}`;
  $('audit-explain').textContent = audit.verdict === 'correct'
    ? `${SURFACES[placed].label} is where this instruction belongs — loads ${SURFACES[placed].loads}.`
    : `${FAILURES[audit.failure]} Correct surface: ${SURFACES[audit.correct].label}.`;
  const tb = $('audit-table');
  tb.innerHTML = '';
  tb.append(simRow(`${SURFACES[placed].label} (as placed)`, simulatePlacement(instr, placed), false));
  tb.append(simRow(`${SURFACES[audit.correct].label} (correct)`, simulatePlacement(instr, audit.correct), true));
}

$('audit-run').addEventListener('click', runAudit);
aiSel.addEventListener('change', runAudit);
asSel.addEventListener('change', runAudit);

// --- panel C: the misrouted .claude/ -----------------------------------------
function renderMisroutes() {
  const ol = $('misroute-list');
  ol.innerHTML = '';
  for (const p of misrouted) {
    const instr = byId.get(p.id);
    const audit = auditPlacement(instr, p.placed);
    const sim = simulatePlacement(instr, p.placed);
    const li = document.createElement('li');
    li.className = `result ${audit.verdict === 'correct' ? 'pass' : 'fail'}`;
    li.innerHTML = `<div class="result-head"><strong>${p.id}</strong>` +
      `<span class="badge fail">${SURFACES[p.placed].label}</span>` +
      `<span class="muted">→ should be ${SURFACES[audit.correct].label}</span></div>` +
      `<p>${audit.verdict === 'correct' ? 'correctly placed' : FAILURES[audit.failure]}` +
      ` <span class="fix">violations=${sim.violations} · tokensPaid=${sim.tokensPaid}</span></p>`;
    ol.append(li);
  }
}
$('audit-all').addEventListener('click', renderMisroutes);

renderRoute();
runAudit();
renderMisroutes();

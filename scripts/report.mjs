// CLI report: route the instruction catalog, then audit the deliberately
// misrouted .claude/ fixture. Exits 1 on expectation drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeInstruction, auditPlacement, simulatePlacement,
  SURFACES, FAILURES,
} from '../public/router.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(readFileSync(join(ROOT, 'examples', 'instructions.json'), 'utf8'));
const misrouted = JSON.parse(readFileSync(join(ROOT, 'examples', 'misrouted.json'), 'utf8'));
const byId = new Map(catalog.instructions.map(i => [i.id, i]));

let drift = 0;
const ok = b => (b ? 'ok' : 'DRIFT');

console.log('Instruction Router — routing table');
console.log('================================\n');
for (const instr of catalog.instructions) {
  const { surface } = routeInstruction(instr);
  const match = surface === instr.expected;
  if (!match) drift += 1;
  const props = Object.entries(instr.properties).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
  console.log(`${ok(match)}  ${instr.id.padEnd(18)} [${props}]`);
  console.log(`     → ${SURFACES[surface].label} (expected ${SURFACES[instr.expected].label})`);
}

console.log('\nMisrouted .claude/ audit — 100 simulated turns each');
console.log('===================================================\n');
for (const p of misrouted.placements) {
  const instr = byId.get(p.id);
  if (!instr) { drift += 1; console.log(`DRIFT  unknown instruction ${p.id}`); continue; }
  const audit = auditPlacement(instr, p.placed);
  const sim = simulatePlacement(instr, p.placed);
  const match = audit.failure === p.expectedFailure;
  if (!match) drift += 1;
  console.log(`${ok(match)}  ${p.id} → ${SURFACES[p.placed].label}  [${audit.failure}]`);
  console.log(`     ${FAILURES[audit.failure]}`);
  console.log(`     turns=${sim.turns} needed=${sim.neededTurns} loaded=${sim.loadedTurns}` +
    ` missed=${sim.missedTurns} violations=${sim.violations} tokensPaid=${sim.tokensPaid}`);
  const fix = simulatePlacement(instr, audit.correct);
  console.log(`     fix → ${SURFACES[audit.correct].label}: violations=${fix.violations} tokensPaid=${fix.tokensPaid}\n`);
}

console.log(drift === 0 ? 'All expectations hold.' : `${drift} expectation(s) drifted.`);
process.exit(drift === 0 ? 0 : 1);

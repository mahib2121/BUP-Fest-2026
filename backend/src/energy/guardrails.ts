import { ALLOWED_TYPES, Directive, DirectiveType, RawInterpretation, StructuredAdjustment } from './types';

/** Deterministic guardrails: untrusted LLM output -> validated directive_interpretation. */

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

export function rangesToHours(ranges: unknown): number[] {
  const set = new Set<number>();
  if (!Array.isArray(ranges)) return [];
  for (const rg of ranges) {
    if (!Array.isArray(rg) || rg.length !== 2) continue;
    let s = num(rg[0]);
    let e = num(rg[1]);
    if (s === null || e === null) continue;
    s = Math.round(s);
    e = Math.round(e);
    if (s < 0 || s > 24 || e < 0 || e > 24) continue;
    if (s < e) for (let h = s; h < e; h++) set.add(h);
    else if (s > e) {
      for (let h = s; h < 24; h++) set.add(h); // crosses midnight
      for (let h = 0; h < e; h++) set.add(h);
    }
  }
  return [...set].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
}

const noop = (i: number, why: string): Directive => ({
  note_index: i,
  applies: false,
  directive_type: 'no_op',
  structured_adjustment: null,
  explanation: why,
});

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function validateItem(i: number, raw: RawInterpretation | undefined, capacity: number): Directive {
  if (!raw || typeof raw !== 'object') return noop(i, 'Interpretation unavailable; treated as no-op.');
  const type = raw.directive_type as DirectiveType;
  const expl = String(raw.explanation ?? '').slice(0, 300);
  if (!ALLOWED_TYPES.includes(type)) return noop(i, 'Unsupported directive type rejected by guardrail.');
  if (type === 'no_op') return noop(i, expl || "This note does not affect today's energy schedule.");

  let hours = rangesToHours(raw.ranges);
  if (!hours.length && Array.isArray(raw.hours)) {
    hours = [...new Set(raw.hours.map(num).filter((h): h is number => h !== null && Number.isInteger(h) && h >= 0 && h <= 23))].sort(
      (a, b) => a - b,
    );
  }
  if (!hours.length) return noop(i, 'No valid hours extracted; rejected by guardrail.');

  let value = num(raw.value);
  const adj: StructuredAdjustment = { hours };

  if (type === 'solar_reduction') {
    if (value === null) return noop(i, 'Missing solar factor; rejected by guardrail.');
    if (value > 1) value /= 100; // model returned 80 instead of 0.8
    const factor = r6(raw.solar_value_kind === 'reduction_fraction' ? 1 - value : value);
    if (factor < 0 || factor > 1) return noop(i, 'Solar factor out of range; rejected by guardrail.');
    adj.factor = factor;
  } else if (type === 'minimum_battery_reserve') {
    if (value === null || value < 0) return noop(i, 'Invalid reserve value; rejected by guardrail.');
    if (raw.reserve_unit === 'percent_of_capacity') {
      if (value > 1) value /= 100;
      value *= capacity;
    }
    value = r6(value);
    if (value > capacity) return noop(i, 'Reserve exceeds battery capacity; rejected by guardrail.');
    adj.minimum_energy_kwh = value;
  } else if (type === 'max_grid_window') {
    if (value === null || value < 0) return noop(i, 'Invalid grid cap; rejected by guardrail.');
    adj.max_grid_kwh = r6(value);
  }

  return { note_index: i, applies: true, directive_type: type, structured_adjustment: adj, explanation: expl || `Interpreted as ${type}.` };
}

/** Guarantees exactly one entry per note, in note_index order. */
export function validateAll(rawItems: unknown, nNotes: number, capacity: number): Directive[] {
  const byIdx = new Map<number, RawInterpretation>();
  if (Array.isArray(rawItems)) {
    rawItems.forEach((it, pos) => {
      if (!it || typeof it !== 'object') return;
      const n = num((it as RawInterpretation).note_index);
      const i = n !== null && Number.isInteger(n) ? n : pos;
      if (i >= 0 && i < nNotes && !byIdx.has(i)) byIdx.set(i, it as RawInterpretation);
    });
  }
  return Array.from({ length: nNotes }, (_, i) => validateItem(i, byIdx.get(i), capacity));
}

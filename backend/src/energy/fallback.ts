import { RawInterpretation } from './types';

/**
 * Backup interpreter used ONLY when the LLM provider fails (safe-failure path).
 * The primary interpretation path is always the LLM. Output goes through the same guardrails.
 */
const WORDNUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const FRACTIONS: [string, number][] = [
  ['three-quarters', 0.75], ['two-thirds', 2 / 3], ['one-half', 0.5], ['half', 0.5], ['one-third', 1 / 3],
  ['a third', 1 / 3], ['one-quarter', 0.25], ['a quarter', 0.25], ['one-fifth', 0.2], ['a fifth', 0.2],
];
const TIME = `(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|${Object.keys(WORDNUM).join('|')})`;

function toHour(tok: string, pm: boolean): number | null {
  const t = tok.trim().toLowerCase().replace(/\./g, '');
  if (t === 'noon') return 12;
  if (t === 'midnight') return 0;
  if (t in WORDNUM) {
    const h = WORDNUM[t];
    return pm && h < 12 ? h + 12 : h;
  }
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && !m[2] && pm && h < 12) h += 12;
  return h;
}

function window(text: string, daytimeHint: boolean): number[][] {
  const t = text.toLowerCase();
  const m = t.match(new RegExp(`${TIME}\\s*(?:to|until|till|through|and|-|–)\\s*${TIME}`));
  if (!m) return [];
  const [a, b] = [m[1], m[2]];
  const aHasAm = /am|a\.m\./.test(a);
  const pmB = /pm|p\.m\./.test(b) || /afternoon|evening|tonight/.test(t);
  // bare small numbers in a solar context ("from one until three") are afternoon hours
  const bareSmall = (x: string) => !/[ap]\.?m/.test(x) && !x.includes(':') && (toHour(x, false) ?? 99) <= 6;
  const pmA = !aHasAm && a !== 'noon' && a !== 'midnight' && (pmB || (daytimeHint && bareSmall(a)));
  const s = toHour(a, pmA);
  let e = toHour(b, pmB || (daytimeHint && bareSmall(b)));
  if (b.trim() === 'midnight') e = 24;
  return s === null || e === null ? [] : [[s, e]];
}

export function interpretNotesFallback(notes: string[]): RawInterpretation[] {
  return notes.map((note, i) => {
    const t = note.toLowerCase();
    const isSolar = /solar|pv|panel/.test(t);
    const item: RawInterpretation = {
      note_index: i, directive_type: 'no_op', ranges: [], value: null,
      solar_value_kind: null, reserve_unit: null,
      explanation: 'Rule-based backup interpretation (LLM unavailable).',
    };
    const rng = window(note, isSolar);
    const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
    const kwh = t.match(/(\d+(?:\.\d+)?)\s*kwh/);
    if (!rng.length) return item;

    if (isSolar) {
      item.directive_type = 'solar_reduction';
      item.ranges = rng;
      if (pct) {
        const isReduction = /reduc|cut|by\s+(about\s+|roughly\s+)?\d/.test(t) && !/to\s+(about\s+|roughly\s+)?\d/.test(t);
        item.solar_value_kind = isReduction ? 'reduction_fraction' : 'remaining_fraction';
        item.value = Number(pct[1]) / 100;
      } else {
        const f = FRACTIONS.find(([w]) => t.includes(w));
        if (f) {
          item.solar_value_kind = 'remaining_fraction';
          item.value = f[1];
        }
      }
    } else if (/grid|feeder|transformer|substation|import|intake/.test(t) && kwh) {
      Object.assign(item, { directive_type: 'max_grid_window', ranges: rng, value: Number(kwh[1]) });
    } else if (/battery/.test(t) && /reserve|keep at least|remain|stored|at least/.test(t)) {
      Object.assign(item, { directive_type: 'minimum_battery_reserve', ranges: rng });
      if (kwh) Object.assign(item, { reserve_unit: 'kwh', value: Number(kwh[1]) });
      else if (pct) Object.assign(item, { reserve_unit: 'percent_of_capacity', value: Number(pct[1]) / 100 });
    } else if (/discharg/.test(t)) {
      Object.assign(item, { directive_type: 'no_discharge_window', ranges: rng });
    } else if (/charg/.test(t)) {
      Object.assign(item, { directive_type: 'no_charge_window', ranges: rng });
    }
    return item;
  });
}

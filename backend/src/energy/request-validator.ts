import { ScenarioRequest } from './types';

const HOUR_FIELDS = ['demand_kwh', 'solar_kwh', 'tariff_bdt_per_kwh'] as const;
const BAT_FIELDS = ['capacity_kwh', 'initial_energy_kwh', 'minimum_energy_kwh', 'max_charge_kwh_per_hour', 'max_discharge_kwh_per_hour'] as const;
const okNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Returns an error message (-> HTTP 400) or null when the request is structurally valid. */
export function validateRequest(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object.';
  if (typeof body.scenario_id !== 'string' || !body.scenario_id) return 'scenario_id must be a non-empty string.';
  const notes = body.operator_notes;
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 3 || !notes.every((n: unknown) => typeof n === 'string' && n.trim()))
    return 'operator_notes must be 1-3 non-empty strings.';
  if (!Array.isArray(body.hours) || body.hours.length !== 24) return 'hours must contain exactly 24 entries.';
  const seen = new Set<number>();
  for (const h of body.hours) {
    if (!h || typeof h !== 'object' || !Number.isInteger(h.hour)) return "Each hour entry needs an integer 'hour'.";
    if (h.hour < 0 || h.hour > 23 || seen.has(h.hour)) return 'hour values must be unique integers 0-23.';
    seen.add(h.hour);
    for (const f of HOUR_FIELDS) if (!okNum(h[f])) return `hour ${h.hour}: ${f} must be a finite non-negative number.`;
  }
  const b = body.battery;
  if (!b || typeof b !== 'object') return 'battery must be an object.';
  for (const f of BAT_FIELDS) if (!okNum(b[f])) return `battery.${f} must be a finite non-negative number.`;
  return null;
}

export type ValidRequest = ScenarioRequest;

import { buildLimits } from './limits';
import { Battery, Directive, HourInput, PlanHour } from './types';

/** Independent judge-style replay. Returns violation strings (empty = valid). */
export function replay(plan: PlanHour[], hours: HourInput[], b: Battery, directives: Directive[], tol = 0.01): string[] {
  const L = buildLimits(hours, b, directives);
  const v: string[] = [];
  let e = b.initial_energy_kwh;
  for (const p of plan) {
    const h = p.hour;
    const ch = p.battery_action === 'charge' ? p.battery_kwh : 0;
    const di = p.battery_action === 'discharge' ? p.battery_kwh : 0;
    if (p.battery_action === 'idle' && p.battery_kwh > tol) v.push(`h${h}: idle with kwh`);
    e += ch - di;
    if (Math.abs(e - p.battery_energy_after_kwh) > tol) v.push(`h${h}: transition`);
    if (e < L.reserve[h] - tol) v.push(`h${h}: reserve`);
    if (e > b.capacity_kwh + tol) v.push(`h${h}: capacity`);
    if (ch > b.max_charge_kwh_per_hour + tol) v.push(`h${h}: charge rate`);
    if (di > b.max_discharge_kwh_per_hour + tol) v.push(`h${h}: discharge rate`);
    if (L.noCharge[h] && ch > tol) v.push(`h${h}: no_charge`);
    if (L.noDischarge[h] && di > tol) v.push(`h${h}: no_discharge`);
    if (p.solar_used_kwh > L.solar[h] + tol) v.push(`h${h}: solar overuse`);
    if (p.grid_kwh > L.gridCap[h] + tol) v.push(`h${h}: grid cap`);
    if (Math.min(p.grid_kwh, p.solar_used_kwh, p.battery_kwh) < -tol) v.push(`h${h}: negative`);
    const bal = p.grid_kwh + p.solar_used_kwh + di - hours[h].demand_kwh - ch;
    if (Math.abs(bal) > tol) v.push(`h${h}: balance`);
  }
  if (Math.abs(e - b.initial_energy_kwh) > tol) v.push('end-of-day neutrality');
  return v;
}

export function totals(plan: PlanHour[], hours: HourInput[]) {
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    total_grid_kwh: r4(plan.reduce((a, p) => a + p.grid_kwh, 0)),
    total_cost_bdt: r4(plan.reduce((a, p) => a + p.grid_kwh * hours[p.hour].tariff_bdt_per_kwh, 0)),
    peak_grid_kwh: r4(Math.max(...plan.map((p) => p.grid_kwh))),
  };
}

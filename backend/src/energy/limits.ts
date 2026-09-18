import { Battery, Directive, HourInput } from './types';

export interface Limits {
  solar: number[];
  reserve: number[];
  noCharge: boolean[];
  noDischarge: boolean[];
  gridCap: number[];
}

/** Applies validated directives to the base scenario (Problem Statement 5.3). */
export function buildLimits(hours: HourInput[], battery: Battery, directives: Directive[]): Limits {
  const L: Limits = {
    solar: hours.map((h) => h.solar_kwh),
    reserve: hours.map(() => battery.minimum_energy_kwh),
    noCharge: hours.map(() => false),
    noDischarge: hours.map(() => false),
    gridCap: hours.map(() => Infinity),
  };
  for (const d of directives) {
    if (!d.applies || !d.structured_adjustment) continue;
    const a = d.structured_adjustment;
    for (const h of a.hours) {
      switch (d.directive_type) {
        case 'solar_reduction':
          L.solar[h] = Math.min(L.solar[h], hours[h].solar_kwh * (a.factor as number));
          break;
        case 'minimum_battery_reserve':
          L.reserve[h] = Math.max(L.reserve[h], a.minimum_energy_kwh as number);
          break;
        case 'no_charge_window':
          L.noCharge[h] = true;
          break;
        case 'no_discharge_window':
          L.noDischarge[h] = true;
          break;
        case 'max_grid_window':
          L.gridCap[h] = Math.min(L.gridCap[h], a.max_grid_kwh as number);
          break;
      }
    }
  }
  return L;
}

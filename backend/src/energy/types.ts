export type DirectiveType =
  | 'solar_reduction'
  | 'minimum_battery_reserve'
  | 'no_charge_window'
  | 'no_discharge_window'
  | 'max_grid_window'
  | 'no_op';

export const ALLOWED_TYPES: DirectiveType[] = [
  'solar_reduction',
  'minimum_battery_reserve',
  'no_charge_window',
  'no_discharge_window',
  'max_grid_window',
  'no_op',
];

export interface HourInput {
  hour: number;
  demand_kwh: number;
  solar_kwh: number;
  tariff_bdt_per_kwh: number;
}

export interface Battery {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}

export interface ScenarioRequest {
  scenario_id: string;
  operator_notes: string[];
  hours: HourInput[];
  battery: Battery;
}

export interface StructuredAdjustment {
  hours: number[];
  factor?: number;
  minimum_energy_kwh?: number;
  max_grid_kwh?: number;
}

export interface Directive {
  note_index: number;
  applies: boolean;
  directive_type: DirectiveType;
  structured_adjustment: StructuredAdjustment | null;
  explanation: string;
}

/** Raw, untrusted shape produced by the LLM (or backup parser). */
export interface RawInterpretation {
  note_index?: unknown;
  directive_type?: unknown;
  ranges?: unknown;
  hours?: unknown;
  solar_value_kind?: unknown;
  reserve_unit?: unknown;
  value?: unknown;
  explanation?: unknown;
}

export type BatteryAction = 'charge' | 'discharge' | 'idle';

export interface PlanHour {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: BatteryAction;
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

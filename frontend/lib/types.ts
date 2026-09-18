export interface Directive {
  note_index: number;
  applies: boolean;
  directive_type: string;
  structured_adjustment: Record<string, any> | null;
  explanation: string;
}
export interface PlanHour {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: 'charge' | 'discharge' | 'idle';
  battery_kwh: number;
  battery_energy_after_kwh: number;
}
export interface OptimizeResponse {
  scenario_id: string;
  directive_interpretation: Directive[];
  hourly_plan: PlanHour[];
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
  plan_summary: string;
}
export interface SampleCase {
  id: string;
  label: string;
  input: any;
}

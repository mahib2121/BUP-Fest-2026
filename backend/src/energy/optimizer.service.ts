import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const highsLoader = require('highs');
import { buildLimits } from './limits';
import { Battery, Directive, HourInput, PlanHour } from './types';

const H = 24;
const BIG = 1e6; // penalty on directive slack (only matters if a scenario is infeasible)
const EPS = 0.0001; // tiny throughput penalty -> no pointless charge/discharge cycling

const f = (x: number) => {
  // LP-format safe number
  const s = Number(x.toFixed(9)).toString();
  return s.includes('e') ? x.toFixed(9) : s;
};
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Linear program solved with HiGHS (WebAssembly).
 * Vars per hour h: g (grid), s (solar used), c (charge), d (discharge), e (battery after),
 *                  r (reserve slack), k (grid-cap slack).
 */
@Injectable()
export class OptimizerService {
  private readonly log = new Logger(OptimizerService.name);
  private highs: any = null;

  private async solver() {
    if (!this.highs) this.highs = await highsLoader();
    return this.highs;
  }

  async onModuleInit() {
    await this.solver(); // warm up WASM at boot
  }

  buildLp(hours: HourInput[], b: Battery, directives: Directive[]): string {
    const L = buildLimits(hours, b, directives);
    const obj: string[] = [];
    const cons: string[] = [];
    const bnds: string[] = [];

    for (let h = 0; h < H; h++) {
      const t = hours[h].tariff_bdt_per_kwh;
      if (t !== 0) obj.push(`+ ${f(t)} g${h}`);
      obj.push(`+ ${f(EPS)} c${h} + ${f(EPS)} d${h} + ${f(BIG)} r${h} + ${f(BIG)} k${h}`);

      // energy balance: g + s + d - c = demand
      cons.push(`bal${h}: g${h} + s${h} + d${h} - c${h} = ${f(hours[h].demand_kwh)}`);
      // battery transition: e_h - e_{h-1} - c + d = 0   (e_{-1} = initial)
      cons.push(
        h === 0
          ? `tr${h}: e${h} - c${h} + d${h} = ${f(b.initial_energy_kwh)}`
          : `tr${h}: e${h} - e${h - 1} - c${h} + d${h} = 0`,
      );
      // reserve (directive may raise the base minimum): e + r >= reserve
      cons.push(`res${h}: e${h} + r${h} >= ${f(L.reserve[h])}`);
      // grid cap: g - k <= cap
      if (Number.isFinite(L.gridCap[h])) cons.push(`cap${h}: g${h} - k${h} <= ${f(L.gridCap[h])}`);

      bnds.push(`0 <= s${h} <= ${f(L.solar[h])}`);
      bnds.push(`0 <= c${h} <= ${f(L.noCharge[h] ? 0 : b.max_charge_kwh_per_hour)}`);
      bnds.push(`0 <= d${h} <= ${f(L.noDischarge[h] ? 0 : b.max_discharge_kwh_per_hour)}`);
      bnds.push(`${f(b.minimum_energy_kwh)} <= e${h} <= ${f(b.capacity_kwh)}`);
    }
    cons.push(`neutral: e${H - 1} = ${f(b.initial_energy_kwh)}`); // end-of-day neutrality

    return ['Minimize', ` obj: ${obj.join(' ')}`, 'Subject To', ...cons.map((c) => ` ${c}`), 'Bounds', ...bnds.map((x) => ` ${x}`), 'End'].join('\n');
  }

  async optimize(hours: HourInput[], b: Battery, directives: Directive[]): Promise<{ plan: PlanHour[]; relaxed: boolean }> {
    const lp = this.buildLp(hours, b, directives);
    let res: any;
    try {
      res = (await this.solver()).solve(lp);
    } catch (e) {
      this.log.warn('HiGHS instance failed; reloading');
      this.highs = null;
      res = (await this.solver()).solve(lp);
    }
    if (res.Status !== 'Optimal') throw new Error(`optimizer status: ${res.Status}`);
    const v = (name: string) => res.Columns[name]?.Primal ?? 0;

    const L = buildLimits(hours, b, directives);
    let relaxed = false;
    let e = b.initial_energy_kwh;
    const plan: PlanHour[] = [];
    for (let h = 0; h < H; h++) {
      if (v(`r${h}`) > 1e-6 || v(`k${h}`) > 1e-6) relaxed = true;
      const s = Math.max(0, Math.min(v(`s${h}`), L.solar[h]));
      let net = v(`c${h}`) - v(`d${h}`); // no losses -> net into a single action
      if (Math.abs(net) < 1e-7) net = 0;
      net = r6(net);
      e = r6(e + net);
      const grid = Math.max(0, r6(hours[h].demand_kwh + net - s));
      plan.push({
        hour: h,
        grid_kwh: grid,
        solar_used_kwh: r6(s),
        battery_action: net > 0 ? 'charge' : net < 0 ? 'discharge' : 'idle',
        battery_kwh: Math.abs(net),
        battery_energy_after_kwh: e,
      });
    }
    return { plan, relaxed };
  }
}

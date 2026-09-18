'use client';
import type { PlanHour } from '@/lib/types';

interface Props {
  plan: PlanHour[];
  demand: number[];
  capacity: number;
  tariff: number[];
}

/** Stacked supply per hour (solar, battery discharge, grid) with battery energy line. */
export default function EnergyChart({ plan, demand, capacity, tariff }: Props) {
  const W = 760, Hh = 300, padL = 44, padR = 44, padT = 14, padB = 30;
  const iw = W - padL - padR, ih = Hh - padT - padB;
  const maxY = Math.max(1, ...plan.map((p, i) => Math.max(demand[i] + (p.battery_action === 'charge' ? p.battery_kwh : 0),
    p.grid_kwh + p.solar_used_kwh + (p.battery_action === 'discharge' ? p.battery_kwh : 0))));
  const bw = iw / 24;
  const y = (v: number) => padT + ih - (v / maxY) * ih;
  const yE = (v: number) => padT + ih - (v / Math.max(1, capacity)) * ih;
  const maxT = Math.max(...tariff);

  const socPath = plan.map((p, i) => `${i ? 'L' : 'M'}${padL + bw * (i + 0.5)},${yE(p.battery_energy_after_kwh)}`).join(' ');

  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Hourly energy supply and battery energy">
        {tariff.map((t, i) => (
          <rect key={`t${i}`} x={padL + bw * i} y={padT} width={bw} height={ih} fill="#17324d" opacity={0.05 * (t / maxT)} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(maxY * f)} y2={y(maxY * f)} stroke="#cfd8e1" />
            <text x={padL - 6} y={y(maxY * f) + 4} fontSize="11" textAnchor="end" fill="#5f7085">{Math.round(maxY * f)}</text>
            <text x={W - padR + 6} y={yE(capacity * f) + 4} fontSize="11" fill="#2a8c82">{Math.round(capacity * f)}</text>
          </g>
        ))}
        {plan.map((p, i) => {
          const dis = p.battery_action === 'discharge' ? p.battery_kwh : 0;
          const x = padL + bw * i + bw * 0.15, w = bw * 0.7;
          const segs = [
            { v: p.solar_used_kwh, c: '#e8a33d' },
            { v: dis, c: '#2a8c82' },
            { v: p.grid_kwh, c: '#b5473a' },
          ];
          let acc = 0;
          return (
            <g key={i}>
              {segs.map((s, j) => {
                const top = acc + s.v;
                const r = <rect className="bar" key={j} x={x} y={y(top)} width={w} height={Math.max(0, y(acc) - y(top))} fill={s.c} />;
                acc = top;
                return r;
              })}
              <line x1={x - 1} x2={x + w + 1} y1={y(demand[i])} y2={y(demand[i])} stroke="#17324d" strokeWidth={1.5} />
              {i % 3 === 0 && <text x={padL + bw * (i + 0.5)} y={Hh - 10} fontSize="11" textAnchor="middle" fill="#5f7085">{i}:00</text>}
            </g>
          );
        })}
        <path d={socPath} fill="none" stroke="#2a8c82" strokeWidth={2} strokeDasharray="5 3" />
      </svg>
      <figcaption className="legend">
        <span><i style={{ background: '#e8a33d' }} />Solar used</span>
        <span><i style={{ background: '#2a8c82' }} />Battery discharge</span>
        <span><i style={{ background: '#b5473a' }} />Grid import</span>
        <span><i style={{ background: '#17324d', height: 2 }} />Demand</span>
        <span>Dashed line: battery energy (right axis). Darker background: higher tariff.</span>
      </figcaption>
    </figure>
  );
}

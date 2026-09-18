'use client';
import { useEffect, useState } from 'react';
import EnergyChart from '@/components/EnergyChart';
import type { OptimizeResponse, SampleCase } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function describe(adj: Record<string, any> | null) {
  if (!adj) return 'No change to the schedule';
  const hrs = adj.hours as number[];
  const span = hrs.length ? `hours ${hrs.join(', ')}` : '';
  if (adj.factor !== undefined) return `${span}: ${Math.round(adj.factor * 100)}% of forecast solar usable`;
  if (adj.minimum_energy_kwh !== undefined) return `${span}: keep at least ${adj.minimum_energy_kwh} kWh`;
  if (adj.max_grid_kwh !== undefined) return `${span}: grid import at most ${adj.max_grid_kwh} kWh`;
  return span;
}

export default function Page() {
  const [samples, setSamples] = useState<SampleCase[]>([]);
  const [selected, setSelected] = useState(0);
  const [notes, setNotes] = useState<string[]>(['', '', '']);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/public_samples.json')
      .then((r) => r.json())
      .then((d) => {
        setSamples(d.cases);
        loadNotes(d.cases[0]);
      })
      .catch(() => setError('Could not load the sample scenarios.'));
  }, []);

  function loadNotes(c: SampleCase) {
    const n = [...c.input.operator_notes];
    while (n.length < 3) n.push('');
    setNotes(n);
    setResult(null);
  }

  async function run() {
    const base = samples[selected]?.input;
    if (!base) return;
    const operator_notes = notes.map((n) => n.trim()).filter(Boolean);
    if (!operator_notes.length) return setError('Write at least one operator note.');
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${API}/optimize-energy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, operator_notes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `API returned ${r.status}`);
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? `Optimization failed: ${e.message}` : 'Optimization failed.');
    } finally {
      setBusy(false);
    }
  }

  const scenario = samples[selected]?.input;
  const submitted = notes.map((n) => n.trim()).filter(Boolean);

  return (
    <main className="shell">
      <header className="top">
        <h1>GridWise operator console</h1>
        <p>Write operator notes in plain language. The model turns them into constraints, and the solver builds the cheapest valid 24-hour plan.</p>
      </header>

      <div className="layout">
        <section className="panel stack" aria-label="Scenario and notes">
          <div>
            <label htmlFor="scenario">Scenario</label>
            <select
              id="scenario"
              value={selected}
              onChange={(e) => {
                const i = Number(e.target.value);
                setSelected(i);
                loadNotes(samples[i]);
              }}
            >
              {samples.map((c, i) => (
                <option key={c.id} value={i}>{c.id}: {c.label}</option>
              ))}
            </select>
            {scenario && (
              <p className="hint">
                Battery {scenario.battery.capacity_kwh} kWh, starts at {scenario.battery.initial_energy_kwh} kWh,
                ±{scenario.battery.max_charge_kwh_per_hour}/{scenario.battery.max_discharge_kwh_per_hour} kWh per hour.
              </p>
            )}
          </div>
          {notes.map((n, i) => (
            <div key={i}>
              <label htmlFor={`note${i}`}>Note {i + 1}{i > 0 ? ' (optional)' : ''}</label>
              <textarea
                id={`note${i}`}
                value={n}
                placeholder={i === 0 ? 'e.g. Solar will be about half of normal from 10 AM until noon.' : ''}
                onChange={(e) => setNotes(notes.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </div>
          ))}
          <button className="run" onClick={run} disabled={busy || !scenario}>
            {busy ? 'Optimizing…' : 'Optimize schedule'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section className="stack" aria-live="polite">
          <div className="panel">
            {result && scenario ? (
              <>
                <div className="kpis">
                  <div className="kpi"><b>{result.total_cost_bdt.toLocaleString()} BDT</b><span>Grid cost for the day</span></div>
                  <div className="kpi"><b>{result.total_grid_kwh.toLocaleString()} kWh</b><span>Bought from the grid</span></div>
                  <div className="kpi"><b>{result.peak_grid_kwh} kWh</b><span>Highest hourly import</span></div>
                </div>
                <EnergyChart
                  plan={result.hourly_plan}
                  demand={scenario.hours.map((h: any) => h.demand_kwh)}
                  tariff={scenario.hours.map((h: any) => h.tariff_bdt_per_kwh)}
                  capacity={scenario.battery.capacity_kwh}
                />
                <p className="summary">{result.plan_summary}</p>
              </>
            ) : (
              <p className="empty">Pick a scenario, adjust the notes, and optimize to see the plan.</p>
            )}
          </div>

          {result && (
            <div className="panel">
              <h2>How the notes were read</h2>
              <ul className="notes">
                {result.directive_interpretation.map((d) => (
                  <li key={d.note_index}>
                    <p className="note-text">{submitted[d.note_index]}</p>
                    <span className={`tag ${d.applies ? 'on' : 'off'}`}>{d.directive_type}</span>
                    <span className="adj">{describe(d.structured_adjustment)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div className="panel">
              <h2>Hourly plan</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Hour</th><th>Grid kWh</th><th>Solar kWh</th><th>Battery</th><th>kWh</th><th>Stored kWh</th></tr>
                  </thead>
                  <tbody>
                    {result.hourly_plan.map((p) => (
                      <tr key={p.hour}>
                        <td>{String(p.hour).padStart(2, '0')}:00</td>
                        <td>{p.grid_kwh}</td>
                        <td>{p.solar_used_kwh}</td>
                        <td className={p.battery_action}>{p.battery_action}</td>
                        <td>{p.battery_kwh}</td>
                        <td>{p.battery_energy_after_kwh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

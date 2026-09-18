import { Injectable, Logger } from '@nestjs/common';
import { RawInterpretation } from './types';

export class LlmError extends Error {}

export const SYSTEM_PROMPT = `You convert campus energy operator notes into structured JSON directives.
You NEVER invent demand, solar, tariff or battery values. You only extract what a note says.

Allowed directive_type values (exactly one per note):
- solar_reduction: usable rooftop solar / PV is reduced during some hours.
- minimum_battery_reserve: battery must keep at least some energy stored during some hours.
- no_charge_window: battery charging is unavailable / disabled / charger isolated during some hours.
- no_discharge_window: battery discharging is unavailable / disabled during some hours.
- max_grid_window: grid import / intake / feeder / transformer import capped at X kWh per hour during some hours.
- no_op: the note does not change today's 24-hour energy schedule (menus, bookings, notices,
  deadlines, events next week/month, anything unrelated to solar/battery/grid limits today).

TIME RULES:
- Use 24h clock. midnight=0, noon=12, 1 PM=13, 6 PM=18, 9 PM=21.
- Output windows as "ranges": [[start_hour, end_hour], ...] where start is INCLUDED and end is EXCLUDED.
  "1 PM to 3 PM" -> [[13,15]]. "from 6 PM until 9 PM" -> [[18,21]]. "noon until 2 PM" -> [[12,14]].
  "between 13:00 and 15:00" -> [[13,15]]. "from one until three" (afternoon context) -> [[13,15]].
- A window ending at midnight uses end_hour 24. A window crossing midnight, e.g. 10 PM to 2 AM -> [[22,24],[0,2]].
- A single hour like "at 6 PM" or "during the 6 PM hour" -> [[18,19]]. "all day" -> [[0,24]].

VALUE RULES:
- solar_reduction: give "solar_value_kind" and "value" (a fraction between 0 and 1):
    "drop to about 20%", "roughly one-fifth of normal", "leave half" -> kind "remaining_fraction", value 0.2 / 0.2 / 0.5
    "80% reduction", "cut by 80%", "drop by 30%" -> kind "reduction_fraction", value 0.8 / 0.8 / 0.3
- minimum_battery_reserve: "reserve_unit" is "kwh" (value = kWh number) or "percent_of_capacity"
    (value = fraction, e.g. 50% of capacity -> 0.5).
- max_grid_window: value = the kWh-per-hour cap.
- no_charge_window / no_discharge_window / no_op: value = null.

Return ONLY JSON of this form, one item per note, in the same order:
{"notes":[{"note_index":0,"directive_type":"...","ranges":[[s,e]],"solar_value_kind":null,
"reserve_unit":null,"value":null,"explanation":"short reason"}]}
For no_op use "ranges": [] and value null.

Examples:
"PV production will drop to about 20% between 13:00 and 15:00." ->
 {"directive_type":"solar_reduction","ranges":[[13,15]],"solar_value_kind":"remaining_fraction","value":0.2}
"Expect an 80% reduction in rooftop solar during the 1-3 PM maintenance window." ->
 {"directive_type":"solar_reduction","ranges":[[13,15]],"solar_value_kind":"reduction_fraction","value":0.8}
"Keep at least 50% of the battery capacity stored from 6 PM until 9 PM." ->
 {"directive_type":"minimum_battery_reserve","ranges":[[18,21]],"reserve_unit":"percent_of_capacity","value":0.5}
"The battery charger will be isolated from 2 AM until 5 AM." ->
 {"directive_type":"no_charge_window","ranges":[[2,5]],"value":null}
"Grid intake must stay at or below 190 kWh from 7 PM until 10 PM." ->
 {"directive_type":"max_grid_window","ranges":[[19,22]],"value":190}
"The cafeteria menu changes tomorrow." -> {"directive_type":"no_op","ranges":[],"value":null}`;

/**
 * Calls any OpenAI-compatible chat-completions API (Groq, OpenAI, Gemini, OpenRouter, Ollama...).
 * Env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private readonly cache = new Map<string, RawInterpretation[]>();
  private readonly baseUrl = (process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  private readonly apiKey = process.env.LLM_API_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile';
  private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 12000);

  get modelName() {
    return this.model;
  }

  async interpret(notes: string[]): Promise<RawInterpretation[]> {
    const key = JSON.stringify(notes);
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.apiKey) throw new LlmError('LLM_API_KEY not configured');

    const userMsg = 'Operator notes:\n' + notes.map((n, i) => `[${i}] ${n}`).join('\n');
    const body = {
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    };

    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: any = await res.json();
        const parsed = extractJson(String(json?.choices?.[0]?.message?.content ?? ''));
        if (!Array.isArray(parsed?.notes)) throw new Error('missing notes array');
        this.cache.set(key, parsed.notes);
        return parsed.notes;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'error';
        this.log.warn(`LLM attempt ${attempt + 1} failed: ${lastErr}`); // never logs the key
      }
    }
    throw new LlmError(`LLM call failed: ${lastErr}`);
  }
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON in LLM output');
    return JSON.parse(m[0]);
  }
}

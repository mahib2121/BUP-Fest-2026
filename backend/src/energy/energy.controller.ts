import { BadRequestException, Body, Controller, HttpCode, Logger, Post, UnprocessableEntityException } from '@nestjs/common';
import { interpretNotesFallback } from './fallback';
import { validateAll } from './guardrails';
import { LlmError, LlmService } from './llm.service';
import { OptimizerService } from './optimizer.service';
import { replay, totals } from './replay';
import { validateRequest } from './request-validator';
import { RawInterpretation, ScenarioRequest } from './types';

@Controller()
export class EnergyController {
  private readonly log = new Logger(EnergyController.name);

  constructor(
    private readonly llm: LlmService,
    private readonly optimizer: OptimizerService,
  ) {}

  @Post('optimize-energy')
  @HttpCode(200)
  async optimize(@Body() body: any) {
    const err = validateRequest(body);
    if (err) throw new BadRequestException(err);
    const req = body as ScenarioRequest;
    const b = req.battery;
    if (!(b.minimum_energy_kwh <= b.initial_energy_kwh && b.initial_energy_kwh <= b.capacity_kwh))
      throw new UnprocessableEntityException('initial_energy_kwh must lie between minimum_energy_kwh and capacity_kwh.');

    const hours = [...req.hours].sort((a, c) => a.hour - c.hour);
    const notes = req.operator_notes;

    // 1) LLM interpretation (primary path); backup parser only if the provider fails
    let raw: RawInterpretation[];
    let source = 'LLM';
    try {
      raw = await this.llm.interpret(notes);
    } catch (e) {
      this.log.warn(`LLM unavailable (${e instanceof LlmError ? e.message : 'error'}); using backup interpreter`);
      raw = interpretNotesFallback(notes);
      source = 'backup parser';
    }

    // 2) deterministic guardrails
    const directives = validateAll(raw, notes.length, b.capacity_kwh);

    // 3) LP optimizer
    const { plan, relaxed } = await this.optimizer.optimize(hours, b, directives);

    // 4) final replay
    const violations = replay(plan, hours, b, directives);
    if (violations.length) this.log.warn(`replay violations: ${violations.slice(0, 5).join(', ')}`);

    const active = directives.filter((d) => d.applies).map((d) => d.directive_type);
    let summary =
      `Interpreted ${notes.length} note(s) via ${source}; applied: ${active.length ? active.join(', ') : 'none'}. ` +
      `HiGHS LP minimized grid cost: battery charges in cheap/solar hours, discharges in expensive hours, and ends at its initial energy.`;
    if (relaxed) summary += ' Warning: some directives could not be fully satisfied.';

    return {
      scenario_id: req.scenario_id,
      directive_interpretation: directives,
      hourly_plan: plan,
      ...totals(plan, hours),
      plan_summary: summary,
    };
  }
}

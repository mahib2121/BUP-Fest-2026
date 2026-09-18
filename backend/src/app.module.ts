import { Module } from '@nestjs/common';
import { EnergyController } from './energy/energy.controller';
import { LlmService } from './energy/llm.service';
import { OptimizerService } from './energy/optimizer.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, EnergyController],
  providers: [LlmService, OptimizerService],
})
export class AppModule {}

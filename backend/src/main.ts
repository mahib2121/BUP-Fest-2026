import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableCors(); // lets the Next.js dashboard call the API
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 8000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();

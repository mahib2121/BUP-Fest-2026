import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

/** Controlled errors: no stack traces or secrets in responses. Malformed JSON -> 400. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r: any = exception.getResponse();
      const msg = status === 400 && exception.constructor.name !== 'BadRequestException'
        ? 'Malformed request.'
        : typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message ?? 'Error';
      return res.status(status).json({ error: status === 400 && /Unexpected token|in JSON at position|is not valid JSON/i.test(String(msg)) ? 'Malformed JSON.' : msg });
    }
    // body-parser syntax errors arrive as plain errors with status 400
    const anyEx = exception as any;
    if (anyEx?.status === 400 || anyEx?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    this.log.error(anyEx?.message ?? 'unknown error');
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

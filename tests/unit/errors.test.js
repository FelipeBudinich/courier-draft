import { AppError, toApiError } from '../../src/config/errors.js';

describe('API error shaping', () => {
  it('formats safe API errors with a request id', () => {
    const error = new AppError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Nope.'
    });

    expect(toApiError(error, 'req-123')).toEqual({
      statusCode: 403,
      body: {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Nope.'
        },
        requestId: 'req-123'
      }
    });
  });
});


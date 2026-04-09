export const sendApiOk = (res, data, statusCode = 200) =>
  res.status(statusCode).json({
    ok: true,
    data,
    requestId: res.locals.requestId
  });

export const sendNotImplemented = (res, route, todo) =>
  res.status(501).json({
    ok: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Not implemented in foundation PR.',
      details: {
        route,
        todo
      }
    },
    requestId: res.locals.requestId
  });


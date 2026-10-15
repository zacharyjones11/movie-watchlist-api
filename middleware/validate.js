function validate(schema, source) {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || source,
          message: issue.message
        }))
      });
    }
    // Express 5 exposes req.query as a getter; store validated values separately.
    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}

module.exports = validate;

module.exports.notFound = (req, res) => {
  if (req.path.startsWith('/gateway/')) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found'
      }
    });
  }

  res.status(404).render('error', {
    title: '404 - Not Found',
    message: 'The requested page was not found.',
    code: 404
  });
};

module.exports.errorHandler = (err, req, res, next) => {
  console.error('Server Error:', err);

  if (req.path.startsWith('/gateway/')) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }

  res.status(500).render('error', {
    title: '500 - Server Error',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'A server error occurred.',
    code: 500
  });
};
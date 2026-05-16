const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfMiddleware(req, res, next) {
  // Skip CSRF for GET, HEAD, OPTIONS — they are read-only
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    // Ensure the cookie exists for the next POST
    if (!req.cookies['csrf-token']) {
      const token = generateToken();
      res.cookie('csrf-token', token, {
        httpOnly: false,          // Must be readable by JS so frontend can set header
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return next();
  }

  // For mutating requests: validate
  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing CSRF token.' });
  }

  next();
}

function csrfTokenRoute(req, res) {
  // Called by frontend on page load to get/refresh the token
  let token = req.cookies['csrf-token'];
  if (!token) {
    token = generateToken();
    res.cookie('csrf-token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  res.json({ csrfToken: token });
}

module.exports = { csrfMiddleware, csrfTokenRoute };

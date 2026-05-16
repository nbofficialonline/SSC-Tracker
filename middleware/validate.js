const { body, validationResult } = require('express-validator');

// Call this at the end of any route that uses validators
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      ok: false,
      error: errors.array().map(e => e.msg).join('; ')
    });
  }
  next();
}

const validateLogin = [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Invalid username.'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password required.'),
  handleValidation,
];

const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3–50 chars.')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username: only letters, numbers, _ . -'),
  body('password')
    .isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 chars.'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name too long.'),
  handleValidation,
];

const validateTopicId = [
  body('topicId').trim().isLength({ min: 1, max: 200 }).withMessage('Invalid topicId.'),
  handleValidation,
];

module.exports = { handleValidation, validateLogin, validateRegister, validateTopicId };

const router = require('express').Router();
const reviews = require('../controllers/reviews');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');

router.get('/', validate(schemas.reviewQuery, 'query'), reviews.getAll);
router.get('/:id', validate(schemas.idParams, 'params'), reviews.getById);
router.post('/', validate(schemas.review, 'body'), reviews.create);
router.put('/:id', validate(schemas.idParams, 'params'), validate(schemas.review, 'body'), reviews.update);
router.delete('/:id', validate(schemas.idParams, 'params'), reviews.remove);

module.exports = router;

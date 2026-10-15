const router = require('express').Router();
const movies = require('../controllers/movies');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');

router.get('/', validate(schemas.movieQuery, 'query'), movies.getAll);
router.get('/:id', validate(schemas.idParams, 'params'), movies.getById);
router.post('/', validate(schemas.movie, 'body'), movies.create);
router.put('/:id', validate(schemas.idParams, 'params'), validate(schemas.movie, 'body'), movies.update);
router.delete('/:id', validate(schemas.idParams, 'params'), movies.remove);

module.exports = router;

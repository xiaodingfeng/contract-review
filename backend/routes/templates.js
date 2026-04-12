const express = require('express');
const { getAllTemplates } = require('../services/reviewTemplates');

const router = express.Router();

router.get('/', (req, res) => {
    res.json(getAllTemplates());
});

module.exports = router;

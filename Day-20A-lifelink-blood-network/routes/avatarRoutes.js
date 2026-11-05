const express = require('express');
const User = require('../models/User');
const { createAvatarDeliveryHandler } = require('../utils/avatarStorage');

const router = express.Router();

router.get('/:filename', createAvatarDeliveryHandler({
  User,
  getStorage: (req) => req.app.locals.storage
}));

module.exports = router;

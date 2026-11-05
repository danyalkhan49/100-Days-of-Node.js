const mongoose = require("mongoose");

function validateObjectId(req, res, next) {
  const id =
    req.params.id ||
    req.params.userId ||
    req.params.bloodRequestId ||
    req.params.donorId ||
    req.params.hospitalId;

  if (!id) {
    return next();
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid ObjectId format."
    });
  }

  next();
}

module.exports = validateObjectId;

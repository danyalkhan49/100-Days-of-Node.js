const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const protect = async (req, res, next) => {
	const authorization = req.headers.authorization;

	if (!authorization || !authorization.startsWith('Bearer ')) {
		return res.status(401).json({ message: 'Not authorized, no token' });
	}

	try {
		const token = authorization.split(' ')[1];
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const user = await User.findById(decoded.id).select('-password');

		if (!user) {
			return res.status(401).json({ message: 'Not authorized, user not found' });
		}

		req.user = user;
		return next();
	} catch (error) {
		return res.status(401).json({ message: 'Not authorized, token failed' });
	}
};

module.exports = protect;

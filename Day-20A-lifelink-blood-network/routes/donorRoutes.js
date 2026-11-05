const express = require('express');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/User');
const Block = require('../models/Block');
const Offer = require('../models/Offer');
const Review = require('../models/Review');
const { getCompatibleDonors, checkDonorEligibility } = require('../utils/bloodCompatibility');
const protect = require('../middleware/protect');
const restrictTo = require('../middleware/restrictTo');

const router = express.Router();
const MAX_PAGE_SIZE = 100;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function positiveInteger(value, name, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new AppError(`${name} must be a positive integer.`, 400);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new AppError(`${name} must be a positive integer.`, 400);
    }
    return parsed;
}

router.get(
    '/',
    protect,
    restrictTo('requester', 'admin'),
    catchAsync(async (req, res) => {
        const { bloodGroup, city, eligibleOnly, search } = req.query;
        const hasLatitude = req.query.latitude !== undefined;
        const hasLongitude = req.query.longitude !== undefined;
        if (hasLatitude !== hasLongitude) throw new AppError('latitude and longitude must be provided together.', 400);
        let coordinates;
        if (hasLatitude) {
            const latitude = Number(req.query.latitude);
            const longitude = Number(req.query.longitude);
            if (typeof req.query.latitude !== 'string' || typeof req.query.longitude !== 'string' ||
                !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
                !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
                throw new AppError('latitude and longitude must be valid decimal coordinates.', 400);
            }
            coordinates = [longitude, latitude];
        }
        const radiusKm = req.query.radiusKm === undefined ? 10 : Number(req.query.radiusKm);
        if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) {
            throw new AppError('radiusKm must be between 1 and 100.', 400);
        }
        const page = positiveInteger(req.query.page, 'page', 1);
        const limit = positiveInteger(req.query.limit, 'limit', 6);
        if (limit > MAX_PAGE_SIZE || !Number.isSafeInteger((page - 1) * limit)) {
            throw new AppError(`limit must not exceed ${MAX_PAGE_SIZE} and pagination must be safe.`, 400);
        }
        const sortFields = ['createdAt', 'name', 'bloodGroup', 'city', 'lastDonationDate', 'distance'];
        const sortBy = req.query.sortBy === undefined ? 'createdAt' : req.query.sortBy;
        const rawOrder = req.query.order === undefined ? 'desc' : req.query.order;
        if (typeof sortBy !== 'string' || !sortFields.includes(sortBy)) {
            throw new AppError('sortBy is not supported.', 400);
        }
        if (sortBy === 'distance' && !coordinates) {
            throw new AppError('sortBy=distance requires latitude and longitude.', 400);
        }
        if (typeof rawOrder !== 'string' || !['asc', 'desc'].includes(rawOrder.toLowerCase())) {
            throw new AppError('order must be asc or desc.', 400);
        }

        const filters = {
            role: 'donor',
            isActive: true,
            isAvailable: true
        };
        const blocks = await Block.find({
            $or: [{ blocker: req.user.id }, { blocked: req.user.id }]
        }).select('blocker blocked').lean();
        const excludedIds = blocks.map((block) =>
            String(block.blocker) === String(req.user.id) ? block.blocked : block.blocker
        );
        if (excludedIds.length) filters._id = { $nin: excludedIds };
        if (bloodGroup !== undefined && bloodGroup !== '') {
            if (typeof bloodGroup !== 'string') throw new AppError('bloodGroup is invalid.', 400);
            const compatible = getCompatibleDonors(bloodGroup);
            if (!compatible.length) throw new AppError('Invalid blood group.', 400);
            filters.bloodGroup = { $in: compatible };
        }
        if (city !== undefined && city !== '') {
            if (typeof city !== 'string') throw new AppError('city must be a string.', 400);
            filters.city = city;
        }
        if (search !== undefined && search !== '') {
            if (typeof search !== 'string') throw new AppError('search must be a string.', 400);
            filters.name = { $regex: escapeRegex(search), $options: 'i' };
        }

        let eligibilityFilter;
        if (eligibleOnly !== undefined && eligibleOnly !== '') {
            if (eligibleOnly !== 'true' && eligibleOnly !== 'false') {
                throw new AppError('eligibleOnly must be true or false.', 400);
            }
            if (eligibleOnly === 'true') {
                const gapDays = Number(process.env.DONATION_GAP_DAYS || 90);
                if (!Number.isFinite(gapDays) || gapDays < 0) {
                    throw new Error('Invalid DONATION_GAP_DAYS configuration.');
                }
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - gapDays);
                eligibilityFilter = {
                    $or: [
                        { lastDonationDate: { $exists: false } },
                        { lastDonationDate: null },
                        { lastDonationDate: { $lte: cutoff } }
                    ]
                };
                Object.assign(filters, eligibilityFilter);
            }
        }

        let total;
        let data;
        if (coordinates) {
            const [result] = await User.aggregate([
                {
                    $geoNear: {
                        near: { type: 'Point', coordinates },
                        key: 'location',
                        distanceField: 'distanceMeters',
                        maxDistance: radiusKm * 1000,
                        spherical: true,
                        query: filters
                    }
                },
                {
                    $facet: {
                        data: [
                            { $skip: (page - 1) * limit },
                            { $limit: limit },
                            {
                                $project: {
                                    name: 1,
                                    bloodGroup: 1,
                                    city: 1,
                                    avatar: 1,
                                    lastDonationDate: 1,
                                    distanceMeters: 1
                                }
                            }
                        ],
                        count: [{ $count: 'total' }]
                    }
                }
            ]);
            const donors = result ? result.data : [];
            total = result && result.count.length ? result.count[0].total : 0;
            data = donors.map((donor) => ({
                _id: donor._id,
                name: donor.name,
                bloodGroup: donor.bloodGroup,
                city: donor.city,
                avatar: donor.avatar,
                lastDonationDate: donor.lastDonationDate,
                distanceKm: Math.round(donor.distanceMeters / 100) / 10,
                eligible: checkDonorEligibility(donor.lastDonationDate).eligible
            }));
        } else {
            const [count, donors] = await Promise.all([
                User.countDocuments(filters),
                User.find(filters)
                    .select('name bloodGroup city avatar lastDonationDate')
                    .sort({ [sortBy]: rawOrder.toLowerCase() === 'asc' ? 1 : -1 })
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean()
            ]);
            total = count;
            data = donors.map((donor) => ({
                ...donor,
                eligible: checkDonorEligibility(donor.lastDonationDate).eligible
            }));
        }
        if (data.length) {
            const donorIds = data.map((donor) => donor._id);
            const [completedDonations, publishedReviews] = await Promise.all([
                Offer.aggregate([
                    {
                        $match: {
                            donor: { $in: donorIds },
                            status: 'Completed'
                        }
                    },
                    { $group: { _id: '$donor', total: { $sum: 1 } } }
                ]),
                Review.aggregate([
                    { $match: { reviewee: { $in: donorIds }, status: 'Published' } },
                    { $group: { _id: '$reviewee', average: { $avg: '$rating' }, total: { $sum: 1 } } }
                ])
            ]);
            const counts = new Map(completedDonations.map((item) => [String(item._id), item.total]));
            const ratings = new Map(publishedReviews.map((item) => [
                String(item._id),
                { average: Math.round(item.average * 10) / 10, total: item.total }
            ]));
            data = data.map((donor) => {
                const totalDonations = counts.get(String(donor._id)) || 0;
                const rating = ratings.get(String(donor._id));
                const badges = [
                    [1, 'First Donation'],
                    [5, '5 Donations'],
                    [10, '10 Donations'],
                    [25, '25 Donations']
                ].filter(([count]) => totalDonations >= count).map(([, badge]) => badge);
                return {
                    ...donor,
                    totalDonations,
                    badges,
                    averageRating: rating ? rating.average : null,
                    reviewCount: rating ? rating.total : 0
                };
            });
        }

        res.status(200).json({
            success: true,
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    })
);

module.exports = router;

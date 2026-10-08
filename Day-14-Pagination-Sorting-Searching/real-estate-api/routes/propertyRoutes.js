const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Property = require('../models/Property');
const Agent = require('../models/Agent');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
}

router.post('/' ,
    [
        body('title').notEmpty().withMessage('Title must be required'),
        body('city').notEmpty().withMessage('City must be required'),
        body('propertyType').isIn(['House', 'Apartment', 'Plot']).withMessage('Property Type must be House, Apartment or Plot'),
        body('price').isFloat({ min: 1 }).withMessage('Price must be a positive number'),
        body('areaMarla').isFloat({ min: 0.01 }).withMessage('areaMarla must be a positive number')
    ],
    handleValidation,
    catchAsync(async(req , res)=>{
        const threshold = Number(process.env.FEATURED_PRICE_THRESHOLD);
        const newProperty = new Property({
            ...req.body,
            isFeatured: Number(req.body.price) > threshold
        });
        const savedProperty = await newProperty.save();
        res.status(201).json({
            success : true ,
            data : savedProperty
        });
    })

)

router.get('/' ,catchAsync (async (req , res)=>{
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 6
    const skip = (page - 1 ) * limit ;
    const sortBy = req.query.sortBy || 'postedOn' ;
    const order = req.query.order || 'desc';
    const sortOrder = order === 'asc' ? 1 : -1
    let filter = [];
    if(req.query.search){
        filter.title = {
            $regex: req.query.search,
            $options: "i"
        };
    }
    if(req.query.price){
        filter.price = req.query.price
    };
    if(req.query.city){
        filter.city = req.query.city
    };
            if(req.query.minPrice || req.query.maxPrice) {

            filter.price = {};

            if (req.query.minPrice) {
                filter.price.$gte = Number(req.query.minPrice);
            }

            if (req.query.maxPrice) {
                filter.price.$lte = Number(req.query.maxPrice);
            }
        }

        const totalProperties = await Property.countDocuments(filter);
        const totalPages = Math.ceil(totalProperties / limit);


        const properties = await Property.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            page,
            totalPages,
            totalProperties,
            data: properties
        });


}))


router.get(
    "/:id",

    [
        param("id")
            .isMongoId()
            .withMessage("Invalid property ID")
    ],
    handleValidation,

    catchAsync(async (req, res) => {

        const property = await Property.findById(req.params.id);

        if (!property) {
            throw new AppError("Property not found", 404);
        }

        res.status(200).json({
            success: true,
            data: property
        });
    })
);

router.put('/:id/assign-agent',
    [
        param('id').isMongoId(),
        body('agentName').notEmpty().withMessage('Name must be required' )
    ],
    handleValidation ,
    catchAsync(async ( req , res)=>{
        const property = await Property.findById(req.params.id);
        if (!property) {
            throw new AppError('Property not found', 404);
        }
        if (property.status === 'Sold') {
            throw new AppError('Cannot assign agent to a sold property', 409);
        }

        const agent = await Agent.findOne({ name: req.body.agentName });
        if (!agent) {
            throw new AppError('Agent not found', 404);
        }

        property.agentAssigned = agent.name;
        await property.save();
        agent.activeListings = (agent.activeListings || 0) + 1;
        await agent.save();

        res.status(200).json({
            success: true,
            data: property
        });
    })
);

router.put('/:id/mark-sold',
    [param('id').isMongoId().withMessage('Invalid property ID')],
    handleValidation,
    catchAsync(async (req, res) => {
        const property = await Property.findById(req.params.id);
        if (!property) {
            throw new AppError('Property not found', 404);
        }
        if (property.status === 'Sold') {
            throw new AppError('Property is already marked as sold', 409);
        }

        property.status = 'Sold';
        await property.save();

        if (property.agentAssigned) {
            const agent = await Agent.findOne({ name: property.agentAssigned });
            if (agent) {
                agent.activeListings = Math.max(0, (agent.activeListings || 0) - 1);
                await agent.save();
            }
        }

        res.status(200).json({ success: true, data: property });
    })
);

router.get('/stats/summary', catchAsync(async (req, res) => {
    const [totalProperties, soldProperties, availableProperties, featuredProperties, priceStats] = await Promise.all([
        Property.countDocuments(),
        Property.countDocuments({ status: 'Sold' }),
        Property.countDocuments({ status: 'Available' }),
        Property.countDocuments({ isFeatured: true }),
        Property.aggregate([{ $group: { _id: null, averagePrice: { $avg: '$price' } } }])
    ]);

    res.status(200).json({
        success: true,
        data: {
            totalProperties,
            soldProperties,
            availableProperties,
            featuredProperties,
            averagePrice: priceStats[0]?.averagePrice || 0
        }
    });
}));

module.exports = router;


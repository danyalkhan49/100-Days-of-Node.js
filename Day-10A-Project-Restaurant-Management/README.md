# Restaurant Management System API

Backend REST API for managing a restaurant's menu, tables, orders, and staff — built with Node.js, Express, and MongoDB.

**Version:** 1.0
**Author:** Danyal
**Project Type:** Backend REST API (Node.js, Express, MongoDB)
**Prepared as part of:** 10-Day Node.js Backend Internship Simulation (Days 1–10)

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Core Resources](#core-resources)
- [Assumptions & Constraints](#assumptions--constraints)
- [Data Models](#data-models)
- [Functional Modules](#functional-modules)
- [API Endpoints](#api-endpoints)
- [Error Handling](#error-handling)
- [Folder Structure](#folder-structure)
- [Middleware](#middleware)
- [Sample Request/Response](#sample-requestresponse)
- [Acceptance Criteria](#acceptance-criteria)

---

## Overview

This project is a backend system (no frontend UI) that allows a restaurant to manage:

- **Menu items**
- **Dining tables** (availability status)
- **Customer orders** (placing, updating, completing)
- **Staff** records and their assigned duties
- Basic **reports/statistics** (revenue, order counts, table occupancy)

## Tech Stack

| Layer | Technology |
| --- | --- | --- | --- |
| Runtime | Node.js |
| Web Framework | Express.js |
| Database | MongoDB (local instance) |
| ODM | Mongoose |
| API Testing | Postman / Thunder Client |
| Version Control | Git + GitHub |

## Core Resources

1. **MenuItem** — dishes available to order
2. **Table** — physical dining tables in the restaurant
3. **Order** — a customer order linked to a table and one or more menu items
4. **Staff** — restaurant employees (waiters, chefs, managers)

## Assumptions & Constraints

- No authentication/login system in this version
- Single restaurant (not multi-branch)
- All prices are in a single currency (Rs.)
- No real payments — only records amounts

---

## Data Models

### MenuItem

| Field | Type | Notes |
| --- | --- | --- | --- |
| name | String | required |
| category | String | e.g. "Starter", "Main Course", "Dessert", "Beverage" |
| price | Number | required |
| isAvailable | Boolean | default: true |
| addedOn | Date | default: Date.now |

### Table

| Field | Type | Notes |
| --- | --- | --- | --- |
| tableNumber | Number | required, unique per table |
| capacity | Number | number of seats |
| status | String | "Free", "Occupied", "Reserved" — default: "Free" |

### Staff

| Field | Type | Notes |
| --- | --- | --- | --- |
| name | String | required |
| role | String | "Waiter", "Chef", "Manager" |
| shift | String | "Morning", "Evening", "Night" |
| isActive | Boolean | default: true |

### Order

| Field | Type | Notes |
| --- | --- | --- | --- |
| tableNumber | Number | required — links order to a table |
| items | Array of Objects | each: `{ menuItemName: String, quantity: Number, price: Number }` |
| totalAmount | Number | calculated — sum of (price × quantity) |
| status | String | "Pending", "Preparing", "Served", "Paid" — default: "Pending" |
| waiterAssigned | String | name of staff handling the order |
| createdAt | Date | default: Date.now |

> **Note:** `items` stores a snapshot of item name/price at order time, so historical orders stay accurate even if menu prices change later.

---

## Functional Modules

### Module A — Menu Management

- Create a new menu item
- Retrieve all menu items (filter by `category`)
- Retrieve a single menu item by ID
- Update a menu item
- Delete a menu item
- Toggle a menu item's availability

### Module B — Table Management

- Create a new table
- Retrieve all tables (filter by `status`)
- Update a table's status
- Delete a table
- Prevent orders on non-existent tables

### Module C — Staff Management

- Add a new staff member
- Retrieve all staff (filter by `role`)
- Update staff details
- Deactivate staff (soft delete)
- Permanently delete a staff record

### Module D — Order Management (Core Business Logic)

- Place a new order for a table with items/quantities
- Auto-calculate `totalAmount` based on current menu prices
- Auto-set table `status` to `"Occupied"` on order placement
- Reject orders for unavailable/nonexistent menu items
- Retrieve all orders (filter by `status`)
- Retrieve a single order by ID

- Update order status (Pending → Preparing → Served → Paid)
- Auto-free the table when order status becomes `"Paid"`
- Cancel/delete an order

### Module E — Reports & Statistics

- Summary report: total orders, total revenue, occupied vs free tables
- Top 3 best-selling menu items by quantity

---

## API Endpoints

**Base URL:** `http://localhost:8600`

### Menu (`/menu`)

| Method | Endpoint | Description | Status |
|---|---|---|---|| POST | `/menu` | Add new menu item | 201 |
| GET | `/menu` | Get all menu items (`?category=`) | 200 |
| GET | `/menu/:id` | Get single menu item | 200 |
| PUT | `/menu/:id` | Update menu item | 200 |
| PUT | `/menu/:id/toggle-availability` | Toggle isAvailable | 200 |
| DELETE | `/menu/:id` | Delete menu item | 200 |

### Tables (`/tables`)

| Method | Endpoint | Description | Status |
| --- | --- | --- | --- |
| POST | `/tables` | Add new table | 201 |
| GET | `/tables` | Get all tables (`?status=`) | 200 |
| PUT | `/tables/:id` | Update table status/capacity | 200 |
| DELETE | `/tables/:id` | Delete table | 200 |

### Staff (`/staff`)

| Method | Endpoint | Description | Status |
| --- | --- | --- | --- |
| POST | `/staff` | Add new staff member | 201 |
| GET | `/staff` | Get all staff (`?role=`) | 200 |
| PUT | `/staff/:id` | Update staff details | 200 |
| PUT | `/staff/:id/deactivate` | Soft-delete staff | 200 |
| DELETE | `/staff/:id` | Permanently delete staff | 200 |

### Orders (`/orders`)

> ⚠️ `/orders/stats/summary` and `/orders/stats/top-items` must be declared **before** `/orders/:id`, otherwise Express treats "stats" as an `:id` value.

| Method | Endpoint | Description | Status |
| --- | --- | --- | --- |
| POST | `/orders` | Place a new order | 201 |
| GET | `/orders` | Get all orders (`?status=`) | 200 |
| GET | `/orders/:id` | Get single order | 200 |
| PUT | `/orders/:id/status` | Update order status | 200 |
| DELETE | `/orders/:id` | Cancel/delete an order | 200 |
| GET | `/orders/stats/summary` | Revenue & table occupancy summary | 200 |
| GET | `/orders/stats/top-items` | Top 3 best-selling items | 200 |

---

## Error Handling

| Scenario | Status | Example Response |
| --- | --- | --- | --- |
| Resource not found | 404 | `{ "success": false, "error": "Menu item not found" }` |
| Invalid/missing input | 400 | `{ "success": false, "error": "Quantity must be greater than 0" }` |
| Conflicting state | 409 | `{ "success": false, "error": "Item is currently unavailable" }` |
| Unhandled server error | 500 | `{ "success": false, "error": "Something went wrong on our end!" }` |

All responses follow: `{ success: true/false, data / error }`

---

## Folder Structure

restaurant-management-api/
├── config/
│   └── db.js                  → MongoDB connection logic
├── models/
│   ├── MenuItem.js
│   ├── Table.js
│   ├── Staff.js
│   └── Order.js
├── routes/
│   ├── menuRoutes.js
│   ├── tableRoutes.js
│   ├── staffRoutes.js
│   └── orderRoutes.js
├── middleware/
│   ├── logger.js               → logs every request
│   └── errorHandler.js         → global error-catching middleware
├── server.js                   → connects everything, starts the server
├── package.json
└── node_modules/

## Middleware

| Middleware | Type | Applied To | Behavior |
| --- | --- | --- | --- |
| `logger` | Global | All routes | Logs `[timestamp] METHOD /url` |
| `checkMenuItemExists` | Route-specific | `/menu/:id` routes | Verifies menu item exists |
| `checkTableExists` | Route-specific | `/tables/:id`, order placement | Verifies table exists |
| `errorHandler` | Global (error) | Registered last | Catches errors via `next(err)`, returns 500 |

---

## Sample Request/Response

**Request:** `POST /orders`
json
{
  "tableNumber": 5,
  "items": [
    { "menuItemName": "Chicken Karahi", "quantity": 2 },
    { "menuItemName": "Coke", "quantity": 3 }
  ],
  "waiterAssigned": "Ali"
}

**Response (201):**
json
{
  "success": true,
  "data": {
    "tableNumber": 5,
    "items": [
      { "menuItemName": "Chicken Karahi", "quantity": 2, "price": 800 },
      { "menuItemName": "Coke", "quantity": 3, "price": 100 }
    ],
    "totalAmount": 1900,
    "status": "Pending",
    "waiterAssigned": "Ali",
    "createdAt": "2026-09-18T10:30:00.000Z"
  }
}

## Acceptance Criteria

- [ ] All 4 models created with correct schema fields
- [ ] All endpoints implemented with correct status codes
- [ ] Placing an order sets table status to "Occupied"
- [ ] Marking an order "Paid" frees the table
- [ ] Orders reject unavailable menu items
- [ ] Global error handler prevents server crashes
- [ ] Code organized per folder structure above
- [ ] All endpoints tested in Postman/Thunder Client
- [ ] Code pushed to GitHub with meaningful commits

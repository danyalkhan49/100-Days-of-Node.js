# LifeLink Blood Network

A blood donation and emergency blood request management platform built with Node.js, Express.js, MongoDB, and vanilla JavaScript.

LifeLink aims to connect blood donors, patients, requesters, and hospitals through a centralized platform that helps users discover donors and manage blood donation requests.

## Features

- User registration and authentication
- Email verification and account security
- Donor and hospital directories
- Blood request management
- Donor offers and request tracking
- Blood group compatibility support
- User profiles and avatar management
- In-app notifications
- Admin management routes
- Support, reports, ratings, and reviews
- Responsive web interface
- Secure file and document handling features

## Technology Stack

- **Backend:** Node.js, Express.js
- **Database:** MongoDB, Mongoose
- **Frontend:** HTML5, CSS3, JavaScript
- **Authentication:** Project authentication and session mechanisms
- **Testing:** Node.js built-in test runner

## Project Structure

```text
lifelink-blood-network/
├── config/
├── docs/
├── middleware/
├── models/
├── public/
│   ├── css/
│   ├── images/
│   ├── js/
│   └── *.html
├── routes/
├── scripts/
├── test/
├── uploads/
├── server.js
└── package.json
```

## Getting Started

### 1. Clone the repository

```bash
git clone <your-repository-url>
```

### 2. Open the project directory

```bash
cd Day-20A-lifelink-blood-network
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a local `.env` file using the environment configuration required by the project.

Configure your MongoDB connection and other required settings using the project's operations documentation.

Never commit `.env` files, passwords, API keys, or private credentials.

### 5. Start the development server

```bash
npm run dev
```

The application uses the configured `PORT` environment variable.

## Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start development server |
| `npm start` | Start application |
| `npm test` | Run automated tests |
| `npm run health` | Check server health |
| `npm run check:production-config` | Check production configuration |

## Testing

The current project verification includes:

- 362 automated tests passed
- 134 JavaScript files passed syntax checking
- 15 frontend JavaScript files passed syntax checking

Browser-level testing and deployment verification are still pending.

## Documentation

Additional project documentation:

- `docs/operations.md` — Operations, configuration, and technical procedures.
- `docs/release-checklist.md` — Verification status and outstanding release requirements.

## Project Status

**Portfolio / Development Project**

LifeLink is being prepared as a full-stack portfolio project. Production deployment, live service integrations, and final browser-level verification have not been completed.

Use synthetic test data for development and testing.

## Author

**Danyal Khan**

Full-Stack JavaScript / Node.js Developer

GitHub: https://github.com/danyalkhan49

---

*Built as part of a hands-on Node.js learning and development journey.*
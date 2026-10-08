# 🚀 **Day 12 of My Node.js Learning Journey!**
Today's practice: **Environment Variables & Config Management** — built a small Weather Alert Service to apply it. Here's what I learned:

🔹 **The problem with hardcoding** — Port numbers, thresholds, messages — none of this should live directly in the code. If it needs to change per environment (dev, production) or contains sensitive data, it belongs in a `.env` file.

🔹 **Setting up `.env`:**
PORT=6300
CITY_NAME=Rawalpindi
TEMP_THRESHOLD=40
ALERT_MESSAGE=Heatwave warning issued for the city!
🔹 **dotenv** — Loaded right at the very top of the file, before anything else runs, so all the config values are available immediately:

```js
require('dotenv').config();
```

🔹 **Reading values from `process.env`** — Important catch: everything from `.env` comes in as a **string**, even numbers. So values used in comparisons need an explicit conversion:

```js
const threshold = Number(process.env.TEMP_THRESHOLD);
const currentTemp = Number(req.params.currentTemp);
```

🔹 **Building the logic** — A route that compares live temperature against the configured threshold and returns a dynamic alert or normal message, using the city name and message straight from `.env`.

🔹 **The real test** — Changed `TEMP_THRESHOLD` in `.env`, restarted the server, and watched the exact same request produce a different result. That's when it really clicked — the config was actually driving the app's behavior, not the code itself.

🔹 **`.gitignore`** — Made sure `.env` never gets pushed to GitHub, since in real projects this file often holds sensitive keys and credentials.

Small concept, but a genuinely important habit for writing configurable, production-safe backend code. 💻🔥

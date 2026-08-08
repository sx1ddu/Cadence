const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const env = require("./config/env");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const authRoutes = require("./modules/auth/auth.routes");
const meRoutes = require("./modules/users/me.routes");
const userPublicRoutes = require("./modules/users/user.routes");
const scheduleRoutes = require("./modules/schedules/schedule.routes");
const eventTypeRoutes = require("./modules/event-types/eventType.routes");
const bookingRoutes = require("./modules/bookings/booking.routes");
const teamRoutes = require("./modules/teams/team.routes");
const teamPublicRoutes = require("./modules/teams/teamPublic.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true, // allow cookies to be sent cross-origin (web app <-> API)
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(env.cookieSecret));
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/health", (req, res) => res.json({ success: true, message: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/event-types", eventTypeRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/team-pages", teamPublicRoutes);
app.use("/api/users", userPublicRoutes);

// TODO (next features): mount /api/calendars, /api/webhooks,
// /api/payments as they're built.

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

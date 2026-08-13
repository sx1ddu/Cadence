const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./analytics.controller");

const router = express.Router();

router.use(authenticate);

router.get("/dashboard", controller.getDashboard);
router.get("/overview", controller.getOverview);
router.get("/by-event-type", controller.getByEventType);
router.get("/over-time", controller.getOverTime);
router.get("/teams/:teamId", controller.getTeamStats);

module.exports = router;

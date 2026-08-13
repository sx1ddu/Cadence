const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./calendar.controller");

const router = express.Router();

// Google redirects the BROWSER here directly, so this must stay public
// (see calendar.controller.js's handleCallback for how it identifies the user).
router.get("/google/callback", controller.handleCallback);

router.use(authenticate);
router.get("/google/connect", controller.getConnectUrl);
router.get("/status", controller.getStatus);
router.delete("/google", controller.disconnect);

module.exports = router;

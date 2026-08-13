const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate, requireRole } = require("../../middleware/authenticate");
const controller = require("./admin.controller");
const { setUserActiveSchema, setUserRoleSchema } = require("./admin.validation");

const router = express.Router();

router.use(authenticate, requireRole("admin"));

router.get("/stats", controller.getStats);
router.get("/users", controller.listUsers);
router.patch("/users/:userId/active", validate(setUserActiveSchema), controller.setUserActive);
router.patch("/users/:userId/role", validate(setUserRoleSchema), controller.setUserRole);
router.get("/bookings", controller.getBookingsOverview);
router.get("/teams", controller.getTeamsOverview);

module.exports = router;

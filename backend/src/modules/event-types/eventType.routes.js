const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./eventType.controller");
const { createEventTypeSchema, updateEventTypeSchema } = require("./eventType.validation");

const router = express.Router();

// Private management routes (owner only)
router.get("/", authenticate, controller.list);
router.get("/team/:teamId", authenticate, controller.listForTeam);
router.post("/", authenticate, validate(createEventTypeSchema), controller.create);
router.get("/:id", authenticate, controller.getOne);
router.patch("/:id", authenticate, validate(updateEventTypeSchema), controller.update);
router.delete("/:id", authenticate, controller.remove);

module.exports = router;

const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./schedule.controller");
const { createScheduleSchema, updateScheduleSchema, overrideSchema } = require("./schedule.validation");

const router = express.Router();

router.use(authenticate); // every schedule route requires a logged-in owner

router.get("/", controller.list);
router.post("/", validate(createScheduleSchema), controller.create);
router.get("/:id", controller.getOne);
router.patch("/:id", validate(updateScheduleSchema), controller.update);
router.delete("/:id", controller.remove);

router.post("/:id/overrides", validate(overrideSchema), controller.addOverride);
router.delete("/:id/overrides/:overrideId", controller.deleteOverride);

module.exports = router;

const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./webhook.controller");
const { createWebhookSchema, updateWebhookSchema } = require("./webhook.validation");

const router = express.Router();

router.use(authenticate);

router.get("/", controller.list);
router.post("/", validate(createWebhookSchema), controller.create);
router.patch("/:id", validate(updateWebhookSchema), controller.update);
router.delete("/:id", controller.remove);
router.get("/:id/deliveries", controller.listDeliveries);

module.exports = router;

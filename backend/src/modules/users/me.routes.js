const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const authController = require("../auth/auth.controller");
const userController = require("./user.controller");
const { updateProfileSchema } = require("./user.validation");

const router = express.Router();

router.use(authenticate);

router.get("/", authController.me); // GET /api/me
router.patch("/", validate(updateProfileSchema), userController.updateMe); // PATCH /api/me

module.exports = router;

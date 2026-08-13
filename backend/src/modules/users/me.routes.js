const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const { upload } = require("../../middleware/upload");
const authController = require("../auth/auth.controller");
const userController = require("./user.controller");
const { updateProfileSchema } = require("./user.validation");

const router = express.Router();

router.use(authenticate);

router.get("/", authController.me); // GET /api/me
router.patch("/", validate(updateProfileSchema), userController.updateMe); // PATCH /api/me
router.post("/avatar", upload.single("avatar"), userController.uploadAvatar); // POST /api/me/avatar

module.exports = router;

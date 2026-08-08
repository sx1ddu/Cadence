const express = require("express");
const validate = require("../../middleware/validate");
const rateLimit = require("../../middleware/rateLimit");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./auth.controller");
const {
  signupSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("./auth.validation");

const router = express.Router();

router.post("/signup", validate(signupSchema), controller.signup);

router.post("/verify-email", validate(verifyEmailSchema), controller.verifyEmail);

router.post(
  "/resend-verification",
  rateLimit({ keyPrefix: "resend-verification", windowSec: 300, max: 3 }),
  validate(resendVerificationSchema),
  controller.resendVerification
);

router.post(
  "/login",
  rateLimit({ keyPrefix: "login", windowSec: 60, max: 10 }),
  validate(loginSchema),
  controller.login
);

router.post("/refresh", controller.refresh);

router.post("/logout", controller.logout);

router.post("/logout-all", authenticate, controller.logoutAllDevices);

router.post(
  "/forgot-password",
  rateLimit({ keyPrefix: "forgot-password", windowSec: 300, max: 3 }),
  validate(forgotPasswordSchema),
  controller.forgotPassword
);

router.post("/reset-password", validate(resetPasswordSchema), controller.resetPassword);

router.get("/me", authenticate, controller.me);

module.exports = router;

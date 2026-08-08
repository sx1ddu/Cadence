const { z } = require("zod");

const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Username can only contain lowercase letters, numbers, and hyphens");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72) // bcrypt silently truncates beyond 72 bytes — enforce it up front
  .regex(/[a-zA-Z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  username: usernameSchema,
  email: z.string().email("Invalid email address").max(255),
  password: passwordSchema,
  timezone: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  newPassword: passwordSchema,
});

module.exports = {
  signupSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};

/**
 * Seeds a single demo account so you can log in and test the API right
 * after running migrations, without going through the email verification
 * flow first. Safe to re-run — it skips creation if the demo user already
 * exists.
 *
 * Run with: npm run db:seed
 */
const { pool } = require("../config/db");
const userRepo = require("../modules/users/user.repository");
const { hashPassword } = require("../utils/password");

const DEMO_EMAIL = "demo@cadence.dev";
const DEMO_PASSWORD = "Password123";

async function seed() {
  const existing = await userRepo.findByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`[seed] demo user already exists (${DEMO_EMAIL}), skipping.`);
    await pool.end();
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await userRepo.createUser({
    name: "Demo User",
    username: "demo",
    email: DEMO_EMAIL,
    passwordHash,
    timezone: "UTC",
  });
  await userRepo.markEmailVerified(user.id);

  console.log("[seed] created demo user:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log("  (already email-verified, ready to log in)");

  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

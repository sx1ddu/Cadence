const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("./helpers/client");
const { getTestDbPool, uniqueUser, signupAndVerify, createLoggedInUser } = require("./helpers/testUtils");

describe("Auth", () => {
  test("signup creates an unverified account", async () => {
    const client = createClient();
    const user = uniqueUser("signup");
    const res = await client.post("/api/auth/signup", {
      name: user.name,
      username: user.username,
      email: user.email,
      password: user.password,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, user.email);
    assert.equal(res.body.data.user.emailVerified, false);
  });

  test("signup rejects a duplicate email", async () => {
    const client = createClient();
    const user = await signupAndVerify(createClient());
    const res = await client.post("/api/auth/signup", {
      name: "Someone Else",
      username: uniqueUser().username,
      email: user.email, // duplicate
      password: "AnotherPass123",
    });
    assert.equal(res.status, 409);
  });

  test("login succeeds with correct credentials after verification", async () => {
    const client = createClient();
    const user = await signupAndVerify(client);
    const res = await client.post("/api/auth/login", { email: user.email, password: user.password });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, user.email);
    assert.ok(res.body.data.accessToken, "expected an accessToken in the response body");
  });

  test("login fails with wrong password", async () => {
    const client = createClient();
    const user = await signupAndVerify(client);
    const res = await client.post("/api/auth/login", { email: user.email, password: "WrongPassword123" });
    assert.equal(res.status, 401);
  });

  test("GET /api/auth/me requires authentication", async () => {
    const client = createClient();
    const res = await client.get("/api/auth/me");
    assert.equal(res.status, 401);
  });

  test("GET /api/auth/me returns the logged-in user", async () => {
    const { client, user } = await createLoggedInUser("me");
    const res = await client.get("/api/auth/me");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, user.email);
  });

  test("refresh token rotation issues a new access token", async () => {
    const { client } = await createLoggedInUser("refresh");
    const first = await client.post("/api/auth/refresh");
    assert.equal(first.status, 200);
    assert.ok(first.body.data.accessToken);
    // Cookies auto-update in the client jar after each request, so a second
    // call correctly uses the newly-rotated cookie and should also succeed.
    const second = await client.post("/api/auth/refresh");
    assert.equal(second.status, 200);
  });

  test("a revoked refresh token (via logout) is rejected on the next refresh attempt", async () => {
    const { client } = await createLoggedInUser("reuse");
    const logoutRes = await client.post("/api/auth/logout");
    assert.equal(logoutRes.status, 200);

    const afterLogout = await client.post("/api/auth/refresh");
    assert.equal(afterLogout.status, 401, "refresh must fail once the token has been revoked by logout");
  });

  test("logout clears the session so /me is no longer authorized", async () => {
    const { client } = await createLoggedInUser("logout");
    const before = await client.get("/api/auth/me");
    assert.equal(before.status, 200);

    const logoutRes = await client.post("/api/auth/logout");
    assert.equal(logoutRes.status, 200);

    const after = await client.get("/api/auth/me");
    assert.equal(after.status, 401);
  });

  test("logout-all revokes every session", async () => {
    const { client } = await createLoggedInUser("logoutall");
    const res = await client.post("/api/auth/logout-all");
    assert.equal(res.status, 200);
    const after = await client.post("/api/auth/refresh");
    assert.equal(after.status, 401);
  });

  test("email verification: an invalid token is rejected", async () => {
    const client = createClient();
    const res = await client.post("/api/auth/verify-email", { token: "not-a-real-token" });
    assert.equal(res.status, 400);
  });

  test("email verification: signup queues a valid, unused, unexpired token", async () => {
    // We can't intercept the actual email (only its hash is ever stored —
    // see password.js's generateSecureToken), so this test verifies the
    // token record itself is correctly created rather than driving the
    // endpoint fully end-to-end. The endpoint's accept/reject logic is
    // covered by the "invalid token is rejected" test above and by the
    // atomic-claim behavior documented in token.repository.js.
    const client = createClient();
    const user = uniqueUser("verify");
    await client.post("/api/auth/signup", {
      name: user.name,
      username: user.username,
      email: user.email,
      password: user.password,
    });

    const pool = getTestDbPool();
    const [rows] = await pool.query(
      `SELECT et.used_at, et.expires_at FROM email_verification_tokens et
       JOIN users u ON u.id = et.user_id WHERE u.email = ? ORDER BY et.id DESC LIMIT 1`,
      [user.email]
    );
    assert.equal(rows.length, 1, "expected exactly one verification token row after signup");
    assert.equal(rows[0].used_at, null);
    assert.ok(new Date(rows[0].expires_at) > new Date(), "token should not be expired yet");
  });

  test("forgot-password does not reveal whether an email exists (same response either way)", async () => {
    const client = createClient();
    const existing = await signupAndVerify(createClient());

    const resExisting = await client.post("/api/auth/forgot-password", { email: existing.email });
    const resNonexistent = await client.post("/api/auth/forgot-password", {
      email: "definitely-not-a-real-user@example.com",
    });

    assert.equal(resExisting.status, 200);
    assert.equal(resNonexistent.status, 200);
    assert.equal(resExisting.body.message, resNonexistent.body.message);
  });

  test("reset-password rejects an invalid token", async () => {
    const client = createClient();
    const res = await client.post("/api/auth/reset-password", {
      token: "not-a-real-token",
      newPassword: "NewPassword123",
    });
    assert.equal(res.status, 400);
  });

  test("password reset token record is created and claimable exactly once (DB-level atomicity check)", async () => {
    const client = createClient();
    const user = await signupAndVerify(client);
    await client.post("/api/auth/forgot-password", { email: user.email });

    const pool = getTestDbPool();
    const [rows] = await pool.query(
      `SELECT id, token_hash, used_at FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id WHERE u.email = ? ORDER BY prt.id DESC LIMIT 1`,
      [user.email]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].used_at, null);

    // Directly exercise the atomic claim query the service uses, twice in a
    // row, to prove only the FIRST claim can succeed — this is the exact
    // mechanism that closes the password-reset race condition.
    const [firstClaim] = await pool.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()",
      [rows[0].token_hash]
    );
    assert.equal(firstClaim.affectedRows, 1, "first claim should succeed");

    const [secondClaim] = await pool.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()",
      [rows[0].token_hash]
    );
    assert.equal(secondClaim.affectedRows, 0, "second claim of the same token must fail");
  });
});

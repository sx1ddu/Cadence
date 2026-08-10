/**
 * A minimal HTTP client for the integration tests, built on Node's
 * built-in fetch (Node 18+) — no supertest/axios dependency needed.
 *
 * Handles cookies manually (a simple in-memory jar) since the API uses
 * httpOnly cookies for auth, not just Authorization headers.
 */
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4000";

function createClient() {
  let cookieJar = "";

  function extractCookies(response) {
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) return;
    // Node's fetch only exposes ONE combined set-cookie header string per
    // response even when multiple Set-Cookie headers were sent — good
    // enough here since we just need the raw name=value pairs forwarded
    // on the next request, not full cookie attribute parsing.
    const pairs = setCookie.split(/,(?=[^;]+?=)/).map((c) => c.split(";")[0].trim());
    cookieJar = pairs.join("; ");
  }

  async function request(method, path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookieJar ? { Cookie: cookieJar } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    extractCookies(response);
    let json = null;
    try {
      json = await response.json();
    } catch {
      // no body / non-JSON response
    }
    return { status: response.status, body: json };
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path) => request("DELETE", path),
    clearCookies: () => {
      cookieJar = "";
    },
  };
}

module.exports = { createClient, BASE_URL };

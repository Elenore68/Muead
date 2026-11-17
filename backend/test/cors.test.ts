import "./helpers/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, corsOrigin, router, json } from "../src/lib/http";

const env = { ALLOWED_ORIGIN: "https://main.abc.amplifyapp.com,http://localhost:8002" } as NodeJS.ProcessEnv;

test("allowed origins come from a comma-separated list", () => {
  assert.deepEqual(allowedOrigins(env), ["https://main.abc.amplifyapp.com", "http://localhost:8002"]);
  assert.deepEqual(allowedOrigins({ ALLOWED_ORIGIN: " http://localhost:8002 " } as NodeJS.ProcessEnv), ["http://localhost:8002"]);
  assert.deepEqual(allowedOrigins({} as NodeJS.ProcessEnv), []);
});

test("an allowed request origin is echoed; anything else gets the first allowed origin (never * and never the stranger)", () => {
  assert.equal(corsOrigin("http://localhost:8002", env), "http://localhost:8002");
  assert.equal(corsOrigin("https://main.abc.amplifyapp.com", env), "https://main.abc.amplifyapp.com");
  assert.equal(corsOrigin("https://evil.example", env), "https://main.abc.amplifyapp.com");
  assert.equal(corsOrigin(undefined, env), "https://main.abc.amplifyapp.com");
});

test("every response from the router carries the matching origin, success and errors alike", async () => {
  const saved = process.env.ALLOWED_ORIGIN;
  process.env.ALLOWED_ORIGIN = env.ALLOWED_ORIGIN;
  try {
    const h = router({ "GET /ok": async () => json(200, { ok: true }), "GET /boom": async () => { throw new Error("x"); } });
    const ev = (resource: string, headers: Record<string, string>) =>
      ({ httpMethod: "GET", resource, headers, body: null, queryStringParameters: null, pathParameters: null, requestContext: { requestId: "t", authorizer: { claims: { sub: "00000000-0000-0000-0000-000000000001", "cognito:groups": "" } } } }) as any;
    assert.equal((await h(ev("/ok", { origin: "http://localhost:8002" }))).headers!["Access-Control-Allow-Origin"], "http://localhost:8002");
    assert.equal((await h(ev("/ok", { Origin: "https://main.abc.amplifyapp.com" }))).headers!["Access-Control-Allow-Origin"], "https://main.abc.amplifyapp.com");
    assert.equal((await h(ev("/missing", { origin: "http://localhost:8002" }))).headers!["Access-Control-Allow-Origin"], "http://localhost:8002", "404 route");
    const boom = await h(ev("/boom", { origin: "http://localhost:8002" }));
    assert.deepEqual([boom.statusCode, boom.headers!["Access-Control-Allow-Origin"]], [500, "http://localhost:8002"]);
    assert.equal((await h(ev("/ok", { origin: "https://evil.example" }))).headers!["Access-Control-Allow-Origin"], "https://main.abc.amplifyapp.com");
  } finally {
    process.env.ALLOWED_ORIGIN = saved;
  }
});

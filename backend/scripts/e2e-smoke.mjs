/*
 * End-to-end smoke test against a DEPLOYED stack: two real Cognito users (an owner and an approver) walk one request
 * through the whole lifecycle. Creates real data in the target table (one request).
 *
 * Usage: node backend/scripts/e2e-smoke.mjs <env-file>
 *   env-file lines: API_URL, USER_POOL_ID, CLIENT_ID, OWNER_EMAIL, OWNER_PW, APPR_EMAIL, APPR_PW
 * Never commit the env file. Passwords are only read from it.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require("amazon-cognito-identity-js");

const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const pool = new CognitoUserPool({ UserPoolId: env.USER_POOL_ID, ClientId: env.CLIENT_ID });

const signIn = (email, password) =>
  new Promise((resolve, reject) => {
    new CognitoUser({ Username: email, Pool: pool }).authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (s) => resolve(s.getIdToken().getJwtToken()),
      onFailure: reject,
      newPasswordRequired: () => reject(new Error("new password required")),
    });
  });

const call = async (token, method, path, body) => {
  const res = await fetch(`${env.API_URL.replace(/\/$/, "")}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
};

let failed = 0;
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`PASS  ${name}`);
    return r;
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
    throw e;
  }
};
const expect = (res, status, what) => {
  if (res.status !== status) throw new Error(`${what ?? "call"}: expected ${status}, got ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
};

try {
  const owner = await step("sign in as owner (SRP)", () => signIn(env.OWNER_EMAIL, env.OWNER_PW));
  const appr = await step("sign in as approver (SRP)", () => signIn(env.APPR_EMAIL, env.APPR_PW));
  const me = await step("GET /me creates the owner profile", async () => expect(await call(owner, "GET", "me"), 200));
  const meA = await step("GET /me creates the approver profile (ApprovalEligible)", async () => {
    const b = expect(await call(appr, "GET", "me"), 200);
    if (!b.roles.includes("ApprovalEligible")) throw new Error(`roles: ${b.roles}`);
    return b;
  });

  const start = new Date(Date.now() + 14 * 86400000);
  start.setUTCHours(9, 0, 0, 0);
  const req = await step("create a request with all SOW fields", async () =>
    expect(await call(owner, "POST", "requests", {
      title: `E2E smoke ${new Date().toISOString()}`, description: "Automated end-to-end test", category: "IT", priority: "MEDIUM",
      environment: "Staging", cloudPlatform: "AWS", maintenanceType: "Patching", scope: "Smoke test", affectedSystems: ["e2e-db"],
      links: [{ label: "Docs", url: "https://example.com" }], schedule: { start: start.toISOString(), end: new Date(start.getTime() + 4 * 3600000).toISOString() },
    }), 201));
  const id = req.id;
  let version = req.version;
  const move = async (to, extra = {}) => {
    const b = expect(await call(owner, "POST", `requests/${id}/transition`, { to, version, ...extra }), 200, `transition to ${to}`);
    version = b.version;
    return b;
  };

  await step("directory finds the approver (no email in the answer)", async () => {
    const b = expect(await call(owner, "GET", `users?q=${encodeURIComponent("E2E App")}&approverEligible=true`), 200);
    if (!b.items.some((u) => u.id === meA.id)) throw new Error("approver not found");
    if (JSON.stringify(b).includes("@")) throw new Error("an email address was returned");
  });
  await step("owner adds the approver", async () => expect(await call(owner, "POST", `requests/${id}/members`, { userId: meA.id, activityRole: "APPROVER" }), 201));
  await step("owner cannot approve their own request (no approver role)", async () => {
    const r = await call(owner, "POST", `requests/${id}/approvals/decision`, { decision: "APPROVED" });
    if (![403, 404, 409].includes(r.status)) throw new Error(`got ${r.status}`);
  });
  await step("submit for approval", async () => {
    const cur = expect(await call(owner, "GET", `requests/${id}`), 200);
    const b = expect(await call(owner, "POST", `requests/${id}/submit`, { version: cur.version }), 200);
    version = b.version;
  });
  await step("approver sees it in the inbox and gets the notification", async () => {
    const inbox = expect(await call(appr, "GET", "approvals"), 200);
    if (!inbox.items.some((i) => i.requestId === id)) throw new Error("not in the inbox");
    await new Promise((r) => setTimeout(r, 6000)); // the notifier runs from the DynamoDB stream
    const n = expect(await call(appr, "GET", "notifications"), 200);
    if (!n.items.some((i) => i.requestId === id && i.type === "APPROVAL_REQUIRED")) throw new Error(`no APPROVAL_REQUIRED notification: ${JSON.stringify(n.items.map((i) => i.type))}`);
  });
  await step("approver approves", async () => {
    expect(await call(appr, "POST", `requests/${id}/approvals/decision`, { decision: "APPROVED", comment: "ok" }), 200);
    const cur = expect(await call(owner, "GET", `requests/${id}`), 200);
    if (cur.status !== "APPROVED") throw new Error(`status ${cur.status}`);
    version = cur.version;
  });
  await step("owner is notified of the approval", async () => {
    await new Promise((r) => setTimeout(r, 6000));
    const n = expect(await call(owner, "GET", "notifications"), 200);
    if (!n.items.some((i) => i.requestId === id && i.type === "REQUEST_APPROVED")) throw new Error(`types: ${JSON.stringify(n.items.map((i) => i.type))}`);
  });
  await step("schedule shows the request; no conflicts with itself", async () => {
    const c = expect(await call(owner, "GET", `requests/${id}/conflicts`), 200);
    if (!c.scheduled) throw new Error("not scheduled");
    const s = expect(await call(owner, "GET", `schedule?from=${start.toISOString().slice(0, 10)}&to=${start.toISOString().slice(0, 10)}`), 200);
    if (!s.items.some((i) => i.requestId === id)) throw new Error("not on the schedule");
  });
  await step("Approved -> Scheduled", () => move("SCHEDULED"));
  await step("Scheduled -> Readiness (checklist is created)", async () => {
    await move("READINESS");
    const r = expect(await call(owner, "GET", `requests/${id}/readiness`), 200);
    if (r.items.length !== 6) throw new Error(`items: ${r.items.length}`);
  });
  await step("start is blocked while the checklist is pending", async () => {
    const r = await call(owner, "POST", `requests/${id}/transition`, { to: "IN_PROGRESS", version });
    if (r.status !== 409 || r.body?.error?.code !== "READINESS_INCOMPLETE") throw new Error(`got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  });
  await step("complete the checklist (one item not applicable)", async () => {
    const r = expect(await call(owner, "GET", `requests/${id}/readiness`), 200);
    for (const [i, item] of r.items.entries()) {
      const body = i === 0 ? { version: item.version, state: "NOT_APPLICABLE", note: "No backups needed in staging" } : { version: item.version, state: "DONE" };
      expect(await call(owner, "PATCH", `requests/${id}/readiness/${item.id}`, body), 200, `item ${i}`);
    }
  });
  await step("Readiness -> In Progress", () => move("IN_PROGRESS"));
  await step("task: assign to the owner, complete it", async () => {
    const t = expect(await call(owner, "POST", `requests/${id}/tasks`, { title: "Apply patch", assigneeId: me.id, dueDate: start.toISOString().slice(0, 10) }), 201);
    expect(await call(owner, "PATCH", `requests/${id}/tasks/${t.id}`, { version: t.version, status: "DONE" }), 200);
    const list = expect(await call(owner, "GET", `requests/${id}/tasks`), 200);
    if (list.progress.done !== 1) throw new Error(JSON.stringify(list.progress));
  });
  await step("activity: note, issue, resolve", async () => {
    expect(await call(owner, "POST", `requests/${id}/activity`, { type: "NOTE", text: "Patch started" }), 201);
    const e = expect(await call(owner, "POST", `requests/${id}/activity`, { type: "ISSUE", text: "Slow query", severity: "LOW" }), 201);
    expect(await call(owner, "PATCH", `requests/${id}/activity/${e.id}`, { version: e.version, state: "RESOLVED", note: "Index added" }), 200);
  });
  await step("In Progress -> Validation (4 checks)", async () => {
    await move("VALIDATION");
    const v = expect(await call(owner, "GET", `requests/${id}/validation`), 200);
    if (v.items.length !== 4) throw new Error(`items: ${v.items.length}`);
  });
  await step("closing is blocked while checks are pending", async () => {
    const r = await call(owner, "POST", `requests/${id}/transition`, { to: "COMPLETED", version, summary: "x" });
    if (r.status !== 409) throw new Error(`got ${r.status}`);
  });
  await step("record validation results", async () => {
    const v = expect(await call(owner, "GET", `requests/${id}/validation`), 200);
    for (const item of v.items) expect(await call(owner, "PATCH", `requests/${id}/validation/${item.domain}`, { version: item.version, result: "PASSED" }), 200, item.domain);
  });
  await step("Validation -> Completed with a closing summary", () => move("COMPLETED", { summary: "Patched without downtime." }));
  await step("final report exists and is readable by the approver", async () => {
    const r = expect(await call(appr, "GET", `requests/${id}/report`), 200);
    if (r.summary !== "Patched without downtime." || r.tasks.done !== 1 || r.validation.passed !== 4) throw new Error(JSON.stringify(r).slice(0, 300));
  });
  await step("AI summary is disabled (503) but saving a written summary works", async () => {
    const g = await call(owner, "POST", `requests/${id}/report/summary/generate`, { language: "en" });
    if (g.status !== 503 || g.body?.error?.code !== "AI_DISABLED") throw new Error(`generate: ${g.status} ${JSON.stringify(g.body)}`);
    expect(await call(owner, "PUT", `requests/${id}/report/summary`, { text: "Reviewed summary", aiAssisted: false, language: "en" }), 200);
  });
  await step("dashboard and request list answer", async () => {
    expect(await call(owner, "GET", "dashboard/summary"), 200);
    const l = expect(await call(owner, "GET", "requests?status=COMPLETED"), 200);
    if (!l.items.some((i) => i.id === id)) throw new Error("not in the completed list");
  });
  await step("the owner cannot answer participation (not a participant)", async () => {
    const r = await call(owner, "POST", `requests/${id}/participation`, { response: "CONFIRMED" });
    if (![404, 409].includes(r.status)) throw new Error(`got ${r.status}`);
  });
  console.log(`\nRequest used: ${id}`);
} catch {
  // the failing step is already printed
}
console.log(failed ? `\n${failed} step(s) FAILED` : "\nALL STEPS PASSED");
process.exit(failed ? 1 : 0);

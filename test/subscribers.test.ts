import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { signLink, verifyLink } from "../src/links";
import {
  confirm, deleteAccount, dueSubscribers, findById, markSent, parseEmail, parseTopics, releaseEmailClaim, requestSignin, RESEND_COOLDOWN_MS, setDigest,
  setTopics, signUp, unsubscribe, verifyEmail,
} from "../src/subscribers";

const SECRET = "x".repeat(32);

describe("parseEmail / parseTopics", () => {
  it("normalizes addresses and rejects junk", () => {
    expect(parseEmail("  Reader@Example.COM ")).toBe("reader@example.com");
    expect(parseEmail("not-an-email")).toBeNull();
    expect(parseEmail(42)).toBeNull();
  });

  it("keeps known topics once", () => {
    expect(parseTopics(["world", "world", "gossip", 3, "tech"])).toEqual(["world", "tech"]);
  });
});

describe("links", () => {
  it("round-trips and binds the purpose", async () => {
    const t = await signLink(SECRET, "manage", "abc");
    expect(await verifyLink(SECRET, "manage", t)).toBe("abc");
    expect(await verifyLink(SECRET, "confirm", t)).toBeNull();
    expect(await verifyLink(SECRET, "manage", t.replace("abc", "abd"))).toBeNull();
    expect(await verifyLink(SECRET, "manage", "garbage")).toBeNull();
  });

  it("refuses a short secret", async () => {
    await expect(signLink("short", "manage", "a")).rejects.toThrow(/32/);
  });
});

describe("subscribers", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM subscribers");
  });

  it("signs up, confirms, changes topics and unsubscribes", async () => {
    const s = await signUp(env.DB, "a@ex.com", ["world"], 0);
    expect(s.send).toBe("confirm");
    expect((await findById(env.DB, s.id))?.status).toBe("pending");
    expect((await confirm(env.DB, s.id, 1))?.status).toBe("active");

    await setTopics(env.DB, s.id, ["tech", "science"]);
    expect((await findById(env.DB, s.id))?.topics).toEqual(["tech", "science"]);

    await unsubscribe(env.DB, s.id);
    expect((await findById(env.DB, s.id))?.status).toBe("unsubscribed");
  });

  it("rate-limits repeat sign-ups and sends active readers a manage link instead", async () => {
    const first = await signUp(env.DB, "b@ex.com", ["world"], 0);
    expect((await signUp(env.DB, "b@ex.com", ["world"], 1000)).send).toBeNull();
    await confirm(env.DB, first.id);
    const again = await signUp(env.DB, "b@ex.com", ["sports"], RESEND_COOLDOWN_MS + 1);
    expect(again).toMatchObject({ id: first.id, send: "manage" });
    // An unconfirmed form post can't change an active reader's topics.
    expect((await findById(env.DB, first.id))?.topics).toEqual(["world"]);
  });

  it("lets an unsubscribed reader sign up again without a form post changing their account", async () => {
    const s = await signUp(env.DB, "c@ex.com", ["world"], 0);
    await confirm(env.DB, s.id);
    await unsubscribe(env.DB, s.id);
    const back = await signUp(env.DB, "c@ex.com", ["tech"], RESEND_COOLDOWN_MS + 1);
    expect(back.send).toBe("confirm");
    expect(await findById(env.DB, s.id)).toMatchObject({ status: "unsubscribed", topics: ["world"] });
    expect((await confirm(env.DB, s.id))?.status).toBe("active");
  });

  it("lets only one of two racing requests send, and hands the slot back after a failed send", async () => {
    const first = await signUp(env.DB, "race@ex.com", [], 0);
    const [a, b] = await Promise.all([signUp(env.DB, "race@ex.com", [], RESEND_COOLDOWN_MS + 1), signUp(env.DB, "race@ex.com", [], RESEND_COOLDOWN_MS + 1)]);
    expect([a.send, b.send].filter(Boolean)).toHaveLength(1);

    const winner = a.send ? a : b;
    await releaseEmailClaim(env.DB, first.id, winner.previous, winner.claimedAt);
    expect((await signUp(env.DB, "race@ex.com", [], RESEND_COOLDOWN_MS + 2)).send).toBe("confirm");
  });

  it("signs in without subscribing anyone", async () => {
    const r = await requestSignin(env.DB, "new@ex.com", 0);
    expect(r.send).toBe("signin");
    expect((await verifyEmail(env.DB, r.id))?.status).toBe("unsubscribed");
    await setDigest(env.DB, r.id, true);
    expect((await findById(env.DB, r.id))?.status).toBe("active");
    await deleteAccount(env.DB, r.id);
    expect(await findById(env.DB, r.id)).toBeNull();
  });

  it("doesn't let a pending address turn the digest on without confirming", async () => {
    const r = await signUp(env.DB, "p@ex.com", [], 0);
    await setDigest(env.DB, r.id, true);
    expect((await findById(env.DB, r.id))?.status).toBe("pending");
  });

  it("lists who still needs today's edition", async () => {
    const a = await signUp(env.DB, "d@ex.com", [], 0);
    const b = await signUp(env.DB, "e@ex.com", [], 0);
    await signUp(env.DB, "pending@ex.com", [], 0);
    await confirm(env.DB, a.id);
    await confirm(env.DB, b.id);
    await markSent(env.DB, [a.id], "2026-10-24");
    expect((await dueSubscribers(env.DB, "2026-10-24")).map((s) => s.email)).toEqual(["e@ex.com"]);
    expect(await dueSubscribers(env.DB, "2026-10-25")).toHaveLength(2);
  });
});

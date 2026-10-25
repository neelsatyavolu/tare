import { cardLine, shownSummary, type Edition, type Source, type Story } from "../editions";
import { readFirstLabel } from "../read-first";
import { SLOT_NAME, type Slot } from "../slots";
import { frontOrder } from "../build/select";
import { coverageLine, esc, longDate } from "../format";
import { OUTLETS } from "../outlets";
import { topicName, type TopicId } from "../topics";

// Inline styles only: mail clients drop <style> and web fonts. Palette from DESIGN.md (Newsprint).
const C = { paper: "#F3EFE6", sheet: "#FBF9F4", ink: "#1C1A16", ink2: "#5E594F", ink3: "#6F695E", rule: "#D6D0C4", brass: "#8A5A12" };
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "Menlo, Consolas, 'Courier New', monospace";

const kicker = (text: string) =>
  `<p style="margin:0 0 6px;font:500 11px/1.4 ${MONO};letter-spacing:.1em;text-transform:uppercase;color:${C.ink3}">${esc(text)}</p>`;

function shell(title: string, body: string, footer: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:${C.paper};color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="border-top:3px double ${C.ink};border-bottom:1px solid ${C.ink};padding:14px 0;text-align:center">
<div style="font:400 40px/1 ${SERIF};letter-spacing:-.01em;color:${C.ink}">Tare</div></td></tr>
${body}
<tr><td style="padding:24px 0 0;border-top:1px solid ${C.rule};font:12px/1.6 ${MONO};color:${C.ink3}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:12px 18px;background:${C.ink};color:${C.paper};font:500 13px/1 ${MONO};letter-spacing:.06em;text-transform:uppercase;text-decoration:none">${esc(label)}</a>`;

export function confirmEmail(confirmUrl: string): { subject: string; html: string; text: string } {
  const body = `<tr><td style="padding:28px 0">
<p style="margin:0 0 16px;font:18px/1.55 ${SERIF}">Confirm your email to start getting Tare: a morning and an evening edition, covering the stories outlets across the spectrum reported, and how their accounts differ.</p>
<p style="margin:0 0 20px">${button(confirmUrl, "Confirm subscription")}</p>
<p style="margin:0;font:14px/1.55 ${SERIF};color:${C.ink2}">If you didn't sign up, ignore this email. Nothing happens unless you confirm.</p></td></tr>`;
  return {
    subject: "Confirm your Tare subscription",
    html: shell("Confirm your Tare subscription", body, `Tare · headlines from ${OUTLETS.length} outlets, weighed daily.`),
    text: `Confirm your email to start getting Tare's morning and evening editions:\n${confirmUrl}\n\nIf you didn't sign up, ignore this email.`,
  };
}

export function signinEmail(signinUrl: string): { subject: string; html: string; text: string } {
  const body = `<tr><td style="padding:28px 0">
<p style="margin:0 0 16px;font:18px/1.55 ${SERIF}">Here's your link to sign in to Tare. It works for 30 minutes.</p>
<p style="margin:0 0 20px">${button(signinUrl, "Sign in to Tare")}</p>
<p style="margin:0;font:14px/1.55 ${SERIF};color:${C.ink2}">If you didn't ask for this, ignore this email. Nobody can sign in without the link.</p></td></tr>`;
  return {
    subject: "Your Tare sign-in link",
    html: shell("Your Tare sign-in link", body, "Tare"),
    text: `Sign in to Tare (this link works for 30 minutes):\n${signinUrl}\n\nIf you didn't ask for this, ignore this email.`,
  };
}

export function signinCodeEmail(code: string): { subject: string; html: string; text: string } {
  const body = `<tr><td style="padding:28px 0">
<p style="margin:0 0 16px;font:18px/1.55 ${SERIF}">Enter this code in the Tare app to sign in. It works for 15 minutes.</p>
<p style="margin:0 0 20px;font:600 32px/1.2 ${MONO};letter-spacing:6px">${code}</p>
<p style="margin:0;font:14px/1.55 ${SERIF};color:${C.ink2}">If you didn't ask for this, ignore this email. Nobody can sign in without the code.</p></td></tr>`;
  return {
    subject: `${code} is your Tare sign-in code`,
    html: shell("Your Tare sign-in code", body, "Tare"),
    text: `Your Tare sign-in code is ${code}. It works for 15 minutes.\n\nIf you didn't ask for this, ignore this email.`,
  };
}

export function manageEmail(manageUrl: string): { subject: string; html: string; text: string } {
  const body = `<tr><td style="padding:28px 0">
<p style="margin:0 0 16px;font:18px/1.55 ${SERIF}">This address already gets Tare. You can change your topics or unsubscribe here:</p>
<p style="margin:0">${button(manageUrl, "Manage subscription")}</p></td></tr>`;
  return {
    subject: "Your Tare subscription",
    html: shell("Your Tare subscription", body, "Tare"),
    text: `This address already gets Tare. Change your topics or unsubscribe:\n${manageUrl}`,
  };
}

export type Digest = { front: Story[]; yours: Story[]; blindspots: Story[]; also: Story[] };

/**
 * Everyone gets the front page; then up to 8 stories from their topics; then up to 2 blindspots; then, as
 * one-line "Also today" links, the 2 highest-scoring stories (front-page score) none of those included, plus the most widely covered one left.
 */
export function digestFor(stories: readonly Story[], topics: readonly TopicId[]): Digest {
  const front = stories.filter((s) => s.front);
  const yours = stories.filter((s) => !s.front && topics.includes(s.topic)).slice(0, 8);
  const blindspots = stories.filter((s) => s.blindspot && !front.includes(s) && !yours.includes(s)).slice(0, 2);
  const taken = new Set([...front, ...yours, ...blindspots]);
  const rest = stories.filter((s) => !taken.has(s));
  const top = [...rest].sort(frontOrder).slice(0, 2);
  const widest = rest.filter((s) => !top.includes(s)).sort((a, b) => b.coverage.total - a.coverage.total)[0];
  const also = widest ? [...top, widest] : top;
  return { front, yours, blindspots, also };
}

export type EmailPhoto = { url: string; credit: string };

function photoHtml(p: EmailPhoto, href: string): string {
  return `<a href="${esc(href)}"><img src="${esc(p.url)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a>
<p style="margin:4px 0 12px;font:11px/1.4 ${MONO};color:${C.ink3}">Photo: ${esc(p.credit)}</p>`;
}

/**
 * The same text as the site, so the email never tells a different story: the lead gets the opening four
 * sentences, like the lead on the site; every other story gets its card line.
 */
const lineOf = (s: Story, lead = false) => (lead ? shownSummary(s).slice(0, 4).map((x) => x.text).join(" ") : cardLine(s));

/** The lead's "Background" or "Read first" link, as on the site. */
const firstReadHtml = (src: Source) =>
  `<p style="margin:0 0 10px;font:15px/1.5 ${SERIF};color:${C.ink2}"><span style="font:500 11px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${C.ink3}">${esc(readFirstLabel(src))}</span> <a href="${esc(src.url)}" style="color:${C.brass}">${esc(src.title)}</a> · ${esc(src.outlet.name)}</p>`;

function storyHtml(s: Story, appUrl: string, photo?: EmailPhoto, lead = false, firstRead?: Source, sinceMorning = false): string {
  const url = `${appUrl}/s/${s.id}`;
  const label = `${sinceMorning ? "New since this morning · " : ""}${s.blindspot ? "Possible blindspot · " : ""}${topicName(s.topic)}`;
  return `<tr><td style="padding:20px 0;border-bottom:1px solid ${C.rule}">
${photo ? photoHtml(photo, url) : ""}${kicker(label)}
<a href="${esc(url)}" style="font:400 24px/1.2 ${SERIF};color:${C.ink};text-decoration:none">${esc(s.headline)}</a>
<p style="margin:10px 0 10px;font:17px/1.55 ${SERIF};color:${C.ink}">${esc(lineOf(s, lead))}</p>
${firstRead ? firstReadHtml(firstRead) : ""}
<p style="margin:0;font:12px/1.5 ${MONO};color:${C.ink3}">${esc(coverageLine(s.coverage))}${s.differences.length ? ` · <a href="${esc(url)}" style="color:${C.brass}">How accounts differ</a>` : ""}</p>
</td></tr>`;
}

function storyText(s: Story, appUrl: string): string {
  return `${s.blindspot ? "[Possible blindspot] " : ""}${s.headline}\n${lineOf(s)}\n${coverageLine(s.coverage)}\n${appUrl}/s/${s.id}`;
}

const alsoHtml = (s: Story, appUrl: string) =>
  `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.rule};font:17px/1.4 ${SERIF}"><a href="${esc(`${appUrl}/s/${s.id}`)}" style="color:${C.ink};text-decoration:none">${esc(s.headline)}</a> <span style="font:12px ${MONO};color:${C.ink3}">${s.coverage.total} outlets</span>
<p style="margin:4px 0 0;font:15px/1.5 ${SERIF};color:${C.ink2}">${esc(lineOf(s))}</p></td></tr>`;

const section = (title: string) => `<tr><td style="padding:28px 0 0">${kicker(title)}<div style="border-top:1px solid ${C.ink}"></div></td></tr>`;

/** `photos` (story id → photo) are shown on front-page stories only, to keep the email light; `firstReads` gives the lead its link. */
export function digestEmail(
  edition: Edition,
  d: Digest,
  appUrl: string,
  manageUrl: string,
  photos: ReadonlyMap<string, EmailPhoto> = new Map(),
  firstReads: ReadonlyMap<string, Source> = new Map(),
  slot: Slot = "am",
  /** When this reader's morning edition went out; the evening edition marks stories that arrived since. */
  morningAt: number = Date.parse(`${edition.date}T11:00:00Z`),
): { subject: string; html: string; text: string } {
  const lead = d.front[0] ?? d.yours[0] ?? d.blindspots[0];
  const subject = `Tare${slot === "pm" ? " evening" : ""} · ${longDate(edition.date).replace(/, \d{4}$/, "")}${lead ? `: ${lead.headline}` : ""}`;
  // In the evening edition, stories that arrived after the morning email say so.
  const sinceMorning = (s: Story) => slot === "pm" && (s.firstSeenAt ?? 0) > morningAt;
  const dateline = `${longDate(edition.date)} · ${SLOT_NAME[slot]}`;
  const parts: [string, Story[]][] = [["Front page", d.front], ["Your topics", d.yours], ["Blindspots", d.blindspots]];
  const shown = parts.filter(([, list]) => list.length > 0);

  const body = `<tr><td style="padding:10px 0 0;text-align:center;font:12px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${C.ink3}">${esc(dateline)}</td></tr>
${shown.map(([title, list]) => section(title) + list.map((s) => storyHtml(s, appUrl, s.front ? photos.get(s.id) : undefined, s === lead, s === lead ? firstReads.get(s.id) : undefined, sinceMorning(s))).join("")).join("")}
${d.also.length ? section("Also today") + d.also.map((s) => alsoHtml(s, appUrl)).join("") : ""}
<tr><td style="padding:24px 0;font:17px/1.55 ${SERIF};color:${C.ink2}">That's the edition. <a href="${esc(`${appUrl}/e/${edition.date}`)}" style="color:${C.brass}">Read it on the web</a> with every source.</td></tr>`;
  const footer = `You get this because you subscribed to Tare. <a href="${esc(manageUrl)}" style="color:${C.ink3}">Change topics, editions or unsubscribe</a>. Summaries are written by AI from headlines and descriptions only; <a href="${esc(`${appUrl}/method`)}" style="color:${C.ink3}">how it works</a>.`;

  const text = [
    `TARE · ${dateline}`,
    ...shown.map(([title, list]) => `\n${title.toUpperCase()}\n\n${list.map((s) => storyText(s, appUrl)).join("\n\n")}`),
    ...(d.also.length ? [`\nALSO TODAY\n\n${d.also.map((s) => `${s.headline} (${s.coverage.total} outlets)\n${lineOf(s)}\n${appUrl}/s/${s.id}`).join("\n\n")}`] : []),
    `\nThat's the edition. Read it with every source: ${appUrl}/e/${edition.date}`,
    `\nChange topics, editions or unsubscribe: ${manageUrl}`,
  ].join("\n");

  return { subject, html: shell(subject, body, footer), text };
}

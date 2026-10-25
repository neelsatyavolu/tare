// Tokens and components from DESIGN.md. Served as one stylesheet at /styles.css.
export const CSS = `
:root{
  --paper:#F3EFE6; --sheet:#FBF9F4; --ink:#1C1A16; --ink-2:#5E594F; --ink-3:#6F695E;
  --rule:rgba(28,26,22,.16); --rule-strong:#1C1A16;
  --brass:#8A5A12; --brass-wash:rgba(138,90,18,.10); --alert:#A3341F;
  --font-display:"Libre Caslon Display",Georgia,serif;
  --font-serif:"Source Serif 4",Georgia,serif;
  --font-mono:"IBM Plex Mono",Menlo,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#151410; --sheet:#1C1B16; --ink:#EDE7DA; --ink-2:#A59F92; --ink-3:#8C8676;
  --rule:rgba(237,231,218,.14); --rule-strong:#EDE7DA;
  --brass:#D9A441; --brass-wash:rgba(217,164,65,.14); --alert:#E27A5F; color-scheme:dark }}
:root[data-theme="dark"]{
  --paper:#151410; --sheet:#1C1B16; --ink:#EDE7DA; --ink-2:#A59F92; --ink-3:#8C8676;
  --rule:rgba(237,231,218,.14); --rule-strong:#EDE7DA;
  --brass:#D9A441; --brass-wash:rgba(217,164,65,.14); --alert:#E27A5F; color-scheme:dark }

*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 18px/1.55 var(--font-serif);font-optical-sizing:auto;-webkit-font-smoothing:antialiased}
a{color:var(--brass);text-decoration-thickness:1px;text-underline-offset:3px;transition:color .12s}
a:hover{color:var(--ink)}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
h1,h2,h3{font-family:var(--font-display);font-weight:400;text-wrap:balance;margin:0}
p{margin:0 0 .8em}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.mono,.kicker,.meta,nav,button,.btn{font-family:var(--font-mono)}
.kicker{font-size:13px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px}
.kicker b{color:var(--ink);font-weight:500}
.kicker b.new{color:var(--brass)}
.meta{font-size:14px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:16px;background:var(--sheet);padding:8px;z-index:9}

/* Masthead */
.masthead{border-top:3px double var(--rule-strong);border-bottom:1px solid var(--rule-strong);margin-top:24px;padding:18px 0 14px;text-align:center}
.masthead a.wordmark{font:400 72px/1 var(--font-display);letter-spacing:-.01em;color:var(--ink);text-decoration:none}
.masthead .tagline{font:italic 400 15px/1.4 var(--font-serif);color:var(--ink-2);margin:6px 0 0}
.edition-line{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--rule);padding:8px 0;font:500 12px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
nav{display:flex;gap:18px}
nav a{color:var(--ink-2);text-decoration:none}
nav a:hover,nav a[aria-current="page"]{color:var(--ink);text-decoration:underline}

/* How to read */
details.howto{margin-top:16px;border:1px solid var(--rule);background:var(--sheet)}
details.howto summary{cursor:pointer;padding:12px 16px;font:500 13px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);list-style:none}
details.howto summary::-webkit-details-marker{display:none}
details.howto summary::before{content:"+ ";color:var(--brass)}
details.howto[open] summary::before{content:"− "}
.howto-body{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:4px 16px 18px}
.howto-body h3{font:500 13px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px}
.howto-body p{font-size:16px;line-height:1.5;color:var(--ink-2);margin:0}

/* Intro, jump links */
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.intro-strip{display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:16px;padding:14px 16px;border:1px solid var(--rule);background:var(--sheet)}
.intro-strip p{margin:0;font-size:17px;max-width:56ch}
.inline-subscribe{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.inline-subscribe input[type=email]{width:220px;font-size:16px;padding:8px 0}
.inline-subscribe button{padding:11px 14px}
nav.jump{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:16px;font:500 12px/1.6 var(--font-mono);letter-spacing:.06em;text-transform:uppercase}
nav.jump a{color:var(--ink-2);text-decoration:none;border-bottom:1px solid var(--rule)}
nav.jump a:hover{color:var(--ink);border-bottom-color:var(--ink)}

/* Compact rows */
.compact-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:32px}
/* An odd last card takes the whole row instead of leaving a hole beside it; its text keeps a readable measure. */
.compact-grid>.compact:last-child:nth-child(odd){grid-column:1/-1}
.compact-grid>.compact:last-child:nth-child(odd) .compact-body{max-width:72ch}
.compact{display:grid;grid-template-columns:96px 1fr;gap:14px;padding:16px 0;border-bottom:1px solid var(--rule)}
.compact:not(:has(.thumb)){grid-template-columns:1fr}
.compact .thumb img{display:block;width:96px;height:96px;object-fit:cover;background:var(--rule)}
.compact .kicker{margin-bottom:4px;font-size:12px}
.compact h3{font-size:21px;line-height:1.2;margin:0 0 4px}
.compact h3 a{color:var(--ink);text-decoration:none}
.compact h3 a:hover{text-decoration:underline;text-decoration-thickness:1px}
.compact .dek{margin:0;font-size:16px;line-height:1.45;color:var(--ink-2)}
.tag{color:var(--ink)}
.kicker .counts{font-weight:400;letter-spacing:.04em;color:var(--ink-3)}
.why-matters{max-width:66ch;border-left:2px solid var(--brass);padding-left:12px;color:var(--ink)}
.quoted .snippet{display:block;margin:2px 0 0;font-style:italic;color:var(--ink-2)}
.scale.thin .reading-thin{margin:0;font:13px/1.5 var(--font-mono);color:var(--ink-3)}
.report{margin:28px 0 0;border-top:1px solid var(--rule);padding-top:12px}
.report summary{cursor:pointer;font:500 12px/1.6 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.report form{display:grid;gap:8px;margin-top:10px;max-width:60ch}
.report textarea{font:16px/1.5 var(--font-serif);color:var(--ink);background:var(--sheet);border:1px solid var(--rule);padding:8px}
.report button{justify-self:start}
.correction{margin:16px 0 0;padding:10px 12px;border-left:2px solid var(--brass);background:var(--brass-wash)}
.read-first{margin:6px 0 0}
.named{font:400 15px/1.5 var(--font-serif);color:var(--ink-2);margin:6px 0 0}
.no-center{margin:6px 0 0;font:400 12px/1.4 var(--font-mono);color:var(--ink-3)}
.no-differ{margin-top:14px;font-size:16px;color:var(--ink-2)}
.tag.thin{color:var(--ink-3)}
details.differ ul.quoted{margin:8px 0 0;padding:0;border:0}
details.differ ul.quoted li{border-left:0;padding-left:0;margin:0 0 6px;font-size:15px;line-height:1.4}
details.differ ul.quoted .outlet{display:block;font:500 11px/1.4 var(--font-mono);color:var(--ink-3);text-transform:none;letter-spacing:0}

/* Sections */
.section{margin-top:40px}
.section-head{border-top:1px solid var(--rule-strong);padding-top:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.section-head h2{font:500 13px/1.4 var(--font-mono);letter-spacing:.1em;text-transform:uppercase}
.grid{display:grid;grid-template-columns:1fr 1fr}
.grid>.story{padding:24px 0;border-bottom:1px solid var(--rule)}
.grid>.story:nth-child(odd){padding-right:28px;border-right:1px solid var(--rule)}
.grid>.story:nth-child(even){padding-left:28px}

/* Story */
.story h3{font-size:30px;line-height:1.12;margin-bottom:10px}
.story h3 a{color:var(--ink);text-decoration:none}
.story h3 a:hover{text-decoration:underline;text-decoration-thickness:1px}
.story.lead{padding:28px 0 32px;border-bottom:1px solid var(--rule);display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:40px}
.lead-side{border-left:1px solid var(--rule);padding-left:32px;padding-top:30px}
/* Nothing to weigh: photo and the coverage line on the left, the story on the right (photo stays its normal size). */
.story.lead.solo{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:36px;align-items:start}
.story.lead.solo .lead-media .photo{margin:0 0 12px}
.story.lead.solo .lead-side{border-left:0;padding:0}
.story.lead.solo h3{font-size:36px}
.summary+.summary{margin-top:12px}
.more{margin:10px 0 0;font:500 13px/1.6 var(--font-mono);letter-spacing:.06em}
.lead-side .scale{margin-top:0}
.lead-side details.differ{border-top:0}
.story.lead h3{font-size:44px;line-height:1.08;max-width:22ch}
.story.lead .summary{font-size:20px;max-width:60ch}
.summary{max-width:66ch}
sup.cites{font:500 12px/0 var(--font-mono);margin-left:3px;color:var(--ink-3);white-space:nowrap}
sup.cites a{display:inline-block;padding:6px 1px;text-decoration:none}
sup.cites a:hover{text-decoration:underline}
.summary sup a{text-decoration:none;padding:0 1px}
.why{font:400 15px/1.5 var(--font-serif);color:var(--ink-2);margin:12px 0 0}
.why-label{font:500 12px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-right:6px}
details.differ{margin-top:14px;border-top:1px solid var(--rule);padding-top:10px}
details.differ summary{cursor:pointer;padding:6px 0;font:500 13px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);list-style:none}
details.differ summary::-webkit-details-marker{display:none}
details.differ summary::before{content:"+ ";color:var(--brass)}
details.differ[open] summary::before{content:"− "}
details.differ ul{list-style:none;padding:0;margin:10px 0 0}
details.differ li{margin:0 0 10px;padding-left:12px;border-left:2px solid var(--rule)}
details.differ .kind{display:block;font:500 11px/1.4 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}

/* Photos */
.photo{margin:0 0 14px}
.photo img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--rule);filter:grayscale(.15) contrast(1.02)}
.photo figcaption{margin-top:5px;font:400 12px/1.4 var(--font-mono);color:var(--ink-3)}
.story.lead .photo img{aspect-ratio:3/2}
.grid>.story .photo img{aspect-ratio:16/9}

/* Coverage scale (signature) */
.scale{margin-top:16px;max-width:440px}
.pan-label{display:block;color:var(--ink)}
.pans{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font:500 13px/1.3 var(--font-mono);color:var(--ink-2);font-variant-numeric:tabular-nums}
.pan .bar{height:6px;margin-top:4px;background:var(--rule);position:relative}
.pan .bar i{position:absolute;inset:0 auto 0 0;background:var(--ink)}
.pan.c .bar i{background:repeating-linear-gradient(135deg,var(--ink-3) 0 2px,transparent 2px 4px)}
.ruler{position:relative;height:14px;margin-top:10px;
  background:
    linear-gradient(var(--ink-3),var(--ink-3)) center bottom/1px 14px no-repeat,
    repeating-linear-gradient(90deg,var(--ink-3) 0 1px,transparent 1px 10%) left bottom/100% 6px no-repeat,
    linear-gradient(var(--rule-strong),var(--rule-strong)) left bottom/100% 1px no-repeat}
.ruler .needle{position:absolute;bottom:0;width:3px;height:14px;margin-left:-1px;background:var(--brass)}
.ruler .needle::after{content:"";position:absolute;left:-3px;top:-5px;border:4.5px solid transparent;border-top-color:var(--brass)}
.reading{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font:400 12px/1.4 var(--font-mono);color:var(--ink-3)}
.reading b{color:var(--ink);font-weight:500}

/* Sources */
.sources{margin-top:32px}
.sources .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px}
.sources h4{font:500 12px/1.4 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px;border-bottom:1px solid var(--rule);padding-bottom:6px}
.sources ol{list-style:none;margin:0;padding:0}
.sources li{margin:0 0 14px;font-size:16px;line-height:1.4}
.sources li:target{background:var(--brass-wash);outline:4px solid var(--brass-wash)}
.sources .outlet{display:block;font:500 12px/1.4 var(--font-mono);color:var(--ink-2)}
.sources .n{color:var(--brass)}

/* Detailed briefing */
.briefing{margin-top:36px}
.briefing h3{font:600 20px/1.3 var(--font-serif);margin:20px 0 6px}
.briefing h4{font:500 12px/1.4 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:22px 0 8px}
.web-sources{list-style:none;padding:0;margin:0;font-size:16px}
.web-sources li{margin:0 0 8px}
.web-sources .n{font:500 12px var(--font-mono);color:var(--brass)}
input.text{width:100%;max-width:560px;font:400 16px/1.4 var(--font-mono);color:var(--ink);background:transparent;border:0;border-bottom:1px solid var(--rule-strong);padding:8px 0;border-radius:0}
input.text:focus{outline:none;border-bottom-color:var(--brass);box-shadow:0 1px 0 var(--brass)}

/* Article page */
.article{max-width:760px;margin:0 auto;padding-top:32px}
.article h1{font-size:44px;line-height:1.08;margin-bottom:16px}
.article .summary{font-size:20px}

/* Forms */
.panel{background:var(--sheet);border:1px solid var(--rule);padding:28px;margin-top:48px}
.panel h2{font-size:30px;margin-bottom:6px}
.panel p{color:var(--ink-2)}
label.field{display:block;font:500 12px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:18px 0 6px}
input[type=email]{width:100%;max-width:420px;font:400 20px/1.4 var(--font-serif);color:var(--ink);background:transparent;border:0;border-bottom:1px solid var(--rule-strong);padding:6px 0;border-radius:0}
input[type=email]:focus{outline:none;border-bottom-color:var(--brass);box-shadow:0 1px 0 var(--brass)}
fieldset{border:0;padding:0;margin:18px 0 0}
legend{font:500 12px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:0;margin-bottom:8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative}
.chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.chip span{display:inline-block;padding:7px 12px;border:1px solid var(--rule);font:400 13px/1.2 var(--font-mono);color:var(--ink-2);transition:background .12s,border-color .12s}
.chip input:checked+span{background:var(--brass-wash);border-color:var(--brass);color:var(--ink)}
.chip input:focus-visible+span{outline:2px solid var(--brass);outline-offset:2px}
.hint{font-size:15px;color:var(--ink-3);margin-top:8px}
.btn,button{display:inline-block;font:500 13px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;padding:13px 18px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none;border-radius:0;transition:background .12s,color .12s}
.btn.primary,button.primary{background:var(--ink);color:var(--paper)}
.btn:hover,button:hover{background:var(--ink);color:var(--paper)}
.btn.primary:hover,button.primary:hover{background:transparent;color:var(--ink)}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px;align-items:center}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.error{color:var(--alert);font-size:16px}
.notice{border-left:3px solid var(--brass);padding:6px 12px;background:var(--brass-wash)}
details.danger{margin-top:40px;border-top:1px solid var(--rule);padding-top:12px}
details.danger summary{cursor:pointer;font:500 13px/1.4 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
button.danger{border-color:var(--alert);color:var(--alert)}
button.danger:hover{background:var(--alert);color:var(--paper)}

/* Prose pages */
.prose{max-width:680px;margin:0 auto;padding-top:32px}
.prose h1{font-size:44px;line-height:1.08;margin-bottom:16px}
.prose h2{font-size:26px;margin:36px 0 10px}
.prose ol{padding-left:22px}
.prose li{margin-bottom:8px}
.prose table{width:100%;border-collapse:collapse;font-size:15px;margin:12px 0}
.prose th,.prose td{text-align:left;padding:7px 8px 7px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.prose th{font:500 12px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.archive{list-style:none;padding:0;margin:24px 0 0}
.archive li{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--rule)}
.end{margin:48px 0 0;padding:20px 0;border-top:1px solid var(--rule-strong);text-align:center;font:italic 400 18px/1.4 var(--font-serif);color:var(--ink-2)}
footer{margin:56px 0 32px;padding-top:16px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font:400 12px/1.6 var(--font-mono);color:var(--ink-3)}
footer a{color:var(--ink-3)}

@media (max-width:1000px){.howto-body{grid-template-columns:1fr 1fr}}
@media (max-width:760px){
.masthead{margin-top:12px;padding:10px 0 8px}.masthead .tagline{display:none}
.intro-strip{display:none}/* news first on phones; Subscribe is in the nav */
nav.jump{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;padding-bottom:4px;scrollbar-width:none}
.story.lead.solo{display:flex;flex-direction:column}.story.lead.solo .lead-media{display:contents}.story.lead.solo .lead-main{display:contents}
.story.lead.solo .lead-media>.photo{order:3;margin-top:8px}.story.lead.solo .lead-side{order:5}
.lead-main{display:flex;flex-direction:column}.lead-main>*{order:4}.lead-main>.kicker{order:0}.lead-main>h3,.lead-main>h1{order:1}.lead-main>.summary{order:2}.lead-main>.photo{order:3;margin-top:8px}

  .wrap{padding:0 16px}
  .masthead a.wordmark{font-size:52px}
  .grid{grid-template-columns:1fr}
  .grid>.story:nth-child(odd),.grid>.story:nth-child(even){padding:22px 0;border-right:0}
  .story h3{font-size:22px}
  .story.lead{grid-template-columns:1fr;gap:0}
  .lead-side{border-left:0;padding:0}
  .lead-side .scale{margin-top:14px}
  .story.lead h3,.article h1,.prose h1{font-size:30px}
  .story.lead .summary,.article .summary{font-size:18px}
  .sources .cols{grid-template-columns:1fr}
  .compact-grid{grid-template-columns:1fr}
  .compact{grid-template-columns:1fr 72px;gap:12px}
  .compact .thumb{order:2}
  .compact .thumb img{width:72px;height:72px}
  .compact h3{font-size:20px}
  .compact .kicker .counts{display:block}
  .intro-strip{padding:12px}
  .inline-subscribe input[type=email]{width:100%}
  .howto-body{grid-template-columns:1fr}
  .edition-line{justify-content:center;text-align:center}
  .panel{padding:20px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/** Short content hash for the stylesheet URL, so a deploy never serves a cached old stylesheet. */
export const CSS_VERSION = (() => {
  let h = 5381;
  for (let i = 0; i < CSS.length; i++) h = ((h << 5) + h + CSS.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();

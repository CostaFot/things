#!/usr/bin/env node
// entries/*.json -> site/ (index.html, things.json, feed.xml, images/, favicon.svg)
const fs = require("node:fs");
const path = require("node:path");
const { loadEntries, ROOT } = require("./validate.js");
const { youtubeId, domainOf } = require("./fetch-meta.js");

const SITE = "https://things.costafotiadis.com";
const OUT = path.join(ROOT, "site");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = esc;

// Escape, then turn bare URLs into links. Runs on already-escaped text so the
// regex only ever sees &amp; for &.
function richText(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (u) => {
    const href = u.replace(/&amp;/g, "&");
    return `<a href="${attr(href)}" rel="noopener">${u}</a>`;
  });
}

function mark(e) {
  if (e.type === "idea") return "💡";
  if (e.type === "note") return "💬";
  if (e.type === "photo") return "🖼️";
  return youtubeId(e.url) ? "▶️" : "🔗";
}

// "2026-08-17T12:29:46+01:00" -> pieces, no timezone maths: the string *is*
// the writer's wall clock.
function parts(date) {
  return { y: date.slice(0, 4), m: Number(date.slice(5, 7)) - 1, d: Number(date.slice(8, 10)), hm: date.slice(11, 16), day: date.slice(0, 10) };
}

function renderEntry(e) {
  const p = parts(e.date);
  const tags = (e.tags || []).map((t) => `<a class="tag" href="#tag=${attr(t)}">${esc(t)}</a>`).join("");
  let body = "";
  if (e.type === "link") {
    const pv = e.preview ? `<a class="pv" href="${attr(e.url)}" rel="noopener" tabindex="-1" aria-hidden="true"><img src="/${attr(e.preview.src)}" alt="" loading="lazy"></a>` : "";
    body += `<div class="link"><div class="t"><a href="${attr(e.url)}" rel="noopener">${esc(e.title)}</a></div><div class="host">${esc(domainOf(e.url))}</div>${pv}</div>`;
  }
  if (e.type === "photo") {
    body += `<a class="photo" href="/${attr(e.image)}"><img src="/${attr(e.image)}" alt="${attr(e.text)}" loading="lazy"></a>`;
  }
  body += `<p class="text">${richText(e.text)}</p>`;
  if (e.claude) {
    body += `<aside class="claude" aria-label="Added by Claude"><span class="lbl">claude</span><p>${richText(e.claude.summary)}</p></aside>`;
  }
  body += `<p class="meta"><a href="#${attr(e.id)}"><time datetime="${attr(e.date)}">${esc(p.hm)}</time></a>${tags}</p>`;
  return `<li class="entry" id="${attr(e.id)}" data-mark="${attr(mark(e))}" data-tags="${attr((e.tags || []).join(" "))}">${body}</li>`;
}

function renderDays(entries) {
  const days = new Map();
  for (const e of entries) {
    const k = parts(e.date).day;
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  let html = "";
  for (const [day, list] of days) {
    const p = parts(list[0].date);
    html += `<section class="day" aria-label="${attr(`${p.d} ${MONTHS_LONG[p.m]} ${p.y}`)}"><div class="stamp"><span class="d">${p.d}</span><span class="m">${MONTHS[p.m]}</span><span class="y">${p.y}</span></div><ul class="entries">`;
    html += list.map(renderEntry).join("\n");
    html += `</ul></section>\n`;
  }
  return html;
}

function renderTags(entries, tags) {
  const counts = {};
  for (const e of entries) for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
  const used = Object.keys(tags).filter((t) => counts[t]).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  if (!used.length) return "";
  let html = `    <li><button type="button" data-tag="" aria-pressed="true">all<span class="n">${entries.length}</span></button></li>\n`;
  for (const t of used) html += `    <li><button type="button" data-tag="${attr(t)}" aria-pressed="false" title="${attr(tags[t])}">${esc(t)}<span class="n">${counts[t]}</span></button></li>\n`;
  return html;
}

function renderFeed(entries) {
  const items = entries.slice(0, 50).map((e) => {
    const title = e.type === "link" ? e.title : (e.text.split("\n")[0].slice(0, 80) || `photo ${e.id}`);
    let html = "";
    if (e.type === "link") html += `<p><a href="${attr(e.url)}">${esc(e.title)}</a> <small>${esc(domainOf(e.url))}</small></p>`;
    if (e.type === "photo") html += `<p><img src="${SITE}/${attr(e.image)}" alt="${attr(e.text)}"></p>`;
    if (e.text) html += `<p>${richText(e.text).replace(/\n/g, "<br>")}</p>`;
    if (e.claude) html += `<p><em>claude:</em> ${richText(e.claude.summary)}</p>`;
    return `  <item>
    <title>${esc(`${mark(e)} ${title}`)}</title>
    <link>${SITE}/#${esc(e.id)}</link>
    <guid isPermaLink="true">${SITE}/#${esc(e.id)}</guid>
    <pubDate>${new Date(e.date).toUTCString()}</pubDate>
    ${(e.tags || []).map((t) => `<category>${esc(t)}</category>`).join("")}
    <description>${esc(html)}</description>
  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>things — Costa Fotiadis</title>
  <link>${SITE}/</link>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Links, ideas, notes and photos Costa sends himself.</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
</channel>
</rss>
`;
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    if (f.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function build() {
  const { entries, tags } = loadEntries();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
  const built = new Date().toISOString().slice(0, 10);
  const html = fs.readFileSync(path.join(__dirname, "template.html"), "utf8")
    .replace("{{CSS}}", () => css)
    .replace("{{TAGS}}", () => renderTags(entries, tags))
    .replace("{{DAYS}}", () => renderDays(entries))
    .replace(/\{\{COUNT\}\}/g, String(entries.length))
    .replace(/\{\{SITE\}\}/g, SITE)
    .replace("{{BUILT}}", built);

  fs.writeFileSync(path.join(OUT, "index.html"), html);
  fs.writeFileSync(path.join(OUT, "things.json"), JSON.stringify(entries, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "feed.xml"), renderFeed(entries));
  copyDir(path.join(ROOT, "images"), path.join(OUT, "images"));
  copyDir(path.join(__dirname, "static"), OUT);
  console.log(`built ${entries.length} entries -> site/`);
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
module.exports = { build };

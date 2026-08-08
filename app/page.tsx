"use client"

import { useState, useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import { motion, AnimatePresence } from "framer-motion"

// ─── GOOGLE SHEETS API ────────────────────────────────────────────────────────

const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbzf4cjOSpwNp2DWywWxWYnx76r7-Tp_GvOphUOqz7-Ln0v8qK9fA-f66wOElv-nlkBLeg/exec"

const isBlendBean = bean => bean?.beanType === "blend"

async function postToSheet(action, payload) {
  const res = await fetch(SHEET_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    redirect: "follow",
    body: JSON.stringify({ action, payload }),
  })
  if (!res.ok) throw new Error(`Sheet API HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Sheet API returned an error")
  return json.data
}

/**
 * Region and farm share one input, so people type "Sidama / Hamasho" or
 * "Sidama, Hamasho". Normalise any of those separators to a middot.
 */
function formatRegionFarm(s) {
  return String(s || "")
    .split(/\s*[\/|,·]\s*/)
    .map(p => p.trim())
    .filter(Boolean)
    .join(" · ")
}

function formatBlendComponentLine(comp) {
  const parts = [comp.country, comp.variety, comp.process].filter(Boolean)
  const ratio = comp.ratio ? `${String(comp.ratio).replace("%", "")}%` : ""
  return [...parts, ratio].filter(Boolean).join(" · ")
}

function beanToSheetRow(bean) {
  const base = {
    id: bean.id,
    beanType: bean.beanType,
    name: bean.name,
    roaster: bean.roaster || "",
    roasterMachine: bean.roasterMachine || "",
    roastPoint: bean.roastPoint || "",
    roastDate: bean.roastDate || "",
    bagSize: bean.bagSize || 200,
    remaining: bean.remaining ?? 100,
    tastingNotes: (bean.tastingNotes || []).join(", "),
    memo: bean.memo || "",
    archived: false,
    rating: "",
    createdAt: new Date().toISOString(),
  }
  if (isBlendBean(bean)) {
    const components = bean.components || []
    return {
      row: {
        ...base,
        blendName: bean.blendName || bean.name,
        componentCount: components.length,
        componentsText: components.map(formatBlendComponentLine).join(" / "),
        componentsJson: JSON.stringify(components),
      },
    }
  }
  return {
    row: {
      ...base,
      country: bean.origin || "",
      farm: bean.farm || "",
      variety: bean.variety || "",
      process: bean.process || "",
      altitude: bean.altitude || "",
    },
  }
}

function sheetRowToBean(row) {
  const blend = String(row.beanType || "").toLowerCase() === "blend"
  let components = []
  if (blend && row.componentsJson) {
    try { components = JSON.parse(row.componentsJson) } catch { components = [] }
  }
  const notes = row.tastingNotes
    ? String(row.tastingNotes).split(",").map(n => n.trim()).filter(Boolean)
    : []
  return {
    id: row.id,
    beanType: blend ? "blend" : "single",
    name: row.name || (blend ? row.blendName : "") || "Untitled",
    roaster: row.roaster || "",
    roasterMachine: row.roasterMachine || "",
    roastPoint: row.roastPoint || "",
    origin: blend ? "Blend" : (row.country || ""),
    farm: blend ? "" : (row.farm || ""),
    variety: blend ? "Blend" : (row.variety || ""),
    process: blend ? "Blend" : (row.process || ""),
    altitude: blend ? undefined : (row.altitude || ""),
    blendName: blend ? (row.blendName || row.name) : undefined,
    components: blend ? components : undefined,
    roastDate: row.roastDate || new Date().toISOString().split("T")[0],
    bagSize: Number(row.bagSize || 200),
    remaining: Number(row.remaining ?? 100),
    tastingNotes: notes,
    memo: row.memo || "",
    rating: row.rating ? Number(row.rating) : undefined,
    archivedAt: row.archivedAt || undefined,
  }
}

function sheetRowToRecipe(row) {
  let pours = []
  if (row.poursJson) {
    try { pours = JSON.parse(row.poursJson) } catch { pours = [] }
  }
  return {
    id: row.id,
    name: row.name || "Untitled recipe",
    beanId: row.beanId || "",
    dose: row.dose || "",
    grinder: row.grinder || "",
    clicks: row.clicks || "",
    waterTemp: row.waterTemp || "",
    dripper: row.dripper || "",
    filter: row.filter || "",
    totalTime: row.totalTime || "",
    pours,
  }
}

async function fetchAll() {
  const res = await fetch(`${SHEET_API_URL}?action=list`, { method: "GET", redirect: "follow" })
  if (!res.ok) throw new Error(`Sheet API HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Sheet API returned an error")
  const rows = [...(json.data?.single || []), ...(json.data?.blend || [])]
  const beans = rows.map(sheetRowToBean)
  const recipes = (json.data?.recipes || []).map(sheetRowToRecipe)
  return {
    active: beans.filter(b => !b.archivedAt),
    archived: beans.filter(b => b.archivedAt),
    recipes,
  }
}

async function postAddBean(bean) {
  return postToSheet("addBean", beanToSheetRow(bean))
}

async function postArchiveBean(bean, rating) {
  return postToSheet("archiveBean", {
    id: bean.id,
    beanType: bean.beanType,
    rating: rating ?? "",
    archivedAt: new Date().toISOString(),
  })
}

async function postUpsertRecipe(recipe) {
  return postToSheet("upsertRecipe", {
    row: {
      id: recipe.id,
      name: recipe.name,
      beanId: recipe.beanId || "",
      dose: recipe.dose || "",
      grinder: recipe.grinder || "",
      clicks: recipe.clicks || "",
      waterTemp: recipe.waterTemp || "",
      dripper: recipe.dripper || "",
      filter: recipe.filter || "",
      totalTime: recipe.totalTime || "",
      poursJson: JSON.stringify(recipe.pours || []),
      updatedAt: new Date().toISOString(),
    },
  })
}

/** Patch arbitrary fields on an existing bean row (edits + remaining). */
async function postUpdateBean(bean, fields) {
  return postToSheet("updateBean", {
    id: bean.id,
    beanType: bean.beanType,
    fields,
  })
}

async function fetchBrewLogs() {
  const res = await fetch(`${SHEET_API_URL}?action=brewlogs`, { method: "GET", redirect: "follow" })
  if (!res.ok) throw new Error(`Sheet API HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Sheet API returned an error")
  return (json.data?.logs || []).slice().reverse()
}

async function postBrewLog({ bean, recipe, feedback, dose }) {
  return postToSheet("addBrewLog", {
    row: {
      id: `log${Date.now()}`,
      brewedAt: new Date().toISOString(),
      beanId: bean.id,
      beanType: bean.beanType,
      beanName: isBlendBean(bean) ? (bean.blendName || bean.name) : bean.name,
      origin: bean.origin || "",
      process: bean.process || "",
      recipeId: recipe?.id || "",
      recipeName: recipe?.name || "",
      dose: dose || "",
      grinder: recipe?.grinder || "",
      clicks: recipe?.clicks || "",
      waterTemp: recipe?.waterTemp || "",
      dripper: recipe?.dripper || "",
      filter: recipe?.filter || "",
      totalTime: recipe?.totalTime || "",
      feedback: feedback || "",
    },
  })
}

// ─── TASTING NOTE → COLOR ─────────────────────────────────────────────────────
// Deterministic mapping so the same note always renders the same color,
// like the color bar on a specialty coffee bag label.

// Order matters: the FIRST match wins, so specific qualifiers ("green grape",
// "white wine") must be listed before the generic fruit they contain.
const NOTE_COLOR_MAP = [
  // ── Qualified exceptions — follow the literal color of the thing ──────────
  { keys: ["green grape", "white grape", "green apple", "green mango", "greengage"], color: "#A8C06A" },
  { keys: ["white wine", "white peach", "white flower", "white tea", "white chocolate", "white grapefruit"], color: "#EFE9D6" },
  { keys: ["yellow plum", "yellow fruit", "golden raisin", "yellow apple"], color: "#E8C75E" },
  { keys: ["red apple", "red grape", "red plum", "red fruit", "red berry"], color: "#C0453F" },
  { keys: ["black tea", "black currant", "blackcurrant"], color: "#4A3B57" },
  { keys: ["milk chocolate", "milk tea"], color: "#A9805A" },
  { keys: ["dark chocolate", "dark cherry", "dark berry"], color: "#4A2E22" },
  { keys: ["brown sugar", "brown spice"], color: "#9C6B3F" },
  { keys: ["green tea", "matcha"], color: "#8BA86B" },

  // ── Florals ──────────────────────────────────────────────────────────────
  { keys: ["jasmine", "chamomile", "elderflower", "honeysuckle", "orange blossom"], color: "#EAE6D8" },
  { keys: ["rose", "hibiscus", "floral"], color: "#E8B4C0" },
  { keys: ["lavender", "violet", "iris"], color: "#B9A8D0" },

  // ── Citrus ───────────────────────────────────────────────────────────────
  { keys: ["lemon", "lime", "citric", "yuzu", "citrus"], color: "#EFD867" },
  { keys: ["orange", "tangerine", "mandarin", "clementine"], color: "#EE9F4C" },
  { keys: ["grapefruit", "bergamot", "pomelo"], color: "#EE7A5C" },

  // ── Berries & dark fruit ─────────────────────────────────────────────────
  { keys: ["blueberry", "cassis", "plum", "fig"], color: "#5B5B93" },
  { keys: ["raspberry", "strawberry", "cherry", "cranberry", "pomegranate", "currant"], color: "#C94F5E" },
  { keys: ["blackberry", "grape", "winey", "wine", "raisin", "prune"], color: "#6E4460" },

  // ── Stone & orchard fruit ────────────────────────────────────────────────
  { keys: ["peach", "apricot", "nectarine", "stone fruit"], color: "#F2B48A" },
  { keys: ["apple", "pear", "melon", "quince"], color: "#B9CB8F" },
  { keys: ["lychee", "tropical", "mango", "pineapple", "passion", "papaya", "guava", "banana"], color: "#EFC33F" },

  // ── Sweet, nutty, spice ──────────────────────────────────────────────────
  { keys: ["earl grey", "tea", "oolong"], color: "#9B9083" },
  { keys: ["honey", "caramel", "maple", "molasses", "toffee", "cane sugar", "syrup"], color: "#C98F4A" },
  { keys: ["vanilla", "cream", "butter", "malt", "biscuit", "shortbread"], color: "#E4D3B0" },
  { keys: ["chocolate", "cocoa", "cacao", "fudge"], color: "#6B4A38" },
  { keys: ["almond", "hazelnut", "peanut", "walnut", "pecan", "nut"], color: "#B08D62" },
  { keys: ["cinnamon", "clove", "nutmeg", "spice", "anise", "pepper", "cardamom"], color: "#A65B33" },

  // ── Green / savory / roast ───────────────────────────────────────────────
  { keys: ["herb", "green", "mint", "grass", "basil", "fresh"], color: "#7EA377" },
  { keys: ["smoky", "tobacco", "roasted", "burnt", "ashy", "cedar", "wood"], color: "#5C554E" },
  { keys: ["fermented", "whiskey", "rum", "boozy", "funk", "brandy"], color: "#8A5A44" },
]

function noteColor(note) {
  const n = String(note).toLowerCase().trim()
  for (const entry of NOTE_COLOR_MAP) {
    if (entry.keys.some(k => n.includes(k))) return entry.color
  }
  return "#C9C2B6"
}

function hexA(hex, alpha) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0")
  return `${hex}${a}`
}

// ─── SEEDED GENERATIVE LABEL ART ──────────────────────────────────────────────
// Each bean gets a unique abstract artwork, generated deterministically from
// its id + tasting-note palette. Same bean → same art, every time.
// Five styles, cycled by shelf position so neighbours never look alike:
// 0 gradient / 1 bands / 2 wash / 3 petals / 4 ink (near-black, high contrast).

const INK_BLACK = "#141210"

function hashStr(s) {
  let h = 1779033703
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mixHex(h1, h2, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const [r1, g1, b1] = p(h1), [r2, g2, b2] = p(h2)
  const c = v => Math.round(v).toString(16).padStart(2, "0")
  return `#${c(r1 + (r2 - r1) * t)}${c(g1 + (g2 - g1) * t)}${c(b1 + (b2 - b1) * t)}`
}

function lumOf(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** How dark the roast reads, 0 = light, 1 = dark. Pulls the whole palette down. */
function roastDepth(bean) {
  const p = String(bean.roastPoint || "").toLowerCase()
  if (/(dark|french|italian|full ?city\+)/.test(p)) return 0.5
  if (/(medium ?dark|full ?city)/.test(p)) return 0.34
  if (/(medium|city)/.test(p)) return 0.2
  return 0.08
}

function beanArt(bean, index = null) {
  const seed = hashStr(String(bean.id) + String(bean.name || ""))
  const rnd = mulberry32(seed)
  const depth = roastDepth(bean)

  let cols = [...new Set((bean.tastingNotes || []).map(noteColor))]
  if (cols.length === 0) cols = ["#C9C2B6", "#EAE6D8"]
  if (cols.length === 1) cols = [cols[0], mixHex(cols[0], "#FFFFFF", 0.45)]
  // Darker roasts pull every swatch toward charcoal — the cup gets deeper.
  const P = cols.slice(0, 4).map(c => mixHex(c, INK_BLACK, depth * 0.4))

  // Four styles, cycled by shelf position so neighbours never look alike.
  const style = index === null ? seed % 4 : index % 4
  const W = 420, H = 540
  let inner = ""

  if (style === 0) {
    const ang = Math.floor(rnd() * 360)
    const stops = P.map((c, i) => `<stop offset="${Math.round((i / Math.max(1, P.length - 1)) * 100)}%" stop-color="${c}"/>`).join("")
    inner = `<defs><linearGradient id="lg" gradientTransform="rotate(${ang} 0.5 0.5)">${stops}</linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#lg)"/>` +
      `<circle cx="${rnd() * W}" cy="${rnd() * H}" r="${160 + rnd() * 130}" fill="#ffffff" opacity="0.16" filter="url(#blur)"/>`
  } else if (style === 1) {
    inner = `<rect width="${W}" height="${H}" fill="${P[0]}"/>`
    const n = 3 + Math.floor(rnd() * 2)
    const blackAt = Math.floor(rnd() * n)  // one band is always ink
    for (let i = 0; i < n; i++) {
      const c = i === blackAt ? INK_BLACK : P[(i + 1) % P.length]
      const y = rnd() * H
      const h = 70 + rnd() * 150
      const rot = rnd() * 56 - 28
      inner += `<rect x="-120" y="${y}" width="${W + 240}" height="${h}" fill="${c}" transform="rotate(${rot.toFixed(1)} ${W / 2} ${y.toFixed(1)})"/>`
    }
  } else if (style === 2) {
    inner = `<rect width="${W}" height="${H}" fill="${mixHex("#F2EFE7", INK_BLACK, depth * 0.3)}"/>`
    const n = 4 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const c = P[i % P.length]
      inner += `<ellipse cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" rx="${(100 + rnd() * 140).toFixed(1)}" ry="${(90 + rnd() * 130).toFixed(1)}" fill="${c}" opacity="${(0.32 + rnd() * 0.3).toFixed(2)}" filter="url(#blur)"/>`
    }
  } else if (style === 3) {
    const pale = mixHex(P[0], "#FFFFFF", 0.72 - depth * 0.35)
    inner = `<rect width="${W}" height="${H}" fill="${pale}"/>`
    const n = 5 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const c = P[i % P.length]
      const cx = rnd() * W, cy = rnd() * H
      const rx = 130 + rnd() * 170, ry = 60 + rnd() * 90
      const rot = rnd() * 180
      inner += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${c}" opacity="${(0.5 + rnd() * 0.3).toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})" filter="url(#soft)"/>`
      inner += `<ellipse cx="${(cx + rx * 0.18).toFixed(1)}" cy="${(cy - ry * 0.3).toFixed(1)}" rx="${(rx * 0.6).toFixed(1)}" ry="${(ry * 0.5).toFixed(1)}" fill="${mixHex(c, "#FFFFFF", 0.55)}" opacity="0.5" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})" filter="url(#soft)"/>`
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="48"/></filter><filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="30"/></filter></defs>${inner}</svg>`
  return { uri: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, style, palette: P }
}

/**
 * Card type is always dark now. Rather than flipping the ink to white on
 * darker art, we lay a light scrim under the text zone so one consistent
 * colour works everywhere — far easier to read, and calmer across a shelf.
 */
const CARD_INK = "#141210"        // headline info: country, farm, variety…
const CARD_INK_SOFT = "#4A453E"   // secondary line
const CARD_INK_FAINT = "#6E675E"  // tasting notes, kept light on purpose

const GRAIN = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

function titleCaseWords(s) {
  // Keep acronyms and codes intact (SL28, AA, AB, G1) — only fix plain words.
  return String(s || "")
    .split(/(\s+|·|\/)/)
    .map(tok => {
      if (!/[a-zA-Z]/.test(tok)) return tok
      // Short all-caps tokens are codes (AA, G1, SL); long ones are just
      // shouting (KENYA) and should be normalised.
      if (/^[A-Z0-9#.\-]+$/.test(tok) && tok.length <= 4) return tok
      if (/\d/.test(tok)) return tok.toUpperCase()          // e.g. sl28 → SL28
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase()
    })
    .join("")
}

/**
 * The one place mixed roman/italic type is allowed (ref: "eth·iopia").
 * The split point is derived from the WORD ITSELF, so every "Ethiopia" in the
 * app breaks at exactly the same letter — consistency over novelty.
 */
function MixedWord({ text, style }) {
  const t = titleCaseWords(text)
  const words = t.split(" ")
  const first = words[0] || ""
  if (first.length < 4) return <span style={style}>{t}</span>
  // Break just after the first vowel cluster, clamped to the middle third.
  const m = first.slice(1).match(/[aeiou]+/i)
  let cut = m ? 1 + m.index + m[0].length : Math.ceil(first.length / 2)
  cut = Math.max(2, Math.min(cut, first.length - 1))
  return (
    <span style={style}>
      {first.slice(0, cut)}
      <span style={{ fontStyle: "italic" }}>{first.slice(cut)}</span>
      {words.length > 1 ? " " + words.slice(1).join(" ") : ""}
    </span>
  )
}


// ─── GREETINGS ────────────────────────────────────────────────────────────────
// Deep enough (54) that a daily user shouldn't notice a repeat.
// One is picked per day, seeded by the date, so it stays put while you use the app.

const GREETINGS = [
  "First cup decides the day.",
  "Grind fine, live coarse.",
  "Water is 98% of it. Be humble.",
  "No such thing as too early.",
  "Bloom now, panic later.",
  "Flat bed, flat ego.",
  "Chase the aroma, not the clock.",
  "A bad brew is a rough draft.",
  "A farmer woke up before you.",
  "Slow pour, fast morning.",
  "Today's variable: everything.",
  "Taste it before you fix it.",
  "The kettle is patient.",
  "Sweetness lives past the panic.",
  "Two grams changes everything.",
  "Drink it while it's honest.",
  "Cold coffee tells the truth.",
  "Your palate is a muscle.",
  "Overextracted is just enthusiasm.",
  "Every bag is a countdown.",
  "Roast dates are a love language.",
  "You can't rush the bloom.",
  "Notes are a rumor until you taste.",
  "The best recipe is the repeated one.",
  "Consistency beats brilliance.",
  "Wake the beans gently.",
  "Small batch, whole heart.",
  "Acidity is not an insult.",
  "Let it cool. It gets better.",
  "The grinder knows what you did.",
  "A deadline with a smell.",
  "Measure twice, drink once.",
  "Beans travel far. Respect the trip.",
  "Nothing good was brewed in a hurry.",
  "Log it or it never happened.",
  "The scale doesn't lie. You might.",
  "Filter coffee, unfiltered thoughts.",
  "Today's dose: enough.",
  "Rinse the filter. Rinse the mind.",
  "Some mornings are a light roast.",
  "Some mornings need a dark one.",
  "Stir gently, think loudly.",
  "Altitude builds character.",
  "The pour is the meditation.",
  "One more click finer.",
  "Good beans forgive small mistakes.",
  "Steam rises. So can you.",
  "Drink the good stuff on plain days.",
  "Fresh is a fleeting condition.",
  "Brew like someone's watching.",
  "Begin. The water's ready.",
  "Under is worse than over.",
  "Patience tastes like sugar.",
  "You are what you steep.",
]

/** A fresh line on every visit. Picked on the client so SSR can't fix it. */
function randomGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const T = {
  paper: "#EBE9E3",
  card: "#F7F6F2",
  ink: "#0D0C0A",
  sub: "rgba(13,12,10,0.66)",
  faint: "rgba(13,12,10,0.42)",
  ghost: "rgba(13,12,10,0.18)",
  line: "rgba(13,12,10,0.18)",
  hairline: "1px solid rgba(13,12,10,0.18)",
  star: "#0D0C0A",
}

const MONO: CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
}

const label = (size = 9, color = T.faint): CSSProperties => ({
  ...MONO, fontSize: `${size}px`, color,
})

const serifStyle = (size, color = T.ink, weight = 400): CSSProperties => ({
  fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  fontSize: `${size}px`,
  fontWeight: weight,
  color,
  lineHeight: 1.15,
})

const FORM: { label: CSSProperties; input: CSSProperties; textarea: CSSProperties } = {
  label: { ...MONO, fontSize: "8px", color: T.faint, display: "block", marginBottom: "7px" },
  input: { width: "100%", height: "42px", background: "transparent", border: "none", borderBottom: T.hairline, padding: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "13px", color: T.ink, outline: "none", boxSizing: "border-box", borderRadius: 0 },
  textarea: { width: "100%", background: "transparent", border: "none", borderBottom: T.hairline, padding: "10px 0", fontFamily: "Georgia, serif", fontSize: "14px", lineHeight: 1.75, color: T.ink, outline: "none", resize: "none", boxSizing: "border-box", borderRadius: 0 },
}

const BTN = {
  solid: { height: "40px", padding: "0 24px", background: T.ink, border: "none", color: T.paper, cursor: "pointer", ...MONO, fontSize: "9px" } as CSSProperties,
  ghost: { height: "40px", padding: "0 20px", background: "transparent", border: T.hairline, color: T.sub, cursor: "pointer", ...MONO, fontSize: "9px" } as CSSProperties,
}

function getRoastDDay(roastDate) {
  const roast = new Date(roastDate)
  const today = new Date()
  roast.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - roast.getTime()) / (1000 * 60 * 60 * 24)))
}

const SCA_FLAVOR_WHEEL = [
  { category: "Fruity", notes: ["Blackberry", "Raspberry", "Blueberry", "Strawberry", "Raisin", "Prune", "Cherry", "Pomegranate", "Pineapple", "Grape", "Apple", "Peach", "Pear", "Grapefruit", "Orange", "Lemon", "Lime", "Lychee", "Cranberry", "Mango"] },
  { category: "Floral", notes: ["Chamomile", "Rose", "Jasmine", "Hibiscus", "Lavender", "White Flower"] },
  { category: "Sweet", notes: ["Honey", "Caramel", "Maple Syrup", "Molasses", "Vanilla", "Brown Sugar", "Cane Sugar"] },
  { category: "Nutty / Cocoa", notes: ["Almond", "Hazelnut", "Peanuts", "Chocolate", "Cocoa", "Dark Chocolate"] },
  { category: "Spices", notes: ["Cinnamon", "Clove", "Nutmeg", "Anise", "Pepper"] },
  { category: "Tea / Roasted", notes: ["Earl Grey", "Black Tea", "Malt", "Grain", "Smoky", "Tobacco"] },
  { category: "Green / Fresh", notes: ["Fresh", "Herb-like", "Mint", "Green Apple"] },
  { category: "Fermented", notes: ["Winey", "Whiskey", "Fermented", "Boozy"] },
]

// ─── SMALL PRIMITIVES ─────────────────────────────────────────────────────────

function FormField({ label: text, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <span style={FORM.label}>{text}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={FORM.input} />
    </div>
  )
}

function Stars({ value, onChange = undefined, size = 22, readOnly = false }) {
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange && onChange(n)}
          style={{ background: "none", border: "none", cursor: readOnly ? "default" : "pointer", fontSize: `${size}px`, lineHeight: 1, padding: 0, color: n <= (value || 0) ? T.ink : "rgba(13,12,10,0.18)", transition: "color 0.15s" }}
        >★</button>
      ))}
    </div>
  )
}

function TypeToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", border: T.hairline }}>
      {[{ id: "single", label: "Single Origin" }, { id: "blend", label: "Blend" }].map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          style={{ flex: 1, height: "38px", background: value === opt.id ? T.ink : "transparent", color: value === opt.id ? T.paper : T.faint, border: "none", borderRight: opt.id === "single" ? T.hairline : "none", cursor: "pointer", ...MONO, fontSize: "9px", transition: "all 0.2s" }}
        >{opt.label}</button>
      ))}
    </div>
  )
}

function NotePicker({ selected, onToggle }) {
  const [custom, setCustom] = useState("")
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <span style={{ ...FORM.label, marginBottom: 0 }}>Tasting Notes</span>
        <button type="button" onClick={() => setOpen(p => !p)} style={{ background: "none", border: "none", cursor: "pointer", ...MONO, fontSize: "8px", color: T.sub }}>
          {open ? "Close" : "Browse flavor wheel"}
        </button>
      </div>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
          {selected.map(n => (
            <button key={n} type="button" onClick={() => onToggle(n)}
              style={{ display: "flex", alignItems: "center", gap: "7px", border: T.hairline, background: T.card, padding: "5px 10px", cursor: "pointer", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: T.ink }}>
              <span style={{ width: "9px", height: "9px", background: noteColor(n), display: "inline-block" }} />
              {n} ×
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div style={{ border: T.hairline, padding: "14px", marginBottom: "10px", maxHeight: "220px", overflowY: "auto" }}>
              {SCA_FLAVOR_WHEEL.map(cat => (
                <div key={cat.category} style={{ marginBottom: "12px" }}>
                  <div style={{ ...label(8), marginBottom: "7px" }}>{cat.category}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {cat.notes.map(n => {
                      const active = selected.includes(n)
                      return (
                        <button key={n} type="button" onClick={() => onToggle(n)}
                          style={{ border: T.hairline, background: active ? T.ink : "transparent", color: active ? T.paper : T.sub, padding: "4px 9px", cursor: "pointer", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px" }}>
                          {n}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && custom.trim()) {
              e.preventDefault()
              onToggle(custom.trim())
              setCustom("")
            }
          }}
          placeholder="Type a custom note, press Enter…"
          style={{ ...FORM.input, height: "36px", fontSize: "11px" }}
        />
      </div>
    </div>
  )
}

// ─── ADD BEAN MODAL ───────────────────────────────────────────────────────────

function AddBeanModal({ onClose, onSave, existing = null }) {
  const isEdit = !!existing
  const [beanType, setBeanType] = useState(existing?.beanType || "single")
  const [country, setCountry] = useState(existing?.origin && existing.origin !== "Blend" ? existing.origin : "")
  const [regionFarm, setRegionFarm] = useState(existing?.farm || "")
  const [variety, setVariety] = useState(existing?.variety && existing.variety !== "Blend" ? existing.variety : "")
  const [process, setProcess] = useState(existing?.process && existing.process !== "Blend" ? existing.process : "")
  const [altitude, setAltitude] = useState(existing?.altitude || "")
  const [roastery, setRoastery] = useState(existing?.roaster || "")
  const [roasterMachine, setRoasterMachine] = useState(existing?.roasterMachine || "")
  const [roastPoint, setRoastPoint] = useState(existing?.roastPoint || "")
  const [roastDate, setRoastDate] = useState(existing?.roastDate || "")
  const [bagSize, setBagSize] = useState(String(existing?.bagSize || 200))
  const [blendName, setBlendName] = useState(existing?.blendName || "")
  const [components, setComponents] = useState(
    existing?.components?.length
      ? existing.components.map((c, i) => ({ id: String(i + 1), ...c }))
      : [{ id: "1", country: "", variety: "", process: "", ratio: "" }]
  )
  const [description, setDescription] = useState(existing?.memo || "")
  const [tastingNotes, setTastingNotes] = useState(existing?.tastingNotes || [])

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const toggleNote = n => setTastingNotes(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  const addComponent = () => setComponents(prev => [...prev, { id: String(Date.now()), country: "", variety: "", process: "", ratio: "" }])
  const updateComponent = (id, field, val) => setComponents(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c))
  const removeComponent = id => { if (components.length > 1) setComponents(prev => prev.filter(c => c.id !== id)) }

  const handleSave = () => {
    const id = existing?.id || `b${Date.now()}`
    const isBlend = beanType === "blend"
    const newBean = {
      id,
      beanType: isBlend ? "blend" : "single",
      name: isBlend ? (blendName || "Untitled Blend") : (regionFarm || `${country} ${variety}`.trim() || "Untitled"),
      roaster: roastery,
      roasterMachine,
      roastPoint,
      origin: isBlend ? "Blend" : country,
      farm: isBlend ? "" : regionFarm,
      variety: isBlend ? "Blend" : variety,
      process: isBlend ? "Blend" : process,
      roastDate: roastDate || new Date().toISOString().split("T")[0],
      bagSize: Number(bagSize) || 200,
      remaining: existing ? existing.remaining : 100,
      tastingNotes,
      memo: description,
      altitude: isBlend ? undefined : altitude,
      blendName: isBlend ? blendName : undefined,
      components: isBlend ? components.map(c => ({ country: c.country, variety: c.variety, process: c.process, ratio: c.ratio })) : undefined,
    }
    onSave(newBean)
    onClose()
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(13,12,10,0.55)", backdropFilter: "blur(6px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 151, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", pointerEvents: "none" }}>
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.99 }}
          transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
          onClick={e => e.stopPropagation()}
          style={{ width: "100%", maxWidth: "540px", maxHeight: "90vh", overflowY: "auto", background: T.card, border: T.hairline, pointerEvents: "auto", padding: "30px 28px 26px", boxSizing: "border-box" }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "26px" }}>
            <div>
              <div style={{ ...label(8), marginBottom: "7px" }}>{isEdit ? "Edit Bean" : "New Bean"}</div>
              <h2 style={{ ...serifStyle(26), margin: 0, fontStyle: "italic" }}>{isEdit ? "Fix the details" : "Add to the shelf"}</h2>
            </div>
            <button onClick={onClose} style={{ width: "38px", height: "38px", background: "transparent", border: T.hairline, color: T.sub, cursor: "pointer", fontSize: "16px" }}>×</button>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <TypeToggle value={beanType} onChange={setBeanType} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <AnimatePresence mode="wait">
              {beanType === "single" ? (
                <motion.div key="single" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <FormField label="Country" value={country} onChange={setCountry} placeholder="e.g. Kenya" />
                    <FormField label="Region · Farm" value={regionFarm} onChange={setRegionFarm} placeholder="e.g. Sidama / Hamasho" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <FormField label="Variety" value={variety} onChange={setVariety} placeholder="e.g. SL28 · SL34" />
                    <FormField label="Process" value={process} onChange={setProcess} placeholder="e.g. Washed" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <FormField label="Altitude" value={altitude} onChange={setAltitude} placeholder="e.g. 1,800 masl" />
                    <div>
                      <span style={FORM.label}>Roast Date</span>
                      <input type="date" value={roastDate} onChange={e => setRoastDate(e.target.value)} style={{ ...FORM.input, colorScheme: "light" }} />
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="blend" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <FormField label="Blend Name" value={blendName} onChange={setBlendName} placeholder="e.g. House Blend No.3" />
                    <div>
                      <span style={FORM.label}>Roast Date</span>
                      <input type="date" value={roastDate} onChange={e => setRoastDate(e.target.value)} style={{ ...FORM.input, colorScheme: "light" }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ ...FORM.label }}>Components</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {components.map((comp, i) => (
                        <div key={comp.id} style={{ border: T.hairline, padding: "14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                            <span style={label(8)}>Component {i + 1}</span>
                            <button type="button" onClick={() => removeComponent(comp.id)} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", ...MONO, fontSize: "8px" }}>Remove</button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <input value={comp.country} onChange={e => updateComponent(comp.id, "country", e.target.value)} placeholder="Country" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                            <input value={comp.variety} onChange={e => updateComponent(comp.id, "variety", e.target.value)} placeholder="Variety" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                            <input value={comp.process} onChange={e => updateComponent(comp.id, "process", e.target.value)} placeholder="Process" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                            <input value={comp.ratio} onChange={e => updateComponent(comp.id, "ratio", e.target.value)} placeholder="Ratio %" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={addComponent} style={{ ...BTN.ghost, height: "36px" }}>+ Add component</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <FormField label="Roastery" value={roastery} onChange={setRoastery} placeholder="e.g. Sey Coffee" />
              <FormField label="Roasting Machine" value={roasterMachine} onChange={setRoasterMachine} placeholder="e.g. Loring S15" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <FormField label="Roast Point" value={roastPoint} onChange={setRoastPoint} placeholder="e.g. Light / City" />
              <FormField label="Bag Size (g)" value={bagSize} onChange={setBagSize} placeholder="200" />
            </div>

            <NotePicker selected={tastingNotes} onToggle={toggleNote} />

            {tastingNotes.length > 0 && (
              <div>
                <div style={{ ...FORM.label }}>Label preview</div>
                <div style={{ position: "relative", height: "72px", overflow: "hidden", border: T.hairline, backgroundImage: beanArt({ id: `preview-${tastingNotes.join("|")}`, name: blendName || regionFarm || country, tastingNotes }).uri, backgroundSize: "cover", backgroundPosition: "center" }}>
                  <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "140px", opacity: 0.14, mixBlendMode: "multiply" }} />
                </div>
              </div>
            )}

            <div>
              <span style={FORM.label}>Description / Memo</span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Anything worth remembering about this bean…" style={FORM.textarea} />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "26px" }}>
            <button onClick={onClose} style={BTN.ghost}>Cancel</button>
            <button onClick={handleSave} style={BTN.solid}>{isEdit ? "Save Changes" : "Save Bean"}</button>
          </div>
        </motion.div>
      </div>
    </>
  )
}

// ─── RECORD FORM (log a brew) ─────────────────────────────────────────────────

function RecordForm({ bean, recipes, onClose, onLogged }) {
  const [recipeId, setRecipeId] = useState("")
  const [feedback, setFeedback] = useState("")
  const [dose, setDose] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const linked = recipes.filter(r => r.beanId === bean.id)
  const general = recipes.filter(r => r.beanId !== bean.id)
  const recipe = recipes.find(r => r.id === recipeId)

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  // Pull the recipe's default dose in whenever a recipe is selected.
  useEffect(() => {
    if (recipe?.dose) setDose(String(recipe.dose).replace(/[^0-9.]/g, ""))
  }, [recipeId])

  const bagSize = Number(bean.bagSize) || 200
  const doseNum = parseFloat(dose)
  const pctUsed = doseNum > 0 ? (doseNum / bagSize) * 100 : 0
  const nextRemaining = Math.max(0, Math.round((bean.remaining - pctUsed) * 10) / 10)

  const handleSaveEntry = async () => {
    setSaving(true)
    setError("")
    try {
      await postBrewLog({ bean, recipe, feedback, dose })
      // Only decrement once the log itself is safely stored.
      if (pctUsed > 0) await onLogged(bean, nextRemaining)
      onClose()
    } catch (err) {
      console.error("[brewlog] save failed:", err)
      setError(err.message || "Could not save. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: T.paper, overflowY: "auto" }}>
      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "44px 28px 80px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "36px" }}>
          <div>
            <div style={{ ...label(8), marginBottom: "7px" }}>{bean.origin} · {bean.process}</div>
            <h2 style={{ ...serifStyle(28), margin: 0, fontStyle: "italic" }}>Log a brew</h2>
          </div>
          <button onClick={onClose} style={{ width: "38px", height: "38px", background: "transparent", border: T.hairline, color: T.sub, cursor: "pointer", fontSize: "16px" }}>×</button>
        </div>

        <div style={{ marginBottom: "26px" }}>
          <span style={FORM.label}>Bean</span>
          <div style={{ ...serifStyle(17, T.ink), paddingBottom: "10px", borderBottom: T.hairline }}>{bean.name}</div>
        </div>

        <div style={{ marginBottom: "26px" }}>
          <span style={FORM.label}>Saved Recipe</span>
          <div style={{ position: "relative" }}>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)} style={{ ...FORM.input, appearance: "none", paddingRight: "24px", cursor: "pointer" }}>
              <option value="">Select a recipe…</option>
              {linked.length > 0 && <optgroup label="For this bean">
                {linked.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>}
              {general.length > 0 && <optgroup label="All recipes">
                {general.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>}
            </select>
            <span style={{ position: "absolute", right: "2px", top: "50%", transform: "translateY(-50%)", color: T.faint, pointerEvents: "none", fontSize: "9px" }}>▾</span>
          </div>
          {recipes.length === 0 && (
            <div style={{ ...label(8, T.faint), marginTop: "10px", textTransform: "none", letterSpacing: "0.05em" }}>
              No recipes yet — create one in the Recipe tab.
            </div>
          )}
        </div>

        <AnimatePresence>
          {recipe && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginBottom: "26px" }}>
              <div style={{ border: T.hairline, padding: "18px", background: T.card }}>
                <div style={{ ...label(8), marginBottom: "14px" }}>✓ {recipe.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" }}>
                  {[["Dose", recipe.dose && `${String(recipe.dose).replace(/g$/, "")}g`], ["Grinder", recipe.grinder], ["Clicks", recipe.clicks], ["Temp", recipe.waterTemp], ["Dripper", recipe.dripper], ["Filter", recipe.filter], ["Total", recipe.totalTime]].filter(([, v]) => v).map(([l, v]) => (
                    <div key={l}>
                      <div style={{ ...label(7), marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", color: T.ink }}>{v}</div>
                    </div>
                  ))}
                </div>
                {recipe.pours.length > 0 && (
                  <div style={{ borderTop: T.hairline, paddingTop: "14px", marginTop: "14px" }}>
                    <div style={{ ...label(7), marginBottom: "10px" }}>Pour Schedule</div>
                    {recipe.pours.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: "16px", marginBottom: "6px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px" }}>
                        <span style={{ color: T.faint, width: "40px" }}>{p.time}</span>
                        <span style={{ color: T.ink, width: "52px" }}>{p.water}</span>
                        <span style={{ color: T.sub }}>{p.note}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dose → drives the remaining-amount countdown */}
        <div style={{ marginBottom: "26px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "end" }}>
            <div>
              <span style={FORM.label}>Dose used (g)</span>
              <input
                value={dose}
                onChange={e => setDose(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 15"
                style={FORM.input}
              />
            </div>
            <div>
              <span style={FORM.label}>Remaining after this brew</span>
              <div style={{ height: "42px", display: "flex", alignItems: "center", gap: "10px", borderBottom: T.hairline }}>
                <div style={{ flex: 1, height: "2px", background: "rgba(13,12,10,0.14)" }}>
                  <div style={{ height: "2px", width: `${nextRemaining}%`, background: T.ink, transition: "width 0.3s" }} />
                </div>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", color: pctUsed > 0 ? T.ink : T.faint }}>
                  {pctUsed > 0 ? `${nextRemaining}%` : `${bean.remaining}%`}
                </span>
              </div>
            </div>
          </div>
          <div style={{ ...label(8, T.faint), textTransform: "none", letterSpacing: "0.05em", marginTop: "8px" }}>
            Bag size {bagSize}g · leave dose empty to log without changing the remaining amount.
          </div>
        </div>

        <div style={{ marginBottom: "30px" }}>
          <span style={FORM.label}>Tasting Memo</span>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={5}
            placeholder="How did it taste today? Aroma, acidity, body, finish…" style={FORM.textarea} />
        </div>

        {error && (
          <div style={{ border: "1px solid rgba(180,60,40,0.35)", background: "rgba(180,60,40,0.06)", padding: "12px 14px", marginBottom: "14px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: "#8C3B28", lineHeight: 1.6 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button onClick={onClose} style={BTN.ghost}>Cancel</button>
          <button onClick={handleSaveEntry} disabled={saving} style={{ ...BTN.solid, opacity: saving ? 0.5 : 1, cursor: saving ? "wait" : "pointer" }}>{saving ? "Saving…" : "Save Entry"}</button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── BEAN DETAIL MODAL ────────────────────────────────────────────────────────

function BeanDetailModal({ bean, recipes, index, onClose, onArchive, onEdit, onLogged }) {
  const [showRecord, setShowRecord] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [rating, setRating] = useState(0)
  const isBlend = bean.beanType === "blend"
  const dday = getRoastDDay(bean.roastDate)
  const roasted = new Date(bean.roastDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const art = beanArt(bean, index)

  useEffect(() => {
    const h = e => e.key === "Escape" && (showRecord ? setShowRecord(false) : onClose())
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [showRecord, onClose])

  const meta = isBlend
    ? [["Roastery", bean.roaster], ["Machine", bean.roasterMachine], ["Roast Point", bean.roastPoint], ["Bag Size", bean.bagSize ? `${bean.bagSize}g` : ""]]
    : [["Region · Farm", formatRegionFarm(bean.farm)], ["Altitude", bean.altitude], ["Process", bean.process], ["Variety", bean.variety], ["Roastery", bean.roaster], ["Machine", bean.roasterMachine], ["Roast Point", bean.roastPoint], ["Bag Size", bean.bagSize ? `${bean.bagSize}g` : ""]]

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{ position: "fixed", inset: 0, zIndex: 100, background: T.paper }}
      />

      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        style={{ position: "fixed", inset: 0, zIndex: 101, display: "flex", flexDirection: "column" }}
      >
        {/* Header rail */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.1 }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderBottom: T.hairline, flexShrink: 0 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: T.ink }} />
            <span style={label(8)}>Archive / {String(index ?? 0).padStart(3, "0")}</span>
          </div>
          <button onClick={onClose} style={{ width: "34px", height: "34px", background: "transparent", border: T.hairline, color: T.sub, cursor: "pointer", fontSize: "15px" }}>×</button>
        </motion.div>

        {/* Three-column body */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(320px, 1.5fr) minmax(280px, 1.1fr)", minHeight: 0 }}>
          {/* Left — origin headline + collection meta */}
          <motion.div
            initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.24, delay: 0.1 }}
            style={{ padding: "36px 28px", borderRight: T.hairline, display: "flex", flexDirection: "column", overflowY: "auto" }}
          >
            <div style={{ ...label(8), marginBottom: "10px" }}>Origin</div>
            <MixedWord
              text={isBlend ? "Blend" : bean.origin}
              style={{ ...serifStyle(38), letterSpacing: "-0.01em", display: "block", marginBottom: "10px" }}
            />
            <div style={{ ...serifStyle(16, T.sub), marginBottom: "30px" }}>
              {isBlend ? (bean.blendName || bean.name) : bean.name}
            </div>

            <div style={{ ...label(8), marginBottom: "8px" }}>Collection</div>
            <div style={{ ...serifStyle(16), marginBottom: "26px" }}>{bean.roaster || "Untitled Roastery"}</div>

            <div style={{ ...label(8), marginBottom: "8px" }}>Index No.</div>
            <p style={{ ...serifStyle(14, T.sub), lineHeight: 1.7, marginBottom: "28px" }}>
              {bean.memo || "No notes recorded for this bean yet."}
            </p>

            <div style={{ marginTop: "auto", paddingTop: "24px" }}>
              <div style={{ ...label(8), marginBottom: "10px" }}>Remaining</div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ flex: 1, height: "2px", background: "rgba(13,12,10,0.14)" }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${bean.remaining}%` }} transition={{ delay: 0.25, duration: 0.8 }} style={{ height: "2px", background: T.ink }} />
                </div>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px" }}>{bean.remaining}%</span>
              </div>
            </div>
          </motion.div>

          {/* Center — the artwork, nothing else */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "36px", position: "relative", overflow: "hidden" }}>
            <motion.div
              layoutId={`bean-card-${bean.id}`}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              style={{
                position: "relative", height: "100%", width: "auto",
                aspectRatio: "3/4", margin: "0 auto",
                backgroundImage: art.uri, backgroundSize: "cover", backgroundPosition: "center",
                boxShadow: "0 28px 70px rgba(20,18,15,0.18)", overflow: "hidden",
                willChange: "transform", backfaceVisibility: "hidden",
              }}
            >
              <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "140px", opacity: 0.14, mixBlendMode: "multiply" }} />
            </motion.div>
          </div>

          {/* Right — technical profile + actions */}
          <motion.div
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.24, delay: 0.1 }}
            style={{ borderLeft: T.hairline, display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "36px 28px" }}>
              <div style={{ ...label(8), marginBottom: "18px" }}>Technical Profile</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 20px", marginBottom: "26px" }}>
                {meta.filter(([, v]) => v).map(([l, v]) => (
                  <div key={l}>
                    <div style={{ ...label(7), marginBottom: "4px" }}>{l}</div>
                    <div style={{ ...serifStyle(14) }}>{v}</div>
                  </div>
                ))}
              </div>

              {isBlend && (bean.components || []).length > 0 && (
                <div style={{ marginBottom: "26px", paddingTop: "18px", borderTop: T.hairline }}>
                  <div style={{ ...label(7), marginBottom: "10px" }}>Components</div>
                  {(bean.components || []).map((c, i) => (
                    <div key={i} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: T.sub, marginBottom: "4px" }}>{formatBlendComponentLine(c)}</div>
                  ))}
                </div>
              )}

              {bean.tastingNotes.length > 0 && (
                <div style={{ paddingTop: "18px", borderTop: T.hairline, marginBottom: "26px" }}>
                  <div style={{ ...label(7), marginBottom: "10px" }}>Flavor Spectrum</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {bean.tastingNotes.map(n => (
                      <span key={n} style={{ display: "flex", alignItems: "center", gap: "7px", border: T.hairline, padding: "5px 10px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: T.sub, background: T.card }}>
                        <span style={{ width: "8px", height: "8px", background: noteColor(n), display: "inline-block" }} />
                        {n.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ paddingTop: "18px", borderTop: T.hairline }}>
                <div style={{ ...label(7), marginBottom: "6px" }}>Roast Date</div>
                <div style={{ ...serifStyle(14) }}>{roasted} <span style={{ color: T.faint }}>· D+{dday}</span></div>
              </div>
            </div>

            {/* Action bar, pinned bottom-right */}
            <div style={{ borderTop: T.hairline, padding: "18px 28px", flexShrink: 0 }}>
              <AnimatePresence mode="wait">
                {!archiving ? (
                  <motion.div key="actions" exit={{ opacity: 0 }} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button
                      onClick={() => setShowRecord(true)}
                      style={{ ...BTN.solid, width: "100%", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
                    >
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#C98F4A" }} />
                      Brew
                    </button>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => { onEdit(bean); onClose() }} style={{ ...BTN.ghost, flex: 1, padding: 0 }}>Edit</button>
                      <button onClick={() => setArchiving(true)} style={{ ...BTN.ghost, flex: 1, padding: 0 }}>Archive</button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="rating" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: "center" }}>
                    <div style={{ ...label(8), marginBottom: "10px" }}>How was this bean overall?</div>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "14px" }}>
                      <Stars value={rating} onChange={setRating} size={24} />
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => setArchiving(false)} style={{ ...BTN.ghost, flex: 1, padding: 0, height: "36px" }}>Back</button>
                      <button
                        onClick={() => { onArchive(bean, rating); onClose() }}
                        disabled={rating === 0}
                        style={{ ...BTN.solid, flex: 1, padding: 0, height: "36px", opacity: rating === 0 ? 0.4 : 1 }}
                      >Archive {rating || "–"}★</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

      </motion.div>

      <AnimatePresence>
        {showRecord && (
          <RecordForm
            bean={bean}
            recipes={recipes}
            onLogged={onLogged}
            onClose={() => { setShowRecord(false); onClose() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── BEAN CARD (generative label art) ─────────────────────────────────────────

function BeanCard({ bean, index, onClick }) {
  const [hovered, setHovered] = useState(false)
  const isBlend = bean.beanType === "blend"
  const dday = getRoastDDay(bean.roastDate)
  const art = beanArt(bean, index)
  const hero = isBlend ? (bean.blendName || bean.name) : (bean.origin || bean.name)

  return (
    <motion.article
      layoutId={`bean-card-${bean.id}`}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      style={{
        position: "relative",
        aspectRatio: "3/4",
        cursor: "pointer",
        overflow: "hidden",
        backgroundImage: art.uri,
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: hovered ? "1px solid rgba(13,12,10,0.55)" : T.hairline,
        boxShadow: hovered ? "0 14px 36px rgba(20,18,15,0.14)" : "0 2px 10px rgba(13,12,10,0.07)",
        transition: "border-color 0.2s, box-shadow 0.25s",
        willChange: "transform", backfaceVisibility: "hidden",
      }}
    >
      {/* Film grain */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "140px", opacity: 0.14, mixBlendMode: "multiply", pointerEvents: "none" }} />
      {/* Light scrim so the dark type reads on any artwork */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "linear-gradient(to top, rgba(243,241,236,0.92) 0%, rgba(243,241,236,0.72) 34%, rgba(243,241,236,0.16) 62%, transparent 82%)" }} />

      {/* Top row */}
      <div style={{ position: "absolute", top: "16px", left: "18px", right: "18px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ ...MONO, fontSize: "8px", color: CARD_INK_SOFT }}>{isBlend ? "Blend" : "Single Origin"}</span>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: CARD_INK_SOFT }}>D+{dday}</span>
      </div>

      {/* Text block — fades out during the expand so it never stretches */}
      <motion.div layout="position" style={{ position: "absolute", left: "18px", right: "18px", bottom: "34px" }}>
        <div style={{ marginBottom: "8px" }}>
          <MixedWord
            text={hero}
            style={{ ...serifStyle(34, CARD_INK), letterSpacing: "-0.01em", wordBreak: "break-word" }}
          />
        </div>
        {isBlend ? (
          (bean.components || []).slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: CARD_INK_SOFT, marginBottom: "3px" }}>
              {formatBlendComponentLine(c)}
            </div>
          ))
        ) : (
          <>
            {bean.farm && <div style={{ ...serifStyle(15, CARD_INK_SOFT) }}>{formatRegionFarm(bean.farm)}</div>}
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: CARD_INK_SOFT, marginTop: "5px", letterSpacing: "0.06em" }}>
              {[bean.variety, bean.process, bean.roastPoint].filter(Boolean).join(" · ")}
            </div>
          </>
        )}
        {bean.tastingNotes.length > 0 && (
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: CARD_INK_FAINT, marginTop: "8px", lineHeight: 1.6 }}>
            {bean.tastingNotes.slice(0, 4).join(" · ")}
          </div>
        )}
      </motion.div>

      {/* Remaining line */}
      <div style={{ position: "absolute", left: "18px", right: "18px", bottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ flex: 1, height: "1px", background: "rgba(20,18,15,0.22)" }}>
          <div style={{ height: "1px", width: `${bean.remaining}%`, background: CARD_INK }} />
        </div>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "8px", color: CARD_INK_SOFT }}>{bean.remaining}%</span>
      </div>
    </motion.article>
  )
}

// ─── RECIPE TAB ───────────────────────────────────────────────────────────────

const emptyRecipe = () => ({
  id: `r${Date.now()}`,
  name: "",
  beanId: "",
  dose: "",
  grinder: "",
  clicks: "",
  waterTemp: "",
  dripper: "",
  filter: "",
  totalTime: "",
  pours: [{ time: "0:00", water: "", note: "Bloom" }],
})

function RecipeForm({ initial, beans, onCancel, onSave }) {
  const [r, setR] = useState(initial)
  const set = (field, val) => setR(prev => ({ ...prev, [field]: val }))
  const setPour = (i, field, val) => setR(prev => ({ ...prev, pours: prev.pours.map((p, j) => j === i ? { ...p, [field]: val } : p) }))
  const addPour = () => setR(prev => ({ ...prev, pours: [...prev.pours, { time: "", water: "", note: "" }] }))
  const removePour = i => setR(prev => ({ ...prev, pours: prev.pours.filter((_, j) => j !== i) }))

  return (
    <div style={{ border: T.hairline, background: T.card, padding: "26px 24px" }}>
      <div style={{ ...label(8), marginBottom: "22px" }}>{initial.name ? "Edit recipe" : "New recipe"}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
          <FormField label="Recipe Name" value={r.name} onChange={v => set("name", v)} placeholder="e.g. Bright & Juicy V60" />
          <div>
            <span style={FORM.label}>Linked Bean (optional)</span>
            <div style={{ position: "relative" }}>
              <select value={r.beanId} onChange={e => set("beanId", e.target.value)} style={{ ...FORM.input, appearance: "none", paddingRight: "22px", cursor: "pointer" }}>
                <option value="">Any bean</option>
                {beans.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <span style={{ position: "absolute", right: "2px", top: "50%", transform: "translateY(-50%)", color: T.faint, pointerEvents: "none", fontSize: "9px" }}>▾</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "16px" }}>
          <FormField label="Dose (g)" value={r.dose} onChange={v => set("dose", v)} placeholder="e.g. 15" />
          <FormField label="Grinder" value={r.grinder} onChange={v => set("grinder", v)} placeholder="e.g. C40" />
          <FormField label="Clicks" value={r.clicks} onChange={v => set("clicks", v)} placeholder="e.g. 24" />
          <FormField label="Water Temp" value={r.waterTemp} onChange={v => set("waterTemp", v)} placeholder="e.g. 93°C" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
          <FormField label="Dripper" value={r.dripper} onChange={v => set("dripper", v)} placeholder="e.g. V60-02" />
          <FormField label="Filter" value={r.filter} onChange={v => set("filter", v)} placeholder="e.g. Cafec Abaca" />
          <FormField label="Total Time" value={r.totalTime} onChange={v => set("totalTime", v)} placeholder="e.g. 2:45" />
        </div>

        {/* Pour schedule editor */}
        <div>
          <div style={{ ...FORM.label, marginBottom: "10px" }}>Pour Schedule</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "70px 80px 1fr 30px", gap: "10px" }}>
              <span style={label(7)}>Time</span>
              <span style={label(7)}>Water (g)</span>
              <span style={label(7)}>Note</span>
              <span />
            </div>
            {r.pours.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 80px 1fr 30px", gap: "10px", alignItems: "center" }}>
                <input value={p.time} onChange={e => setPour(i, "time", e.target.value)} placeholder="0:45" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                <input value={p.water} onChange={e => setPour(i, "water", e.target.value)} placeholder="120g" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                <input value={p.note} onChange={e => setPour(i, "note", e.target.value)} placeholder="Slow center pour" style={{ ...FORM.input, height: "34px", fontSize: "11px" }} />
                <button type="button" onClick={() => removePour(i)} disabled={r.pours.length === 1}
                  style={{ background: "none", border: "none", color: T.faint, cursor: r.pours.length === 1 ? "default" : "pointer", fontSize: "14px", opacity: r.pours.length === 1 ? 0.3 : 1 }}>×</button>
              </div>
            ))}
            <button type="button" onClick={addPour} style={{ ...BTN.ghost, height: "34px", alignSelf: "flex-start" }}>+ Add pour</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
        <button onClick={onCancel} style={BTN.ghost}>Cancel</button>
        <button onClick={() => onSave(r)} disabled={!r.name.trim()} style={{ ...BTN.solid, opacity: r.name.trim() ? 1 : 0.4 }}>Save Recipe</button>
      </div>
    </div>
  )
}

function RecipeView({ recipes, beans, onSave }) {
  const [editing, setEditing] = useState(null) // recipe object or null
  const beanName = id => beans.find(b => b.id === id)?.name || ""

  return (
    <div style={{ paddingTop: "76px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <div style={{ ...label(8), marginBottom: "8px" }}>Recipe</div>
          <h2 style={{ ...serifStyle(32), margin: 0, fontStyle: "italic" }}>Dialed-in recipes</h2>
        </div>
        {!editing && (
          <button onClick={() => setEditing(emptyRecipe())} style={BTN.solid}>+ New recipe</button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {editing ? (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <RecipeForm
              initial={editing}
              beans={beans}
              onCancel={() => setEditing(null)}
              onSave={r => { onSave(r); setEditing(null) }}
            />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {recipes.length === 0 ? (
              <div style={{ border: T.hairline, padding: "48px", textAlign: "center" }}>
                <div style={{ ...label(8, T.ghost) }}>No recipes yet — create your first one</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
                {recipes.map(r => (
                  <div key={r.id} style={{ border: T.hairline, background: T.card, padding: "20px", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                      <div>
                        <div style={{ ...serifStyle(18), fontStyle: "italic", marginBottom: "4px" }}>{r.name}</div>
                        {r.beanId && <div style={{ ...label(7) }}>{beanName(r.beanId)}</div>}
                      </div>
                      <button onClick={() => setEditing(r)} style={{ background: "none", border: T.hairline, padding: "6px 12px", cursor: "pointer", ...MONO, fontSize: "8px", color: T.sub }}>Edit</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 14px", marginBottom: r.pours.length ? "14px" : 0 }}>
                      {[["Dose", r.dose && `${String(r.dose).replace(/g$/, "")}g`], ["Grinder", r.grinder], ["Clicks", r.clicks], ["Temp", r.waterTemp], ["Dripper", r.dripper], ["Filter", r.filter], ["Total", r.totalTime]].filter(([, v]) => v).map(([l, v]) => (
                        <div key={l}>
                          <div style={{ ...label(7), marginBottom: "2px" }}>{l}</div>
                          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: T.ink }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {r.pours.length > 0 && (
                      <div style={{ borderTop: T.hairline, paddingTop: "12px", marginTop: "auto" }}>
                        {r.pours.map((p, i) => (
                          <div key={i} style={{ display: "flex", gap: "12px", marginBottom: "4px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px" }}>
                            <span style={{ color: T.faint, width: "36px" }}>{p.time}</span>
                            <span style={{ color: T.ink, width: "44px" }}>{p.water}</span>
                            <span style={{ color: T.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── ARCHIVE VIEW ─────────────────────────────────────────────────────────────

function BeanArchiveView({ beans }) {
  return (
    <div style={{ paddingTop: "76px" }}>
      <div style={{ ...label(8), marginBottom: "8px" }}>Archive / Beans</div>
      <h2 style={{ ...serifStyle(32), margin: "0 0 28px", fontStyle: "italic" }}>Bean Archive</h2>

      {beans.length === 0 ? (
        <div style={{ border: T.hairline, padding: "48px", textAlign: "center" }}>
          <div style={{ ...label(8, T.ghost) }}>No archived beans yet</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {beans.map((bean, i) => {
            const isBlend = bean.beanType === "blend"
            const title = isBlend ? (bean.blendName || bean.name) : `${bean.origin} · ${bean.name}`
            return (
              <div key={bean.id} style={{ display: "flex", alignItems: "center", gap: "18px", padding: "18px 0", borderBottom: i < beans.length - 1 ? T.hairline : "none" }}>
                <div style={{ width: "44px", height: "56px", flexShrink: 0, backgroundImage: beanArt(bean, i).uri, backgroundSize: "cover", backgroundPosition: "center", border: T.hairline }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...serifStyle(16), fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                  <div style={{ ...label(8), marginTop: "3px" }}>{bean.roaster}{bean.roastPoint ? ` · ${bean.roastPoint}` : ""}</div>
                </div>
                <Stars value={bean.rating || 0} readOnly size={15} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── STATS: DATA ──────────────────────────────────────────────────────────────

/** Coordinates for the coffee belt. Used by the map view. */
const COUNTRY_COORDS = {
  ethiopia: [9.1, 40.5], kenya: [0.0, 37.9], rwanda: [-1.9, 29.9], burundi: [-3.4, 29.9],
  tanzania: [-6.4, 34.9], uganda: [1.4, 32.3], "congo": [-4.0, 21.8], zambia: [-13.1, 27.8],
  malawi: [-13.3, 34.3], yemen: [15.6, 48.5], india: [20.6, 79.0], indonesia: [-2.5, 118.0],
  "papua new guinea": [-6.3, 143.9], vietnam: [14.1, 108.3], thailand: [15.9, 101.0],
  laos: [19.9, 102.5], myanmar: [21.9, 95.9], china: [24.5, 101.0], philippines: [12.9, 121.8],
  timor: [-8.9, 125.7], "east timor": [-8.9, 125.7],
  colombia: [4.6, -74.1], brazil: [-14.2, -51.9], peru: [-9.2, -75.0], ecuador: [-1.8, -78.2],
  bolivia: [-16.3, -63.6], venezuela: [6.4, -66.6],
  panama: [8.5, -80.8], "costa rica": [9.7, -83.8], guatemala: [15.8, -90.2],
  honduras: [15.2, -86.2], "el salvador": [13.8, -88.9], nicaragua: [12.9, -85.2],
  mexico: [23.6, -102.5], jamaica: [18.1, -77.3], "dominican republic": [18.7, -70.2],
  haiti: [19.0, -72.3], cuba: [21.5, -77.8], hawaii: [19.9, -155.6],
}

function coordsFor(country) {
  const k = String(country || "").toLowerCase().trim()
  if (COUNTRY_COORDS[k]) return COUNTRY_COORDS[k]
  const hit = Object.keys(COUNTRY_COORDS).find(c => k.includes(c) || c.includes(k))
  return hit ? COUNTRY_COORDS[hit] : null
}

/**
 * Ethiopian coffee is mostly regional landrace material that gets recorded
 * under dozens of names — JARC selections (74110, 74158, 74112…), "Heirloom",
 * "Wild Forest", local cultivar names. Counting those separately shatters the
 * stats into meaningless singletons, so they roll up to one label. Named
 * varieties that happen to grow in Ethiopia (Gesha, SL28, Bourbon…) are
 * deliberately left alone.
 */
const ETHIOPIAN_LANDRACE = "Ethiopian Landrace"

const NAMED_VARIETIES = [
  "gesha", "geisha", "sl28", "sl34", "sl-28", "sl-34", "bourbon", "typica",
  "caturra", "catuai", "castillo", "pacamara", "maragogipe", "mundo novo",
  "pink bourbon", "java", "sidra", "wush wush", "ruiru", "batian", "k7",
]

function normalizeVariety(v) {
  const raw = String(v || "").trim()
  if (!raw) return ""
  const s = raw.toLowerCase()

  // Leave clearly-named cultivars as they are.
  if (NAMED_VARIETIES.some(n => s.includes(n))) return titleCaseWords(raw)

  // JARC / research selections: bare numbers like 74110, 74158, 74112, 74165.
  if (/^\d{4,6}[a-z]?$/.test(s)) return ETHIOPIAN_LANDRACE
  if (/\b(74\d{3}|75\d{3})\b/.test(s)) return ETHIOPIAN_LANDRACE

  // The usual catch-all names.
  if (/(heirloom|landrace|indigenous|wild forest|forest|local|ethiopian? (variety|varieties|cultivar)|mixed heirloom)/.test(s)) {
    return ETHIOPIAN_LANDRACE
  }

  // Named local Ethiopian cultivars — still landrace material in practice.
  if (/^(kurume|dega|wolisho|serto|bishari|mikicho|sawa)\b/.test(s)) {
    return ETHIOPIAN_LANDRACE
  }

  return titleCaseWords(raw)
}

/** Tally beans by a field, biggest first. */
function tally(beans, pick, normalize = titleCaseWords) {
  const m = new Map()
  beans.forEach(b => {
    const raw = pick(b)
    if (!raw) return
    String(raw).split(/\s*[·,/]\s*/).map(s => s.trim()).filter(Boolean).forEach(key => {
      const label = normalize(key)
      if (!label) return
      const cur = m.get(label) || { label, count: 0, beans: [] }
      cur.count += 1
      cur.beans.push(b)
      m.set(label, cur)
    })
  })
  return [...m.values()].sort((a, b) => b.count - a.count)
}

/** Stable greyscale-to-ink ramp so charts stay monochrome and calm. */
function rampColor(i, total) {
  const t = total <= 1 ? 0 : i / (total - 1)
  return mixHex(INK_BLACK, "#C9C2B6", t * 0.82)
}

// ─── STATS: DONUT ─────────────────────────────────────────────────────────────

function Donut({ data, size = 190, stroke = 7, activeLabel, onHover }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  let offset = 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {data.map((d, i) => {
          const frac = d.count / total
          const len = frac * C
          const dim = activeLabel && activeLabel !== d.label
          const seg = (
            <circle
              key={d.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={rampColor(i, data.length)}
              strokeWidth={activeLabel === d.label ? stroke + 3 : stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`}
              strokeDashoffset={-offset}
              opacity={dim ? 0.25 : 1}
              style={{ transition: "opacity 0.2s, stroke-width 0.2s", cursor: "pointer" }}
              onMouseEnter={() => onHover && onHover(d.label)}
              onMouseLeave={() => onHover && onHover(null)}
            />
          )
          offset += len
          return seg
        })}
      </g>
    </svg>
  )
}

function DonutPanel({ title, data, onOpen }) {
  const [hover, setHover] = useState(null)
  const active = data.find(d => d.label === hover)
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <button
      onClick={onOpen}
      style={{
        border: T.hairline, background: T.card, padding: "26px 22px 22px",
        cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column",
        alignItems: "center", gap: "18px", transition: "border-color 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(13,12,10,0.55)" }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(13,12,10,0.18)" }}
    >
      <div style={{ ...label(8), alignSelf: "flex-start" }}>{title}</div>

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Donut data={data} activeLabel={hover} onHover={setHover} />
        <div style={{ position: "absolute", textAlign: "center", pointerEvents: "none", maxWidth: "120px" }}>
          <div style={{ ...serifStyle(active ? 15 : 30) }}>
            {active ? active.label : data.length}
          </div>
          <div style={{ ...MONO, fontSize: "7px", color: T.faint, marginTop: "4px" }}>
            {active ? `${active.count} of ${total}` : "distinct"}
          </div>
        </div>
      </div>

      <div style={{ ...MONO, fontSize: "7px", color: T.faint, alignSelf: "flex-start" }}>
        View all →
      </div>
    </button>
  )
}

// ─── STATS: WORLD MAP (countries) ─────────────────────────────────────────────

function WorldMap({ data }) {
  const [hover, setHover] = useState(null)
  const W = 900, H = 440
  // Equirectangular, cropped to the coffee belt so the dots aren't lost.
  const LAT0 = 40, LAT1 = -30, LON0 = -120, LON1 = 160
  const px = lon => ((lon - LON0) / (LON1 - LON0)) * W
  const py = lat => ((LAT0 - lat) / (LAT0 - LAT1)) * H

  const pts = data
    .map(d => ({ ...d, c: coordsFor(d.label) }))
    .filter(d => d.c)
  const missing = data.filter(d => !coordsFor(d.label))
  const max = Math.max(...pts.map(p => p.count), 1)

  return (
    <div>
      <div style={{ border: T.hairline, background: T.card, position: "relative", overflow: "hidden" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
          {/* Graticule — the only "map" there is. Keeps it abstract and light. */}
          {[...Array(8)].map((_, i) => (
            <line key={`h${i}`} x1={0} x2={W} y1={(H / 7) * i} y2={(H / 7) * i}
              stroke="rgba(13,12,10,0.1)" strokeWidth="1" />
          ))}
          {[...Array(13)].map((_, i) => (
            <line key={`v${i}`} y1={0} y2={H} x1={(W / 12) * i} x2={(W / 12) * i}
              stroke="rgba(13,12,10,0.1)" strokeWidth="1" />
          ))}
          {/* Equator + tropics: the coffee belt made literal */}
          <line x1={0} x2={W} y1={py(0)} y2={py(0)} stroke="rgba(13,12,10,0.3)" strokeWidth="1" />
          <line x1={0} x2={W} y1={py(23.5)} y2={py(23.5)} stroke="rgba(13,12,10,0.18)" strokeDasharray="3 5" strokeWidth="1" />
          <line x1={0} x2={W} y1={py(-23.5)} y2={py(-23.5)} stroke="rgba(13,12,10,0.18)" strokeDasharray="3 5" strokeWidth="1" />
          <text x={8} y={py(0) - 7} style={{ ...MONO, fontSize: "8px" }} fill={T.faint}>Equator</text>

          {pts.map((p, i) => {
            const x = px(p.c[1]), y = py(p.c[0])
            const rr = 5 + (p.count / max) * 16
            const on = hover === p.label
            return (
              <g key={p.label}
                onMouseEnter={() => setHover(p.label)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}>
                <circle cx={x} cy={y} r={rr + 10} fill="transparent" />
                <circle cx={x} cy={y} r={rr} fill={INK_BLACK} opacity={on ? 0.92 : 0.62}
                  style={{ transition: "opacity 0.2s, r 0.2s" }} />
                <circle cx={x} cy={y} r={rr + 7} fill="none" stroke={INK_BLACK}
                  strokeWidth="1" opacity={on ? 0.5 : 0} style={{ transition: "opacity 0.2s" }} />
                <text x={x} y={y - rr - 9} textAnchor="middle"
                  style={{ ...MONO, fontSize: "8px" }} fill={T.ink} opacity={on ? 1 : 0}>
                  {p.label} · {p.count}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Ranked list beneath, doubles as the legend */}
      <div style={{ marginTop: "22px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0 28px" }}>
        {data.map((d, i) => (
          <div key={d.label}
            onMouseEnter={() => setHover(d.label)}
            onMouseLeave={() => setHover(null)}
            style={{ display: "flex", alignItems: "baseline", gap: "10px", padding: "9px 0", borderBottom: T.hairline, opacity: hover && hover !== d.label ? 0.4 : 1, transition: "opacity 0.2s" }}>
            <span style={{ ...MONO, fontSize: "7px", color: T.faint, width: "18px" }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ ...serifStyle(15), flex: 1 }}>{d.label}</span>
            <span style={{ ...MONO, fontSize: "9px", color: T.sub }}>{d.count}</span>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div style={{ ...MONO, fontSize: "7px", color: T.ghost, marginTop: "16px" }}>
          Not on the map: {missing.map(m => m.label).join(", ")}
        </div>
      )}
    </div>
  )
}

// ─── STATS: RUNNING INDEX (roasteries) ────────────────────────────────────────

function RunningIndex({ data }) {
  const [hover, setHover] = useState(null)
  return (
    <div style={{ border: T.hairline, background: T.card, padding: "40px 34px" }}>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        {data.map((d, i) => (
          <span key={d.label}
            onMouseEnter={() => setHover(d.label)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "default", opacity: hover && hover !== d.label ? 0.28 : 1, transition: "opacity 0.2s" }}>
            <span style={{ ...serifStyle(30), letterSpacing: "-0.01em" }}>
              {d.label}
            </span>
            <sup style={{ ...MONO, fontSize: "9px", color: T.sub, marginLeft: "4px", verticalAlign: "super" }}>
              {String(d.count).padStart(2, "0")}
            </sup>
            {i < data.length - 1 && (
              <span style={{ ...serifStyle(28, T.ghost), margin: "0 12px" }}>/</span>
            )}
          </span>
        ))}
      </p>

      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ marginTop: "32px", paddingTop: "20px", borderTop: T.hairline }}
          >
            <div style={{ ...label(8), marginBottom: "10px" }}>{hover}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {(data.find(d => d.label === hover)?.beans || []).map(b => (
                <span key={b.id} style={{ ...MONO, fontSize: "9px", color: T.sub, border: T.hairline, padding: "5px 10px" }}>
                  {b.origin} · {b.name}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── STATS: MOSAIC (varieties) ────────────────────────────────────────────────

function Mosaic({ data }) {
  const [hover, setHover] = useState(null)
  // One tile per bean, grouped by variety — the shelf as a pixel field.
  const tiles = []
  data.forEach((d, gi) => d.beans.forEach(b => tiles.push({ ...b, group: d.label, gi })))

  return (
    <div>
      <div style={{ border: T.hairline, background: T.card, padding: "28px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))", gap: "3px" }}>
        {tiles.map((t, i) => {
          const dim = hover && hover !== t.group
          return (
            <div
              key={`${t.id}-${i}`}
              onMouseEnter={() => setHover(t.group)}
              onMouseLeave={() => setHover(null)}
              title={`${t.group} · ${t.name}`}
              style={{
                aspectRatio: "1", backgroundImage: beanArt(t, t.gi).uri,
                backgroundSize: "cover", backgroundPosition: "center",
                opacity: dim ? 0.18 : 1, transition: "opacity 0.2s, transform 0.2s",
                transform: hover === t.group ? "scale(1.06)" : "scale(1)",
                cursor: "pointer",
              }}
            />
          )
        })}
      </div>

      <div style={{ marginTop: "22px", display: "flex", flexWrap: "wrap", gap: "0 26px" }}>
        {data.map((d, i) => (
          <div key={d.label}
            onMouseEnter={() => setHover(d.label)}
            onMouseLeave={() => setHover(null)}
            style={{ display: "flex", alignItems: "baseline", gap: "9px", padding: "9px 0", opacity: hover && hover !== d.label ? 0.35 : 1, transition: "opacity 0.2s", cursor: "default" }}>
            <span style={{ ...serifStyle(17) }}>{d.label}</span>
            <span style={{ ...MONO, fontSize: "8px", color: T.faint }}>{String(d.count).padStart(2, "0")}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── STATS VIEW ───────────────────────────────────────────────────────────────

function StatsView({ beans }) {
  const [open, setOpen] = useState(null) // null | 'country' | 'roastery' | 'variety'

  const byCountry = tally(beans.filter(b => b.beanType !== "blend"), b => b.origin)
  const byRoastery = tally(beans, b => b.roaster)
  const byVariety = tally(beans.filter(b => b.beanType !== "blend"), b => b.variety, normalizeVariety)

  const panels = [
    { id: "country", title: "By Origin", data: byCountry },
    { id: "roastery", title: "By Roastery", data: byRoastery },
    { id: "variety", title: "By Variety", data: byVariety },
  ]
  const current = panels.find(p => p.id === open)

  if (beans.length === 0) {
    return (
      <div style={{ paddingTop: "76px" }}>
        <div style={{ ...label(8), marginBottom: "8px" }}>Archive / Stats</div>
        <h2 style={{ ...serifStyle(32), margin: "0 0 28px", fontStyle: "italic" }}>Nothing to count yet</h2>
        <div style={{ border: T.hairline, padding: "48px", textAlign: "center" }}>
          <div style={{ ...label(8, T.ghost) }}>Add a few beans first</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: "76px" }}>
      <div style={{ ...label(8), marginBottom: "8px" }}>Archive / Stats</div>
      <h2 style={{ ...serifStyle(32), margin: "0 0 6px", fontStyle: "italic" }}>
        {beans.length} bean{beans.length === 1 ? "" : "s"}, counted
      </h2>
      <p style={{ ...MONO, fontSize: "8px", color: T.faint, marginBottom: "32px" }}>
        Active and archived together
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
        {panels.map(p => (
          <DonutPanel key={p.id} title={p.title} data={p.data} onOpen={() => setOpen(p.id)} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
            style={{ marginTop: "44px" }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "20px" }}>
              <div>
                <div style={{ ...label(8), marginBottom: "6px" }}>{current.title}</div>
                <h3 style={{ ...serifStyle(24), margin: 0, fontStyle: "italic" }}>
                  {current.id === "country" ? "Where it grew" : current.id === "roastery" ? "Who roasted it" : "What it was"}
                </h3>
              </div>
              <button onClick={() => setOpen(null)} style={{ ...BTN.ghost, height: "32px" }}>Close</button>
            </div>

            {current.id === "country" && <WorldMap data={current.data} />}
            {current.id === "roastery" && <RunningIndex data={current.data} />}
            {current.id === "variety" && <Mosaic data={current.data} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── COFFEE ARCHIVE (brew log) ────────────────────────────────────────────────

function CoffeeArchiveView({ logs, loading, error, beans }) {
  const artFor = beanId => {
    const b = beans.find(x => x.id === beanId)
    return b ? beanArt(b).uri : null
  }

  return (
    <div style={{ paddingTop: "76px" }}>
      <div style={{ ...label(8), marginBottom: "8px" }}>Archive / Coffee</div>
      <h2 style={{ ...serifStyle(32), margin: "0 0 28px", fontStyle: "italic" }}>Every cup, logged</h2>

      {loading ? (
        <div style={{ border: T.hairline, padding: "48px", textAlign: "center" }}>
          <div style={{ ...label(8, T.ghost) }}>Loading brew log…</div>
        </div>
      ) : error ? (
        <div style={{ border: "1px solid rgba(180,60,40,0.35)", background: "rgba(180,60,40,0.06)", padding: "18px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: "#8C3B28", lineHeight: 1.7 }}>
          {error}
        </div>
      ) : logs.length === 0 ? (
        <div style={{ border: T.hairline, padding: "48px", textAlign: "center" }}>
          <div style={{ ...label(8, T.ghost) }}>No brews logged yet</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {logs.map((log, i) => {
            const when = log.brewedAt
              ? new Date(log.brewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : ""
            const art = artFor(log.beanId)
            const specs = [log.dose && `${String(log.dose).replace(/g$/, "")}g`, log.clicks && `${log.clicks} clicks`, log.waterTemp, log.dripper, log.totalTime].filter(Boolean)
            return (
              <div key={log.id || i} style={{ display: "flex", gap: "18px", padding: "20px 0", borderBottom: i < logs.length - 1 ? T.hairline : "none" }}>
                <div style={{ width: "44px", height: "56px", flexShrink: 0, border: T.hairline, backgroundImage: art || "none", backgroundColor: art ? undefined : "rgba(13,12,10,0.07)", backgroundSize: "cover", backgroundPosition: "center" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
                    <div style={{ ...serifStyle(17), fontStyle: "italic" }}>{log.beanName || "Unknown bean"}</div>
                    <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: T.faint, flexShrink: 0 }}>{when}</span>
                  </div>
                  {log.recipeName && <div style={{ ...label(8), marginTop: "5px" }}>{log.recipeName}</div>}
                  {specs.length > 0 && (
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: T.sub, marginTop: "6px" }}>
                      {specs.join(" · ")}
                    </div>
                  )}
                  {log.feedback && (
                    <p style={{ ...serifStyle(14, T.sub), lineHeight: 1.75, marginTop: "8px" }}>{log.feedback}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── PLACEHOLDER ──────────────────────────────────────────────────────────────

function PlaceholderView({ tag, title, desc }) {
  return (
    <div style={{ paddingTop: "76px" }}>
      <div style={{ ...label(8), marginBottom: "8px" }}>{tag}</div>
      <h2 style={{ ...serifStyle(32), margin: "0 0 14px", fontStyle: "italic", maxWidth: "440px" }}>{title}</h2>
      <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: T.faint, lineHeight: 1.8, maxWidth: "340px" }}>{desc}</p>
      <div style={{ marginTop: "44px", borderTop: T.hairline, paddingTop: "36px" }}>
        <div style={{ ...label(8, T.ghost) }}>No entries yet</div>
      </div>
    </div>
  )
}

// ─── ONE-LINE HEADLINE ────────────────────────────────────────────────────────
// Scales the type down until the whole phrase sits on a single row, so long
// and short greetings both read as one deliberate line.

function OneLine({ text, max = 54, min = 20 }) {
  const wrapRef = useRef(null)
  const textRef = useRef(null)
  const [size, setSize] = useState(max)

  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current
      const el = textRef.current
      if (!wrap || !el) return
      let s = max
      el.style.fontSize = `${s}px`
      // Shrink until it fits, or we hit the floor.
      while (el.scrollWidth > wrap.clientWidth && s > min) {
        s -= 1
        el.style.fontSize = `${s}px`
      }
      setSize(s)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [text, max, min])

  return (
    <div ref={wrapRef} style={{ width: "100%", overflow: "hidden" }}>
      <motion.div
        key={text}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <span
          ref={textRef}
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontWeight: 300,
            fontSize: `${size}px`,
            lineHeight: 1.06,
            letterSpacing: "-0.005em",
            color: T.ink,
            whiteSpace: "nowrap",
            display: "inline-block",
          }}
        >
          {text || "\u00a0"}
        </span>
      </motion.div>
    </div>
  )
}

// ─── NAV DRAWER ───────────────────────────────────────────────────────────────

function NavDrawer({ open, setOpen, active, archiveTab, onChange, onArchiveTab }) {
  useEffect(() => {
    const h = e => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [setOpen])

  const go = (view, tab) => {
    onChange(view)
    if (tab) onArchiveTab(tab)
    setOpen(false)
  }

  const line = (label, isActive, onClick, sub = false) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        ...serifStyle(sub ? 20 : 30, isActive ? T.ink : T.faint),
        background: "none", border: "none", padding: "6px 0", cursor: "pointer",
        textAlign: "left", display: "block", width: "100%",
        paddingLeft: sub ? "22px" : 0, transition: "color 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = T.ink }}
      onMouseLeave={e => { e.currentTarget.style.color = isActive ? T.ink : T.faint }}
    >
      {label}
    </button>
  )

  return (
    <>
      {/* Trigger — a single dot, always present, nothing else */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        style={{
          position: "fixed", top: "26px", left: "28px", zIndex: 70,
          width: "34px", height: "34px", borderRadius: "50%",
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        }}
      >
        <motion.span
          animate={{ scale: open ? 0.5 : 1 }}
          transition={{ duration: 0.2 }}
          style={{ width: "11px", height: "11px", borderRadius: "50%", background: T.ink, display: "block" }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(235,233,227,0.8)", backdropFilter: "blur(6px)" }}
            />
            <motion.nav
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              style={{
                position: "fixed", top: 0, left: 0, bottom: 0, width: "280px", zIndex: 91,
                background: T.paper, borderRight: T.hairline,
                padding: "80px 32px 32px", display: "flex", flexDirection: "column",
              }}
            >
              <div style={{ ...label(8), marginBottom: "26px" }}>Menu</div>

              {line("Home", active === "home", () => go("home"))}
              {line("Cafe", active === "cafe", () => go("cafe"))}
              {line("Recipe", active === "recipe", () => go("recipe"))}
              {line("Archive", active === "archive", () => go("archive", "Stats"))}

              <div style={{ marginTop: "4px" }}>
                {["Stats", "Coffee", "Cafe", "Beans"].map(tab =>
                  line(tab, active === "archive" && archiveTab === tab, () => go("archive", tab), true)
                )}
              </div>

              <div style={{ marginTop: "auto", ...MONO, fontSize: "7px", color: T.ghost, lineHeight: 1.9 }}>
                Specialty<br />Coffee<br />Archive
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────

function HomeView({ beans, recipes, onAddBean, onArchive, onEditBean, onLogged, loading }) {
  const [selected, setSelected] = useState(null)
  const [showAddBean, setShowAddBean] = useState(false)
  const [editingBean, setEditingBean] = useState(null)
  const [greeting, setGreeting] = useState("")
  const [today, setToday] = useState("")
  const [now, setNow] = useState("")

  // Set on mount so server and client don't disagree on the date.
  useEffect(() => {
    setGreeting(randomGreeting())

    const stamp = () => {
      const d = new Date()
      setToday(d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
      setNow(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))
    }
    stamp()
    // Tick on the minute rather than every second — nothing here needs seconds.
    const id = setInterval(stamp, 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div style={{ paddingTop: "84px" }}>
        <div style={{ marginBottom: "52px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "14px", marginBottom: "16px" }}>
            <span style={label(9)}>{today || "\u00a0"}</span>
            {now && (
              <>
                <span style={{ ...label(9, T.ghost) }}>—</span>
                <span style={label(9)}>{now}</span>
              </>
            )}
          </div>

          {/* Auto-fitted so any line lands on exactly one row */}
          <OneLine text={greeting} />
        </div>

        {/* Shelf marker */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "20px", paddingBottom: "14px", borderBottom: T.hairline }}>
          <span style={label(8)}>Now Brewing</span>
          <span style={{ ...MONO, fontSize: "8px", color: T.faint }}>{String(beans.length).padStart(2, "0")} on the shelf</span>
        </div>

        {/* Bean grid — everything visible at once */}
        {loading ? (
          <div style={{ border: T.hairline, padding: "64px", textAlign: "center" }}>
            <div style={{ ...label(8, T.ghost) }}>Loading your shelf…</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "18px" }}>
            {beans.map((bean, i) => (
              <BeanCard key={bean.id} bean={bean} index={i} onClick={() => setSelected({ bean, index: i })} />
            ))}
            {/* Add card */}
            <button
              onClick={() => setShowAddBean(true)}
              style={{ minHeight: beans.length === 0 ? "260px" : "auto", background: "transparent", border: "1px dashed rgba(13,12,10,0.3)", color: T.faint, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", ...MONO, fontSize: "8px", transition: "border-color 0.2s, color 0.2s", padding: "40px 0" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(13,12,10,0.55)"; e.currentTarget.style.color = T.ink }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(13,12,10,0.3)"; e.currentTarget.style.color = T.faint }}
            >
              <span style={{ fontSize: "22px", lineHeight: 1, fontWeight: 300 }}>+</span>
              Add Bean
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <BeanDetailModal
            key={selected.bean.id}
            bean={selected.bean}
            index={selected.index}
            recipes={recipes}
            onClose={() => setSelected(null)}
            onArchive={onArchive}
            onEdit={setEditingBean}
            onLogged={onLogged}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAddBean && (
          <AddBeanModal key="add-bean" onClose={() => setShowAddBean(false)} onSave={onAddBean} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editingBean && (
          <AddBeanModal
            key={`edit-${editingBean.id}`}
            existing={editingBean}
            onClose={() => setEditingBean(null)}
            onSave={onEditBean}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [active, setActive] = useState("home")
  const [archiveTab, setArchiveTab] = useState("Stats")
  const [navOpen, setNavOpen] = useState(false)
  const [activeBeans, setActiveBeans] = useState([])
  const [archivedBeans, setArchivedBeans] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [brewLogs, setBrewLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetchAll()
      .then(({ active: a, archived: ar, recipes: rs }) => {
        if (cancelled) return
        setActiveBeans(a)
        setArchivedBeans(ar)
        setRecipes(rs)
      })
      .catch(err => console.error("[load] failed:", err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Brew logs live in their own sheet; fetch them when that tab is opened.
  const loadLogs = () => {
    setLogsLoading(true)
    setLogsError("")
    fetchBrewLogs()
      .then(setBrewLogs)
      .catch(err => {
        console.error("[brewlogs] load failed:", err)
        setLogsError("Couldn't load the brew log. If you recently changed Code.gs, redeploy it as a NEW version.")
      })
      .finally(() => setLogsLoading(false))
  }

  useEffect(() => {
    if (active === "archive" && archiveTab === "Coffee") loadLogs()
  }, [active, archiveTab])

  const handleAddBean = newBean => {
    setActiveBeans(prev => [...prev, newBean])
    postAddBean(newBean).catch(err => {
      console.error("[beans] add failed:", err)
      setActiveBeans(prev => prev.filter(b => b.id !== newBean.id))
    })
  }

  const handleArchiveBean = (bean, rating) => {
    const snapshot = bean
    setActiveBeans(prev => prev.filter(b => b.id !== bean.id))
    setArchivedBeans(prev => [...prev, { ...bean, rating, archivedAt: new Date().toISOString() }])
    postArchiveBean(bean, rating).catch(err => {
      console.error("[beans] archive failed:", err)
      setArchivedBeans(prev => prev.filter(b => b.id !== snapshot.id))
      setActiveBeans(prev => [...prev, snapshot])
    })
  }

  const handleEditBean = updated => {
    const before = activeBeans.find(b => b.id === updated.id)
    setActiveBeans(prev => prev.map(b => b.id === updated.id ? updated : b))
    postUpdateBean(updated, beanToSheetRow(updated).row).catch(err => {
      console.error("[beans] edit failed:", err)
      if (before) setActiveBeans(prev => prev.map(b => b.id === updated.id ? before : b))
      alert("Couldn't save the edit to the spreadsheet.\n\n" + err.message)
    })
  }

  /** Called after a brew is logged, to draw down the bag. */
  const handleLogged = async (bean, nextRemaining) => {
    const before = bean.remaining
    setActiveBeans(prev => prev.map(b => b.id === bean.id ? { ...b, remaining: nextRemaining } : b))
    try {
      await postUpdateBean(bean, { remaining: nextRemaining })
    } catch (err) {
      console.error("[beans] remaining update failed:", err)
      setActiveBeans(prev => prev.map(b => b.id === bean.id ? { ...b, remaining: before } : b))
      throw err
    }
  }

  const handleSaveRecipe = recipe => {
    const before = recipes
    setRecipes(prev => {
      const exists = prev.some(r => r.id === recipe.id)
      return exists ? prev.map(r => r.id === recipe.id ? recipe : r) : [...prev, recipe]
    })
    postUpsertRecipe(recipe).catch(err => {
      console.error("[recipes] save failed:", err)
      setRecipes(before)
      alert(
        "The recipe didn't reach the spreadsheet.\n\n" + err.message +
        "\n\nIf this says \"Unknown action\", your Apps Script is still on the old version — " +
        "paste in the v2 Code.gs and redeploy it as a NEW version."
      )
    })
  }

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.paper}; }
        select option { background: ${T.card}; color: ${T.ink}; }
        ::placeholder { color: rgba(20,18,15,0.28); }
        input, textarea, select { color-scheme: light; }
        input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.4; }
        input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 0.7; }
      `}</style>

      <NavDrawer open={navOpen} setOpen={setNavOpen} active={active} archiveTab={archiveTab} onChange={setActive} onArchiveTab={setArchiveTab} />

      <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "0 clamp(28px, 6vw, 88px) 100px" }}>
        {active === "home" && (
          <HomeView
            beans={activeBeans}
            recipes={recipes}
            onAddBean={handleAddBean}
            onArchive={handleArchiveBean}
            onEditBean={handleEditBean}
            onLogged={handleLogged}
            loading={loading}
          />
        )}
        {active === "cafe" && (
          <PlaceholderView tag="Cafe" title="Coffees from cafes worth remembering." desc="Keep a record of standout cups from cafes — where, what, and how they tasted." />
        )}
        {active === "recipe" && (
          <RecipeView recipes={recipes} beans={activeBeans} onSave={handleSaveRecipe} />
        )}
        {active === "archive" && archiveTab === "Stats" && <StatsView beans={[...activeBeans, ...archivedBeans]} />}
        {active === "archive" && archiveTab === "Beans" && <BeanArchiveView beans={archivedBeans} />}
        {active === "archive" && archiveTab === "Coffee" && (
          <CoffeeArchiveView logs={brewLogs} loading={logsLoading} error={logsError} beans={[...activeBeans, ...archivedBeans]} />
        )}
        {active === "archive" && archiveTab === "Cafe" && (
          <PlaceholderView tag="Archive / Cafe" title="Cafe Log" desc="Standout cups from cafes worth remembering." />
        )}
      </main>
    </div>
  )
}

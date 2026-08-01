"use client"

import { useState, useEffect } from "react"
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

function formatBlendComponentLine(comp) {
  const parts = [comp.country, comp.variety, comp.process].filter(Boolean)
  const ratio = comp.ratio ? `${String(comp.ratio).replace("%", "")}%` : ""
  return [...parts, ratio].filter(Boolean).join(" ")
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

const NOTE_COLOR_MAP = [
  { keys: ["jasmine", "white flower", "chamomile", "elderflower", "honeysuckle"], color: "#EAE6D8" },
  { keys: ["rose", "hibiscus", "floral"], color: "#E8B4C0" },
  { keys: ["lavender", "violet"], color: "#B9A8D0" },
  { keys: ["lemon", "lime", "citric", "yuzu"], color: "#EFD867" },
  { keys: ["orange", "tangerine", "mandarin"], color: "#EE9F4C" },
  { keys: ["grapefruit", "bergamot"], color: "#EE7A5C" },
  { keys: ["blueberry", "blackcurrant", "cassis", "plum"], color: "#5B5B93" },
  { keys: ["raspberry", "strawberry", "cherry", "cranberry", "red fruit", "pomegranate"], color: "#C94F5E" },
  { keys: ["blackberry", "grape", "winey", "wine"], color: "#6E4460" },
  { keys: ["peach", "apricot", "nectarine", "stone fruit"], color: "#F2B48A" },
  { keys: ["apple", "pear", "green grape", "melon"], color: "#B9CB8F" },
  { keys: ["lychee", "tropical", "mango", "pineapple", "passion", "papaya", "guava"], color: "#EFC33F" },
  { keys: ["earl grey", "black tea", "tea"], color: "#9B9083" },
  { keys: ["honey", "caramel", "brown sugar", "maple", "molasses", "toffee", "cane sugar"], color: "#C98F4A" },
  { keys: ["vanilla", "cream", "butter", "malt"], color: "#E4D3B0" },
  { keys: ["chocolate", "cocoa", "cacao", "dark chocolate"], color: "#6B4A38" },
  { keys: ["almond", "hazelnut", "peanut", "nut", "walnut"], color: "#B08D62" },
  { keys: ["cinnamon", "clove", "nutmeg", "spice", "anise", "pepper"], color: "#A65B33" },
  { keys: ["herb", "green", "fresh", "mint", "grass"], color: "#7EA377" },
  { keys: ["smoky", "tobacco", "roasted", "burnt", "ashy"], color: "#5C554E" },
  { keys: ["fermented", "whiskey", "rum", "boozy", "funk"], color: "#8A5A44" },
]

function noteColor(note) {
  const n = String(note).toLowerCase()
  for (const entry of NOTE_COLOR_MAP) {
    if (entry.keys.some(k => n.includes(k))) return entry.color
  }
  return "#C9C2B6"
}

function hexA(hex, alpha) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0")
  return `${hex}${a}`
}

/** Coffee-bag style note color bar. Still used in small UI spots. */
function NoteBar({ notes, height = 6 }) {
  const list = (notes || []).slice(0, 5)
  if (list.length === 0) {
    return <div style={{ height: `${height}px`, background: "rgba(20,18,15,0.07)" }} />
  }
  return (
    <div style={{ display: "flex", height: `${height}px`, overflow: "hidden" }}>
      {list.map((n, i) => (
        <div key={i} title={n} style={{ flex: 1, background: noteColor(n) }} />
      ))}
    </div>
  )
}

// ─── SEEDED GENERATIVE LABEL ART ──────────────────────────────────────────────
// Each bean gets a unique abstract artwork, generated deterministically from
// its id + tasting-note palette. Same bean → same art, every time.
// Three styles: 0 grainy gradient / 1 diagonal bands / 2 watercolor wash.

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

function beanArt(bean) {
  const seed = hashStr(String(bean.id) + String(bean.name || ""))
  const rnd = mulberry32(seed)
  let cols = [...new Set((bean.tastingNotes || []).map(noteColor))]
  if (cols.length === 0) cols = ["#C9C2B6", "#EAE6D8"]
  if (cols.length === 1) cols = [cols[0], mixHex(cols[0], "#FFFFFF", 0.45)]
  const P = cols.slice(0, 4)
  const style = Math.floor(rnd() * 3)
  const W = 420, H = 540
  let inner = ""

  if (style === 0) {
    // Grainy multi-stop gradient (Nordically)
    const ang = Math.floor(rnd() * 360)
    const stops = P.map((c, i) => `<stop offset="${Math.round((i / Math.max(1, P.length - 1)) * 100)}%" stop-color="${c}"/>`).join("")
    inner = `<defs><linearGradient id="lg" gradientTransform="rotate(${ang} 0.5 0.5)">${stops}</linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#lg)"/>` +
      `<circle cx="${rnd() * W}" cy="${rnd() * H}" r="${160 + rnd() * 130}" fill="#ffffff" opacity="0.16" filter="url(#blur)"/>`
  } else if (style === 1) {
    // Bold diagonal bands (TANAT)
    inner = `<rect width="${W}" height="${H}" fill="${P[0]}"/>`
    const n = 3 + Math.floor(rnd() * 2)
    for (let i = 0; i < n; i++) {
      const c = P[(i + 1) % P.length]
      const y = rnd() * H
      const h = 70 + rnd() * 150
      const rot = rnd() * 56 - 28
      inner += `<rect x="-120" y="${y}" width="${W + 240}" height="${h}" fill="${c}" transform="rotate(${rot.toFixed(1)} ${W / 2} ${y.toFixed(1)})"/>`
    }
  } else {
    // Watercolor wash on paper (aery)
    inner = `<rect width="${W}" height="${H}" fill="#F2EFE7"/>`
    const n = 4 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const c = P[i % P.length]
      inner += `<ellipse cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" rx="${(100 + rnd() * 140).toFixed(1)}" ry="${(90 + rnd() * 130).toFixed(1)}" fill="${c}" opacity="${(0.32 + rnd() * 0.3).toFixed(2)}" filter="url(#blur)"/>`
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="48"/></filter></defs>${inner}</svg>`
  return { uri: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, style, palette: P }
}

/** Text color that reads on a given artwork. */
function artInk(art) {
  const avg = art.palette.reduce((s, c) => s + lumOf(c), 0) / art.palette.length
  const adjusted = art.style === 2 ? avg * 0.35 + 0.93 * 0.65 : avg
  return adjusted > 0.6 ? "#17140F" : "#FBFAF7"
}

const GRAIN = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

/**
 * The one place mixed roman/italic type is allowed (ref: "eth·iopia").
 * Split point is seeded so each bean keeps its own rhythm.
 */
function MixedWord({ text, seedKey, style }) {
  const t = String(text || "")
  if (t.length < 4) return <span style={style}>{t}</span>
  const h = hashStr(seedKey || t)
  const cut = 2 + (h % (t.length - 3))
  return (
    <span style={style}>
      {t.slice(0, cut)}
      <span style={{ fontStyle: "italic" }}>{t.slice(cut)}</span>
    </span>
  )
}

/** Soft wash of the top two note colors, used as the card background tint. */
function noteTint(notes) {
  const list = (notes || [])
  if (list.length === 0) return "transparent"
  const c1 = noteColor(list[0])
  const c2 = noteColor(list[1] || list[0])
  return `linear-gradient(150deg, ${hexA(c1, 0.16)} 0%, ${hexA(c2, 0.08)} 45%, transparent 80%)`
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const T = {
  paper: "#EFEDE7",
  card: "#FBFAF7",
  ink: "#14120F",
  sub: "rgba(20,18,15,0.62)",
  faint: "rgba(20,18,15,0.38)",
  ghost: "rgba(20,18,15,0.16)",
  line: "rgba(20,18,15,0.12)",
  hairline: "1px solid rgba(20,18,15,0.12)",
  star: "#C98F4A",
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
          style={{ background: "none", border: "none", cursor: readOnly ? "default" : "pointer", fontSize: `${size}px`, lineHeight: 1, padding: 0, color: n <= (value || 0) ? T.star : T.ghost, transition: "color 0.15s" }}
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
        style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(20,18,15,0.45)", backdropFilter: "blur(6px)" }} />
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
                    <FormField label="Region / Farm" value={regionFarm} onChange={setRegionFarm} placeholder="e.g. Kiambu Windrush AB" />
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
                <div style={{ flex: 1, height: "2px", background: "rgba(20,18,15,0.1)" }}>
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

function BeanDetailModal({ bean, recipes, onClose, onArchive, onEdit, onLogged }) {
  const [showRecord, setShowRecord] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [rating, setRating] = useState(0)
  const isBlend = bean.beanType === "blend"
  const dday = getRoastDDay(bean.roastDate)
  const roasted = new Date(bean.roastDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  useEffect(() => {
    const h = e => e.key === "Escape" && (showRecord ? setShowRecord(false) : onClose())
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [showRecord, onClose])

  const meta = isBlend
    ? [["Roastery", bean.roaster], ["Machine", bean.roasterMachine], ["Roast Point", bean.roastPoint], ["Roast Date", `${roasted} (D+${dday})`]]
    : [["Country", bean.origin], ["Farm", bean.farm], ["Variety", bean.variety], ["Process", bean.process], ["Altitude", bean.altitude], ["Roastery", bean.roaster], ["Machine", bean.roasterMachine], ["Roast Point", bean.roastPoint], ["Roast Date", `${roasted} (D+${dday})`]]

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,18,15,0.45)", backdropFilter: "blur(8px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 101, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", pointerEvents: "none" }}>
        <motion.div
          layoutId={`bean-card-${bean.id}`}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          style={{ width: "100%", maxWidth: "460px", maxHeight: "88vh", overflowY: "auto", background: T.card, border: T.hairline, pointerEvents: "auto", position: "relative", boxSizing: "border-box" }}
        >
          {(() => {
            const art = beanArt(bean)
            const ink = artInk(art)
            const light = ink !== "#17140F"
            const sub = light ? "rgba(251,250,247,0.75)" : "rgba(23,20,15,0.7)"
            return (
              <div style={{ position: "relative", padding: "26px 26px 22px", backgroundImage: art.uri, backgroundSize: "cover", backgroundPosition: "center", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "140px", opacity: 0.14, mixBlendMode: "multiply", pointerEvents: "none" }} />
                <div style={{ position: "absolute", inset: 0, background: light ? "linear-gradient(to top, rgba(10,8,6,0.4), transparent 65%)" : "linear-gradient(to top, rgba(251,250,247,0.45), transparent 65%)", pointerEvents: "none" }} />
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ ...MONO, fontSize: "8px", color: sub, marginBottom: "26px" }}>{isBlend ? "Blend" : `${bean.origin} · ${bean.process}`}</div>
                    <button onClick={onClose} style={{ width: "32px", height: "32px", background: "transparent", border: `1px solid ${light ? "rgba(251,250,247,0.4)" : "rgba(23,20,15,0.3)"}`, color: ink, cursor: "pointer", fontSize: "14px", flexShrink: 0 }}>×</button>
                  </div>
                  <MixedWord
                    text={String(isBlend ? (bean.blendName || bean.name) : bean.name).toLowerCase()}
                    seedKey={bean.id}
                    style={{ ...serifStyle(32, ink), letterSpacing: "-0.01em" }}
                  />
                  {isBlend && (bean.components || []).length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      {(bean.components || []).map((c, i) => (
                        <div key={i} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: sub, marginBottom: "2px" }}>{formatBlendComponentLine(c)}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          <div style={{ padding: "22px 26px 26px" }}>
            {/* Remaining */}
            <div style={{ marginBottom: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "7px" }}>
                <span style={label(8)}>Remaining</span>
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", color: T.ink }}>{bean.remaining}%</span>
              </div>
              <div style={{ height: "2px", background: "rgba(20,18,15,0.08)" }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${bean.remaining}%` }} transition={{ delay: 0.15, duration: 0.8, ease: "easeOut" }} style={{ height: "2px", background: T.ink }} />
              </div>
            </div>

            {/* Meta */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px", paddingTop: "18px", borderTop: T.hairline }}>
              {meta.filter(([, v]) => v).map(([l, v]) => (
                <div key={l}>
                  <div style={{ ...label(7), marginBottom: "4px" }}>{l}</div>
                  <div style={{ ...serifStyle(14, T.ink) }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Notes as chips */}
            {bean.tastingNotes.length > 0 && (
              <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: T.hairline }}>
                <div style={{ ...label(7), marginBottom: "10px" }}>Tasting Notes</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {bean.tastingNotes.map(n => (
                    <span key={n} style={{ display: "flex", alignItems: "center", gap: "7px", border: T.hairline, padding: "4px 10px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: T.sub }}>
                      <span style={{ width: "9px", height: "9px", background: noteColor(n), display: "inline-block" }} />
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {bean.memo && (
              <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: T.hairline }}>
                <div style={{ ...label(7), marginBottom: "8px" }}>Memo</div>
                <p style={{ ...serifStyle(14, T.sub), lineHeight: 1.8, margin: 0 }}>{bean.memo}</p>
              </div>
            )}

            {/* Actions */}
            <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={() => setShowRecord(true)}
                style={{ ...BTN.solid, width: "100%", height: "46px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
              >
                <span style={{ fontSize: "13px", lineHeight: 1 }}>+</span> Log a brew with this bean
              </button>

              <button onClick={() => { onEdit(bean); onClose() }} style={{ ...BTN.ghost, width: "100%" }}>
                Edit bean details
              </button>

              <AnimatePresence mode="wait">
                {!archiving ? (
                  <motion.button
                    key="archive-btn"
                    exit={{ opacity: 0 }}
                    onClick={() => setArchiving(true)}
                    style={{ ...BTN.ghost, width: "100%" }}
                  >Finish & archive this bean</motion.button>
                ) : (
                  <motion.div key="rating" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ border: T.hairline, padding: "18px", textAlign: "center" }}>
                    <div style={{ ...label(8), marginBottom: "12px" }}>How was this bean overall?</div>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
                      <Stars value={rating} onChange={setRating} size={26} />
                    </div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button onClick={() => setArchiving(false)} style={{ ...BTN.ghost, height: "36px" }}>Back</button>
                      <button
                        onClick={() => { onArchive(bean, rating); onClose() }}
                        disabled={rating === 0}
                        style={{ ...BTN.solid, height: "36px", opacity: rating === 0 ? 0.4 : 1 }}
                      >Archive with {rating || "–"}★</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

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

function BeanCard({ bean, onClick }) {
  const [hovered, setHovered] = useState(false)
  const isBlend = bean.beanType === "blend"
  const dday = getRoastDDay(bean.roastDate)
  const art = beanArt(bean)
  const ink = artInk(art)
  const light = ink !== "#17140F"
  const sub = light ? "rgba(251,250,247,0.78)" : "rgba(23,20,15,0.72)"
  const faint = light ? "rgba(251,250,247,0.55)" : "rgba(23,20,15,0.5)"
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
        border: hovered ? "1px solid rgba(20,18,15,0.4)" : T.hairline,
        boxShadow: hovered ? "0 14px 36px rgba(20,18,15,0.14)" : "0 2px 10px rgba(20,18,15,0.05)",
        transition: "border-color 0.2s, box-shadow 0.25s",
      }}
    >
      {/* Film grain */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "140px", opacity: 0.14, mixBlendMode: "multiply", pointerEvents: "none" }} />
      {/* Readability scrim toward the text zone */}
      <div style={{ position: "absolute", inset: 0, background: light
        ? "linear-gradient(to top, rgba(10,8,6,0.42) 0%, rgba(10,8,6,0.08) 45%, transparent 70%)"
        : "linear-gradient(to top, rgba(251,250,247,0.5) 0%, rgba(251,250,247,0.1) 45%, transparent 70%)",
        pointerEvents: "none" }} />

      {/* Top row */}
      <div style={{ position: "absolute", top: "16px", left: "18px", right: "18px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ ...MONO, fontSize: "8px", color: sub }}>{isBlend ? "Blend" : "Single Origin"}</span>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: faint }}>D+{dday}</span>
      </div>

      {/* Text block */}
      <div style={{ position: "absolute", left: "18px", right: "18px", bottom: "34px" }}>
        <div style={{ marginBottom: "8px" }}>
          <MixedWord
            text={String(hero).toLowerCase()}
            seedKey={bean.id}
            style={{ ...serifStyle(34, ink), letterSpacing: "-0.01em", wordBreak: "break-word" }}
          />
        </div>
        {isBlend ? (
          (bean.components || []).slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: sub, marginBottom: "3px" }}>
              {formatBlendComponentLine(c)}
            </div>
          ))
        ) : (
          <>
            {bean.farm && <div style={{ ...serifStyle(15, sub) }}>{bean.farm}</div>}
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: faint, marginTop: "5px", letterSpacing: "0.06em" }}>
              {[bean.variety, bean.process, bean.roastPoint].filter(Boolean).join(" · ")}
            </div>
          </>
        )}
        {bean.tastingNotes.length > 0 && (
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "9px", color: faint, marginTop: "8px", lineHeight: 1.6 }}>
            {bean.tastingNotes.slice(0, 4).join(" / ")}
          </div>
        )}
      </div>

      {/* Remaining line */}
      <div style={{ position: "absolute", left: "18px", right: "18px", bottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ flex: 1, height: "1px", background: light ? "rgba(251,250,247,0.25)" : "rgba(23,20,15,0.18)" }}>
          <div style={{ height: "1px", width: `${bean.remaining}%`, background: ink }} />
        </div>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "8px", color: faint }}>{bean.remaining}%</span>
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
    <div style={{ paddingTop: "40px" }}>
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
    <div style={{ paddingTop: "40px" }}>
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
                <div style={{ width: "44px", height: "56px", flexShrink: 0, backgroundImage: beanArt(bean).uri, backgroundSize: "cover", backgroundPosition: "center", border: T.hairline }} />
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

// ─── COFFEE ARCHIVE (brew log) ────────────────────────────────────────────────

function CoffeeArchiveView({ logs, loading, error, beans }) {
  const artFor = beanId => {
    const b = beans.find(x => x.id === beanId)
    return b ? beanArt(b).uri : null
  }

  return (
    <div style={{ paddingTop: "40px" }}>
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
                <div style={{ width: "44px", height: "56px", flexShrink: 0, border: T.hairline, backgroundImage: art || "none", backgroundColor: art ? undefined : "rgba(20,18,15,0.05)", backgroundSize: "cover", backgroundPosition: "center" }} />
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
    <div style={{ paddingTop: "40px" }}>
      <div style={{ ...label(8), marginBottom: "8px" }}>{tag}</div>
      <h2 style={{ ...serifStyle(32), margin: "0 0 14px", fontStyle: "italic", maxWidth: "440px" }}>{title}</h2>
      <p style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: T.faint, lineHeight: 1.8, maxWidth: "340px" }}>{desc}</p>
      <div style={{ marginTop: "44px", borderTop: T.hairline, paddingTop: "36px" }}>
        <div style={{ ...label(8, T.ghost) }}>No entries yet</div>
      </div>
    </div>
  )
}

// ─── TOP NAV ──────────────────────────────────────────────────────────────────

function TopNav({ active, archiveTab, onChange, onArchiveTab }) {
  const [archiveOpen, setArchiveOpen] = useState(false)

  const navBtn = (id): CSSProperties => ({
    ...MONO, fontSize: "9px",
    color: active === id ? T.ink : T.faint,
    borderBottom: active === id ? `1px solid ${T.ink}` : "1px solid transparent",
    paddingBottom: "4px",
    cursor: "pointer", background: "none", border: "none", borderRadius: 0,
    transition: "color 0.2s",
  })

  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 80, height: "54px", background: "rgba(239,237,231,0.95)", backdropFilter: "blur(12px)", borderBottom: T.hairline, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
        <button onClick={() => onChange("home")} style={navBtn("home")}>Home</button>
        <button onClick={() => onChange("cafe")} style={navBtn("cafe")}>Cafe</button>
        <button onClick={() => onChange("recipe")} style={navBtn("recipe")}>Recipe</button>
        <div style={{ position: "relative" }}
          onMouseEnter={() => setArchiveOpen(true)}
          onMouseLeave={() => setArchiveOpen(false)}
        >
          <button onClick={() => { onChange("archive") }} style={{ ...navBtn("archive"), display: "flex", alignItems: "center", gap: "4px" }}>
            Archive <span style={{ fontSize: "7px", opacity: 0.5 }}>▾</span>
          </button>
          <AnimatePresence>
            {archiveOpen && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}
                style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", paddingTop: "12px" }}>
                <div style={{ background: T.card, border: T.hairline, minWidth: "120px", boxShadow: "0 8px 24px rgba(20,18,15,0.08)" }}>
                  {["Coffee", "Cafe", "Beans"].map((tab, i, arr) => (
                    <button key={tab}
                      onClick={() => { onChange("archive"); onArchiveTab(tab); setArchiveOpen(false) }}
                      style={{ display: "block", width: "100%", textAlign: "center", padding: "11px 16px", ...MONO, fontSize: "8px", color: archiveTab === tab && active === "archive" ? T.ink : T.faint, background: "none", border: "none", borderBottom: i < arr.length - 1 ? T.hairline : "none", cursor: "pointer" }}
                    >{tab}</button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </nav>
  )
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────

function HomeView({ beans, recipes, onAddBean, onArchive, onEditBean, onLogged, loading }) {
  const [selected, setSelected] = useState(null)
  const [showAddBean, setShowAddBean] = useState(false)
  const [editingBean, setEditingBean] = useState(null)
  const [greeting, setGreeting] = useState("Good evening")
  const [today, setToday] = useState("")

  useEffect(() => {
    const now = new Date()
    const h = now.getHours()
    if (h >= 6 && h < 12) setGreeting("Good morning")
    else if (h >= 12 && h < 18) setGreeting("Good afternoon")
    setToday(now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
  }, [])

  return (
    <>
      <div style={{ paddingTop: "36px" }}>
        {/* Tight header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "24px" }}>
          <div>
            <div style={{ ...label(8), marginBottom: "5px" }}>{today || "\u00a0"}</div>
            <h1 style={{ ...serifStyle(24), fontStyle: "italic", margin: 0, color: T.sub }}>{greeting}.</h1>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px" }}>
            <span style={label(8)}>Now Brewing · {beans.length}</span>
          </div>
        </div>

        {/* Bean grid — everything visible at once */}
        {loading ? (
          <div style={{ border: T.hairline, padding: "64px", textAlign: "center" }}>
            <div style={{ ...label(8, T.ghost) }}>Loading your shelf…</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "18px" }}>
            {beans.map(bean => (
              <BeanCard key={bean.id} bean={bean} onClick={() => setSelected(bean)} />
            ))}
            {/* Add card */}
            <button
              onClick={() => setShowAddBean(true)}
              style={{ minHeight: beans.length === 0 ? "260px" : "auto", background: "transparent", border: "1px dashed rgba(20,18,15,0.22)", color: T.faint, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", ...MONO, fontSize: "8px", transition: "border-color 0.2s, color 0.2s", padding: "40px 0" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(20,18,15,0.45)"; e.currentTarget.style.color = T.ink }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(20,18,15,0.22)"; e.currentTarget.style.color = T.faint }}
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
            key={selected.id}
            bean={selected}
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
  const [archiveTab, setArchiveTab] = useState("Beans")
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
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.paper}; }
        select option { background: ${T.card}; color: ${T.ink}; }
        ::placeholder { color: rgba(20,18,15,0.28); }
        input, textarea, select { color-scheme: light; }
        input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.4; }
        input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 0.7; }
      `}</style>

      <TopNav active={active} archiveTab={archiveTab} onChange={setActive} onArchiveTab={setArchiveTab} />

      <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 28px 80px" }}>
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

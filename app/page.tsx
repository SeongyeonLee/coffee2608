"use client"

import { useState, useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import { motion, AnimatePresence } from "framer-motion"

// ─── GOOGLE SHEETS API ────────────────────────────────────────────────────────

const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbzf4cjOSpwNp2DWywWxWYnx76r7-Tp_GvOphUOqz7-Ln0v8qK9fA-f66wOElv-nlkBLeg/exec"

// Sheet tab names — blend and single origin are stored separately.
const SHEET_SINGLE = "SingleOrigin"
const SHEET_BLEND = "Blend"
const SHEET_BREWLOG = "BrewLog"

const isBlendBean = bean => bean?.beanType === "blend"

/**
 * POST to Apps Script.
 * NOTE: Content-Type must stay text/plain. Using application/json would make
 * this a "preflighted" request, and Apps Script web apps cannot answer the
 * OPTIONS preflight — the call would fail with a CORS error. Apps Script reads
 * the raw body via e.postData.contents and JSON.parses it either way.
 */
async function postToSheet(action, payload) {
  const res = await fetch(SHEET_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    redirect: "follow", // /exec 302-redirects to script.googleusercontent.com
    body: JSON.stringify({ action, payload }),
  })
  if (!res.ok) throw new Error(`Sheet API HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Sheet API returned an error")
  return json.data
}

/** Bean object → flat sheet row, routed to the blend or single-origin tab. */
function beanToSheetRow(bean) {
  const base = {
    id: bean.id,
    beanType: bean.beanType,
    name: bean.name,
    roaster: bean.roaster || "",
    roasterMachine: bean.roasterMachine || "",
    roastDate: bean.roastDate || "",
    remaining: bean.remaining ?? 100,
    tastingNotes: (bean.tastingNotes || []).join(", "),
    memo: bean.memo || "",
    archived: false,
    createdAt: new Date().toISOString(),
  }

  if (isBlendBean(bean)) {
    const components = bean.components || []
    return {
      sheet: SHEET_BLEND,
      row: {
        ...base,
        blendName: bean.blendName || bean.name,
        componentCount: components.length,
        // Human-readable for the sheet cell…
        componentsText: components.map(formatBlendComponentLine).join(" / "),
        // …plus the raw structure so it round-trips losslessly.
        componentsJson: JSON.stringify(components),
      },
    }
  }

  return {
    sheet: SHEET_SINGLE,
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

/** Flat sheet row → bean object used by the UI. */
function sheetRowToBean(row) {
  const blend = String(row.beanType || "").toLowerCase() === "blend"

  let components = []
  if (blend && row.componentsJson) {
    try {
      components = JSON.parse(row.componentsJson)
    } catch {
      components = []
    }
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
    origin: blend ? "Blend" : (row.country || ""),
    farm: blend ? "" : (row.farm || ""),
    variety: blend ? "Blend" : (row.variety || ""),
    process: blend ? "Blend" : (row.process || ""),
    altitude: blend ? undefined : (row.altitude || ""),
    blendName: blend ? (row.blendName || row.name) : undefined,
    components: blend ? components : undefined,
    roastDate: row.roastDate || new Date().toISOString().split("T")[0],
    remaining: Number(row.remaining ?? 100),
    tastingNotes: notes,
    memo: row.memo || "",
    archivedAt: row.archivedAt || undefined,
  }
}

/** Read both tabs and split into active / archived. */
async function fetchBeans() {
  const res = await fetch(`${SHEET_API_URL}?action=list`, {
    method: "GET",
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`Sheet API HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || "Sheet API returned an error")

  // Apps Script returns { single: [...], blend: [...] }
  const rows = [...(json.data?.single || []), ...(json.data?.blend || [])]
  const beans = rows.map(sheetRowToBean)

  return {
    active: beans.filter(b => !b.archivedAt),
    archived: beans.filter(b => b.archivedAt),
  }
}

/** Append a bean to the correct tab. */
async function postAddBean(bean) {
  return postToSheet("addBean", beanToSheetRow(bean))
}

/** Flag a bean as archived. Sheet name is passed so Apps Script knows where to look. */
async function postArchiveBean(bean) {
  const id = typeof bean === "string" ? bean : bean.id
  const sheet = typeof bean === "string"
    ? null // unknown type — Apps Script will search both tabs
    : (isBlendBean(bean) ? SHEET_BLEND : SHEET_SINGLE)

  return postToSheet("archiveBean", {
    id,
    sheet,
    archivedAt: new Date().toISOString(),
  })
}

/** Append a brew log entry. Records which bean type it was brewed from. */
async function postBrewLog({ bean, recipe, feedback }) {
  return postToSheet("addBrewLog", {
    sheet: SHEET_BREWLOG,
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
      dose: recipe?.dose || "",
      ratio: recipe?.ratio || "",
      grindSize: recipe?.grindSize || "",
      waterTemp: recipe?.waterTemp || "",
      totalTime: recipe?.totalTime || "",
      feedback: feedback || "",
    },
  })
}

// ─── DATA ─────────────────────────────────────────────────────────────────────

function abbreviateProcess(process) {
  if (!process) return ""
  const key = process.toLowerCase().trim()
  const map = { natural: "N", washed: "W", anaerobic: "AN", honey: "H", "semi-washed": "SW", pulped: "PN" }
  return map[key] || process.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 3)
}

function formatBlendComponentLine(comp) {
  const parts = [comp.country, comp.variety, abbreviateProcess(comp.process)].filter(Boolean)
  const ratio = comp.ratio ? `${String(comp.ratio).replace("%", "")}%` : ""
  return [...parts, ratio].filter(Boolean).join(" ")
}

function getRoastDDay(roastDate) {
  const roast = new Date(roastDate)
  const today = new Date()
  roast.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - roast.getTime()) / (1000 * 60 * 60 * 24)))
}

function RoastDateValue({ roastDate }) {
  const formatted = new Date(roastDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const dday = getRoastDDay(roastDate)
  return (
    <span style={{ fontFamily: "Georgia, serif", fontSize: "13px", color: "rgba(255,255,255,0.72)" }}>
      {formatted}
      <span style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(255,255,255,0.28)", marginLeft: "8px" }}>
        (D+{dday})
      </span>
    </span>
  )
}

const SCA_FLAVOR_WHEEL = [
  { category: "Fruity", notes: ["Blackberry", "Raspberry", "Blueberry", "Strawberry", "Raisin", "Prune", "Coconut", "Cherry", "Pomegranate", "Pineapple", "Grape", "Apple", "Peach", "Pear", "Grapefruit", "Orange", "Lemon", "Lime"] },
  { category: "Floral", notes: ["Chamomile", "Rose", "Jasmine", "Hibiscus", "Lavender"] },
  { category: "Sweet", notes: ["Honey", "Caramel", "Maple Syrup", "Molasses", "Vanilla", "Brown Sugar", "Dark Chocolate"] },
  { category: "Nutty / Cocoa", notes: ["Almond", "Hazelnut", "Peanuts", "Chocolate", "Cocoa"] },
  { category: "Spices", notes: ["Cinnamon", "Clove", "Nutmeg", "Anise", "Pepper", "Pungent"] },
  { category: "Roasted", notes: ["Malt", "Grain", "Smoky", "Ashy", "Tobacco", "Burnt"] },
  { category: "Green / Vegetative", notes: ["Fresh", "Hay-like", "Herb-like", "Peapod", "Green Pepper"] },
  { category: "Sour / Fermented", notes: ["Winey", "Whiskey", "Fermented", "Citric Acid", "Malic Acid"] },
]

const FORM: {
  label: CSSProperties
  input: CSSProperties
  textarea: CSSProperties
} = {
  label: { fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", display: "block", marginBottom: "6px" },
  input: { width: "100%", height: "40px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: 0, fontFamily: "monospace", fontSize: "12px", color: "#fff", outline: "none", boxSizing: "border-box", borderRadius: 0 },
  textarea: { width: "100%", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "10px 0", fontFamily: "Georgia, serif", fontSize: "13px", lineHeight: 1.75, color: "#fff", outline: "none", resize: "none", boxSizing: "border-box", borderRadius: 0 },
}

const recipes = [
  { id: "r1", beanId: "b1", name: "Floral Clarity — Origami", dose: "15 g", ratio: "1:16", grindSize: "7.5", grinder: "Timemore Chestnut C3", dripper: "Origami (cone)", filter: "Cafec Abaca cone", waterTemp: "92°C", totalTime: "2:45", pours: [{ time: "0:00", water: "45 g", note: "Bloom — swirl gently" }, { time: "0:45", water: "120 g", note: "Center pour, slow spiral" }, { time: "1:20", water: "200 g", note: "Pulse pour" }, { time: "1:50", water: "240 g", note: "Final pour, flat bed" }] },
  { id: "r2", beanId: "b2", name: "Balanced Daily — Crystal Eye", dose: "18 g", ratio: "1:15", grindSize: "6.0", grinder: "Timemore Chestnut C3", dripper: "Crystal Eye (cone)", filter: "Timemore cone", waterTemp: "93°C", totalTime: "3:00", pours: [{ time: "0:00", water: "50 g", note: "Bloom 40s" }, { time: "0:40", water: "150 g", note: "First main pour" }, { time: "1:30", water: "270 g", note: "Second pour, gentle" }] },
  { id: "r3", beanId: "b3", name: "Bright & Juicy — V60", dose: "14 g", ratio: "1:16.5", grindSize: "8.0", grinder: "Comandante C40", dripper: "Hario V60", filter: "Hario tabbed", waterTemp: "94°C", totalTime: "2:30", pours: [{ time: "0:00", water: "40 g", note: "Bloom — vigorous swirl" }, { time: "0:40", water: "130 g", note: "Spiral out then in" }, { time: "1:15", water: "231 g", note: "Final, keep bed even" }] },
  { id: "r4", beanId: "b4", name: "Sweet & Complex — Origami", dose: "16 g", ratio: "1:16", grindSize: "7.0", grinder: "Fellow Ode Gen 2", dripper: "Origami (cone)", filter: "Cafec Abaca cone", waterTemp: "91°C", totalTime: "2:55", pours: [{ time: "0:00", water: "48 g", note: "Bloom 45s" }, { time: "0:45", water: "160 g", note: "Slow center pour" }, { time: "1:40", water: "256 g", note: "Finish, level the bed" }] },
]

const beanBg = {
  b1: "linear-gradient(165deg, #1e1408 0%, #2d1e0a 35%, #120e05 100%)",
  b2: "linear-gradient(165deg, #0e1408 0%, #182410 35%, #080e05 100%)",
  b3: "linear-gradient(165deg, #160808 0%, #221008 35%, #0e0505 100%)",
  b4: "linear-gradient(165deg, #080e16 0%, #0e1c28 35%, #050a10 100%)",
}

function getBeanBg(id) {
  return beanBg[id] ?? "linear-gradient(165deg, #141414 0%, #1c1c1c 35%, #0a0a0a 100%)"
}

const NOISE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

// ─── FORM PRIMITIVES ──────────────────────────────────────────────────────────

function FormField({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: "24px" }}>
      <label style={FORM.label}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={FORM.input}
      />
    </div>
  )
}

function TypeToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: "0", marginBottom: "32px", border: "1px solid rgba(255,255,255,0.1)" }}>
      {[{ id: "single", label: "Single Origin" }, { id: "blend", label: "Blend" }].map(opt => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            style={{
              flex: 1,
              height: "40px",
              background: active ? "#fff" : "transparent",
              border: "none",
              borderRight: opt.id === "single" ? "1px solid rgba(255,255,255,0.1)" : "none",
              color: active ? "#000" : "rgba(255,255,255,0.35)",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "8px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function TastingNotesPicker({ selected, onChange }) {
  const [customInput, setCustomInput] = useState("")
  const [openCategory, setOpenCategory] = useState(SCA_FLAVOR_WHEEL[0].category)

  const toggle = note => {
    onChange(selected.includes(note) ? selected.filter(n => n !== note) : [...selected, note])
  }

  const addCustom = () => {
    const trimmed = customInput.trim()
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed])
      setCustomInput("")
    }
  }

  return (
    <div style={{ marginBottom: "8px" }}>
      <span style={FORM.label}>Tasting Notes</span>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
          {selected.map(note => (
            <button
              key={note}
              type="button"
              onClick={() => toggle(note)}
              style={{
                border: "1px solid #fff",
                background: "#fff",
                color: "#000",
                padding: "4px 10px",
                fontFamily: "monospace",
                fontSize: "8px",
                letterSpacing: "0.1em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {note} ×
            </button>
          ))}
        </div>
      )}

      <div style={{ border: "1px solid rgba(255,255,255,0.07)", marginBottom: "16px" }}>
        {SCA_FLAVOR_WHEEL.map(cat => (
          <div key={cat.category} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              type="button"
              onClick={() => setOpenCategory(openCategory === cat.category ? null : cat.category)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: "8px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: openCategory === cat.category ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.28)",
              }}
            >
              {cat.category}
              <span style={{ fontSize: "9px", opacity: 0.4 }}>{openCategory === cat.category ? "−" : "+"}</span>
            </button>
            <AnimatePresence>
              {openCategory === cat.category && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "0 14px 14px" }}>
                    {cat.notes.map(note => {
                      const active = selected.includes(note)
                      return (
                        <button
                          key={note}
                          type="button"
                          onClick={() => toggle(note)}
                          style={{
                            border: `1px solid ${active ? "#fff" : "rgba(255,255,255,0.12)"}`,
                            background: active ? "#fff" : "transparent",
                            color: active ? "#000" : "rgba(255,255,255,0.38)",
                            padding: "4px 10px",
                            fontFamily: "monospace",
                            fontSize: "7px",
                            letterSpacing: "0.08em",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {note}
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom() } }}
          placeholder="Type a custom note, press Enter…"
          style={{ ...FORM.input, flex: 1 }}
        />
        <button
          type="button"
          onClick={addCustom}
          style={{
            height: "40px",
            padding: "0 14px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: "8px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ─── ADD BEAN MODAL ───────────────────────────────────────────────────────────

function AddBeanModal({ onClose, onSave }) {
  const [beanType, setBeanType] = useState("single")
  const [country, setCountry] = useState("")
  const [regionFarm, setRegionFarm] = useState("")
  const [variety, setVariety] = useState("")
  const [process, setProcess] = useState("")
  const [altitude, setAltitude] = useState("")
  const [roastery, setRoastery] = useState("")
  const [roastDate, setRoastDate] = useState("")
  const [blendName, setBlendName] = useState("")
  const [components, setComponents] = useState([{ id: "1", country: "", variety: "", process: "", ratio: "" }])
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [roasterMachine, setRoasterMachine] = useState("")
  const [description, setDescription] = useState("")
  const [tastingNotes, setTastingNotes] = useState([])

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  const addComponent = () => {
    setComponents(prev => [...prev, { id: String(Date.now()), country: "", variety: "", process: "", ratio: "" }])
  }

  const updateComponent = (id, field, val) => {
    setComponents(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c))
  }

  const removeComponent = id => {
    if (components.length > 1) setComponents(prev => prev.filter(c => c.id !== id))
  }

  const handleSave = () => {
    const id = `b${Date.now()}`
    const isBlend = beanType === "blend"
    const normalizedComponents = isBlend
      ? components.map(c => ({ country: c.country, variety: c.variety, process: c.process, ratio: c.ratio }))
      : undefined
    const newBean = {
      id,
      beanType: isBlend ? "blend" : "single",
      name: isBlend ? (blendName || "Untitled Blend") : (regionFarm || `${country} ${variety}`.trim() || "Untitled"),
      roaster: roastery,
      origin: isBlend ? "Blend" : country,
      farm: isBlend ? "" : regionFarm,
      variety: isBlend ? "Blend" : variety,
      process: isBlend ? "Blend" : process,
      roastDate: roastDate || new Date().toISOString().split("T")[0],
      remaining: 100,
      tastingNotes,
      memo: description,
      altitude: isBlend ? undefined : altitude,
      roasterMachine,
      blendName: isBlend ? blendName : undefined,
      components: normalizedComponents,
    }
    onSave(newBean)
    onClose()
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,0.92)", backdropFilter: "blur(16px)" }}
      />

      <div style={{ position: "fixed", inset: 0, zIndex: 151, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", pointerEvents: "none" }}>
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: "520px",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "#0a0a0a",
            border: "1px solid rgba(255,255,255,0.1)",
            pointerEvents: "auto",
            position: "relative",
          }}
        >
          <div style={{ padding: "28px 28px 32px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: "6px" }}>
                  New Entry
                </div>
                <h2 style={{ fontFamily: "Georgia, serif", fontSize: "26px", color: "#fff", margin: 0, fontWeight: 400, fontStyle: "italic" }}>
                  Add Bean
                </h2>
              </div>
              <button onClick={onClose} style={{ width: "36px", height: "36px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
            </div>

            <TypeToggle value={beanType} onChange={setBeanType} />

            <FormField label="Roastery" value={roastery} onChange={setRoastery} placeholder="e.g. Manhattan Coffee" />

            <AnimatePresence mode="wait">
              {beanType === "single" ? (
                <motion.div key="single" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <FormField label="Country" value={country} onChange={setCountry} placeholder="e.g. Ethiopia" />
                  <FormField label="Region / Farm" value={regionFarm} onChange={setRegionFarm} placeholder="e.g. Gesha Village Estate" />
                  <FormField label="Variety" value={variety} onChange={setVariety} placeholder="e.g. Gesha 1931" />
                  <FormField label="Process" value={process} onChange={setProcess} placeholder="e.g. Natural, Washed" />
                  <FormField label="Altitude" value={altitude} onChange={setAltitude} placeholder="e.g. 1,800 masl" />
                  <div style={{ marginBottom: "24px" }}>
                    <label style={FORM.label}>Roasting Date</label>
                    <input type="date" value={roastDate} onChange={e => setRoastDate(e.target.value)} style={{ ...FORM.input, colorScheme: "dark" }} />
                  </div>
                </motion.div>
              ) : (
                <motion.div key="blend" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <FormField label="Blend Name" value={blendName} onChange={setBlendName} placeholder="e.g. House Blend No.3" />
                  <div style={{ marginBottom: "24px" }}>
                    <label style={FORM.label}>Roasting Date</label>
                    <input type="date" value={roastDate} onChange={e => setRoastDate(e.target.value)} style={{ ...FORM.input, colorScheme: "dark" }} />
                  </div>

                  <div style={{ marginBottom: "20px" }}>
                    <span style={FORM.label}>Component Beans</span>
                    {components.map((comp, idx) => (
                      <div key={comp.id} style={{ marginBottom: "14px", padding: "14px", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                            Bean {idx + 1}
                          </span>
                          {components.length > 1 && (
                            <button type="button" onClick={() => removeComponent(comp.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", fontFamily: "monospace", fontSize: "8px" }}>Remove</button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 56px", gap: "10px" }}>
                          <input value={comp.country} onChange={e => updateComponent(comp.id, "country", e.target.value)} placeholder="Country" style={{ ...FORM.input, height: "36px", fontSize: "10px" }} />
                          <input value={comp.variety} onChange={e => updateComponent(comp.id, "variety", e.target.value)} placeholder="Variety" style={{ ...FORM.input, height: "36px", fontSize: "10px" }} />
                          <input value={comp.process} onChange={e => updateComponent(comp.id, "process", e.target.value)} placeholder="Process" style={{ ...FORM.input, height: "36px", fontSize: "10px" }} />
                          <input value={comp.ratio} onChange={e => updateComponent(comp.id, "ratio", e.target.value)} placeholder="%" style={{ ...FORM.input, height: "36px", fontSize: "10px", textAlign: "right" }} />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addComponent}
                      style={{
                        width: "100%",
                        height: "36px",
                        background: "transparent",
                        border: "1px dashed rgba(255,255,255,0.12)",
                        color: "rgba(255,255,255,0.35)",
                        cursor: "pointer",
                        fontFamily: "monospace",
                        fontSize: "8px",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "12px" }}>+</span>
                      Add Component Bean
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <TastingNotesPicker selected={tastingNotes} onChange={setTastingNotes} />

            <div style={{ marginTop: "24px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "4px" }}>
              <button
                type="button"
                onClick={() => setOptionalOpen(p => !p)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 0",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: "8px",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.3)",
                }}
              >
                Optional Details
                <span style={{ fontSize: "10px", opacity: 0.4 }}>{optionalOpen ? "−" : "+"}</span>
              </button>
              <AnimatePresence>
                {optionalOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
                    <FormField label="Roaster Machine" value={roasterMachine} onChange={setRoasterMachine} placeholder="e.g. Loring S35" />
                    <div style={{ marginBottom: "8px" }}>
                      <span style={FORM.label}>Description</span>
                      <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={4}
                        placeholder="Farm notes, brewing impressions, anything worth remembering…"
                        style={FORM.textarea}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "28px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={onClose} style={{ height: "38px", padding: "0 18px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase" }}>Cancel</button>
              <button onClick={handleSave} style={{ height: "38px", padding: "0 22px", background: "#fff", border: "none", color: "#000", cursor: "pointer", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase" }}>Save Log</button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  )
}

// ─── RECORD FORM ──────────────────────────────────────────────────────────────

function RecordForm({ bean, onClose }) {
  const [recipeId, setRecipeId] = useState("")
  const [feedback, setFeedback] = useState("")
  const [saving, setSaving] = useState(false)
  const availableRecipes = recipes.filter(r => r.beanId === bean.id)
  const recipe = availableRecipes.find(r => r.id === recipeId)

  const handleSaveEntry = async () => {
    setSaving(true)
    try {
      await postBrewLog({ bean, recipe, feedback })
    } catch (err) {
      console.error("[brewlog] save failed:", err)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  useEffect(() => {
    const h = e => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  const S: { input: CSSProperties; label: CSSProperties } = {
    input: { width: "100%", height: "40px", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "0 0 0 0", fontFamily: "monospace", fontSize: "12px", color: "#fff", outline: "none", boxSizing: "border-box", borderRadius: 0 },
    label: { fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", display: "block", marginBottom: "6px" },
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "#030303", overflowY: "auto" }}
    >
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "44px 28px 80px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "40px" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: "6px" }}>
              {bean.origin} · {bean.process}
            </div>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "#fff", margin: 0, fontWeight: 400, fontStyle: "italic" }}>
              Log a brew
            </h2>
          </div>
          <button onClick={onClose} style={{ width: "38px", height: "38px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ marginBottom: "28px" }}>
          <span style={S.label}>Bean</span>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "16px", color: "rgba(255,255,255,0.7)", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>{bean.name}</div>
        </div>

        <div style={{ marginBottom: "28px" }}>
          <span style={S.label}>Saved Recipe</span>
          <div style={{ position: "relative" }}>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value)}
              style={{ ...S.input, appearance: "none", paddingRight: "24px", cursor: "pointer" }}>
              <option value="" style={{ background: "#111" }}>Select a recipe…</option>
              {availableRecipes.map(r => <option key={r.id} value={r.id} style={{ background: "#111" }}>{r.name}</option>)}
            </select>
            <span style={{ position: "absolute", right: "2px", top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.2)", pointerEvents: "none", fontSize: "9px" }}>▾</span>
          </div>
        </div>

        <AnimatePresence>
          {recipe && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginBottom: "28px" }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.07)", padding: "18px", marginBottom: "0" }}>
                <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", marginBottom: "14px" }}>✓ Recipe loaded</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px 16px" }}>
                  {[["Dose", recipe.dose], ["Ratio", recipe.ratio], ["Grind", recipe.grindSize], ["Temp", recipe.waterTemp], ["Dripper", recipe.dripper], ["Filter", recipe.filter], ["Grinder", recipe.grinder], ["Total", recipe.totalTime]].map(([l, v]) => (
                    <div key={l}>
                      <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "14px", marginTop: "14px" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: "10px" }}>Pour Schedule</div>
                  {recipe.pours.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: "16px", marginBottom: "6px", fontFamily: "monospace", fontSize: "10px" }}>
                      <span style={{ color: "rgba(255,255,255,0.22)", width: "36px" }}>{p.time}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)", width: "44px" }}>{p.water}</span>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>{p.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ marginBottom: "32px" }}>
          <span style={S.label}>Tasting Memo</span>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={5}
            placeholder="How did it taste today? Aroma, acidity, body, finish…"
            style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "10px 0", fontFamily: "Georgia, serif", fontSize: "13px", lineHeight: 1.75, color: "#fff", outline: "none", resize: "none", boxSizing: "border-box", borderRadius: 0 }} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button onClick={onClose} style={{ height: "36px", padding: "0 18px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase" }}>Cancel</button>
          <button onClick={handleSaveEntry} disabled={saving} style={{ height: "36px", padding: "0 22px", background: "#fff", border: "none", color: "#000", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.5 : 1, fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase" }}>{saving ? "Saving…" : "Save Entry"}</button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── BEAN DETAIL MODAL ────────────────────────────────────────────────────────

function BeanDetailModal({ bean, onClose, onArchive }) {
  const [showRecord, setShowRecord] = useState(false)
  const isBlend = bean.beanType === "blend"

  useEffect(() => {
    const h = e => e.key === "Escape" && (showRecord ? setShowRecord(false) : onClose())
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [showRecord, onClose])

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.9)", backdropFilter: "blur(16px)" }}
      />

      <div style={{ position: "fixed", inset: 0, zIndex: 101, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", pointerEvents: "none" }}>
        <motion.div
          layoutId={`bean-card-${bean.id}`}
          style={{ width: "100%", maxWidth: "420px", maxHeight: "88vh", overflowY: "auto", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", pointerEvents: "auto", position: "relative" }}
          transition={{ type: "spring", stiffness: 280, damping: 30 }}
        >
          {/* Image area */}
          <motion.div layoutId={`bean-img-${bean.id}`} style={{ height: "220px", background: getBeanBg(bean.id), position: "relative", flexShrink: 0, overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, opacity: 0.14, backgroundImage: NOISE, backgroundSize: "128px" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)" }} />
            <motion.div layoutId={`bean-text-${bean.id}`} style={{ position: "absolute", bottom: "20px", left: "22px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: "4px" }}>{bean.origin} · {bean.process}</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: "26px", color: "#fff", lineHeight: 1.1, fontStyle: "italic" }}>{bean.name}</div>
              <div style={{ fontFamily: "monospace", fontSize: "9px", color: "rgba(255,255,255,0.28)", marginTop: "4px", letterSpacing: "0.1em" }}>{bean.roaster}</div>
            </motion.div>
          </motion.div>

          {/* Close */}
          <button onClick={onClose} style={{ position: "absolute", top: "14px", right: "14px", width: "32px", height: "32px", background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", zIndex: 20 }}>×</button>

          {/* Content */}
          <div style={{ padding: "22px 22px 0" }}>
            {/* Remaining */}
            <div style={{ marginBottom: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "7px" }}>
                <span style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)" }}>Remaining</span>
                <span style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>{bean.remaining}%</span>
              </div>
              <div style={{ height: "1px", background: "rgba(255,255,255,0.07)" }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${bean.remaining}%` }} transition={{ delay: 0.2, duration: 0.9, ease: "easeOut" }} style={{ height: "1px", background: "rgba(255,255,255,0.65)" }} />
              </div>
            </div>

            {/* Meta */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px", paddingTop: "18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {isBlend ? (
                <>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "8px" }}>Components</div>
                    {(bean.components || []).map((c, i) => (
                      <div key={i} style={{ fontFamily: "Georgia, serif", fontSize: "13px", color: "rgba(255,255,255,0.55)", marginBottom: "4px" }}>
                        {formatBlendComponentLine(c)}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "4px" }}>Roastery</div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: "13px", color: "rgba(255,255,255,0.72)" }}>{bean.roaster}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "4px" }}>Roast Date</div>
                    <RoastDateValue roastDate={bean.roastDate} />
                  </div>
                </>
              ) : (
                [["Country", bean.origin], ["Farm", bean.farm], ["Variety", bean.variety], ["Process", bean.process], bean.altitude ? ["Altitude", bean.altitude] : null, ["Roast Date", null]].filter(Boolean).map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "4px" }}>{l}</div>
                    {l === "Roast Date" ? (
                      <RoastDateValue roastDate={bean.roastDate} />
                    ) : (
                      <div style={{ fontFamily: "Georgia, serif", fontSize: "13px", color: "rgba(255,255,255,0.72)" }}>{v}</div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Tasting notes */}
            <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "10px" }}>Tasting Notes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {bean.tastingNotes.map(n => (
                  <span key={n} style={{ border: "1px solid rgba(255,255,255,0.1)", padding: "3px 10px", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)" }}>{n}</span>
                ))}
              </div>
            </div>

            {/* Memo */}
            <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)", marginBottom: "8px" }}>Memo</div>
              <p style={{ fontFamily: "Georgia, serif", fontSize: "13px", lineHeight: 1.8, color: "rgba(255,255,255,0.5)", margin: 0 }}>{bean.memo}</p>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: "22px", marginTop: "4px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <button
              onClick={() => { onArchive(bean); onClose() }}
              style={{ width: "100%", height: "40px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.32)", cursor: "pointer", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.32)" }}
            >
              Move to Archive
            </button>
            <button
              onClick={() => setShowRecord(true)}
              style={{ width: "100%", height: "44px", background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.22em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)" }}
            >
              <span style={{ fontSize: "12px", lineHeight: 1 }}>+</span>
              Log a brew with this bean
            </button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {showRecord && <RecordForm bean={bean} onClose={() => setShowRecord(false)} />}
      </AnimatePresence>
    </>
  )
}

// ─── CARD FRONT TEXT ──────────────────────────────────────────────────────────

function CardFrontText({ bean, featured }) {
  const isBlend = bean.beanType === "blend"
  const pos: CSSProperties = { position: "absolute", left: featured ? "22px" : "16px", bottom: featured ? "44px" : "36px", zIndex: 3, right: featured ? "22px" : "16px" }
  const serif = (opacity, size, weight = 300) => ({
    fontFamily: "Georgia, serif",
    fontSize: `${size}px`,
    fontWeight: weight,
    lineHeight: 1.35,
    color: `rgba(255,255,255,${opacity})`,
    letterSpacing: "0.01em",
  })

  if (isBlend) {
    return (
      <motion.div layoutId={`bean-text-${bean.id}`} style={pos}>
        <div style={{ ...serif(0.92, featured ? 19 : 16, 400), marginBottom: "6px" }}>
          {bean.blendName || bean.name}
        </div>
        {(bean.components || []).map((c, i) => (
          <div key={i} style={{ ...serif(0.3, featured ? 10 : 9), marginBottom: "2px" }}>
            {formatBlendComponentLine(c)}
          </div>
        ))}
        <div style={{ ...serif(0.45, featured ? 11 : 10), marginTop: "6px" }}>
          {bean.roaster}
        </div>
      </motion.div>
    )
  }

  const sz = featured ? 14 : 12
  return (
    <motion.div layoutId={`bean-text-${bean.id}`} style={pos}>
      <div style={serif(0.9, sz)}>{bean.origin}</div>
      <div style={serif(0.58, sz)}>{bean.farm}</div>
      <div style={serif(0.4, sz)}>{bean.variety}</div>
      <div style={{ fontFamily: "monospace", fontSize: featured ? "8px" : "7px", fontWeight: 400, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginTop: featured ? "6px" : "5px" }}>
        {bean.process}
      </div>
    </motion.div>
  )
}

// ─── BEAN CARD ────────────────────────────────────────────────────────────────

function BeanCard({ bean, onClick, featured = false }) {
  const [hovered, setHovered] = useState(false)
  const width = featured ? 288 : 196

  return (
    <motion.article
      layoutId={`bean-card-${bean.id}`}
      onClick={onClick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={featured ? { y: -6 } : undefined}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      style={{
        position: "relative",
        width: `${width}px`,
        flexShrink: 0,
        aspectRatio: "2/3",
        cursor: "pointer",
        overflow: "hidden",
        outline: featured
          ? hovered ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.12)"
          : hovered ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(255,255,255,0.05)",
        boxShadow: featured
          ? "0 28px 70px rgba(0,0,0,0.65), 0 12px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      {/* BG */}
      <motion.div layoutId={`bean-img-${bean.id}`} style={{ position: "absolute", inset: 0, background: getBeanBg(bean.id) }} />
      {/* Grain */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.13, backgroundImage: NOISE, backgroundSize: "128px", zIndex: 1, pointerEvents: "none" }} />
      {/* Center glow */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 55% 35% at 50% 28%, rgba(255,255,255,0.04), transparent 70%)", zIndex: 1, pointerEvents: "none" }} />
      {/* Dim gradient */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", zIndex: 2, pointerEvents: "none" }} />

      <CardFrontText bean={bean} featured={featured} />

      {/* Progress bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "1px", background: "rgba(255,255,255,0.06)", zIndex: 4 }}>
        <div style={{ height: "100%", width: `${bean.remaining}%`, background: "rgba(255,255,255,0.55)" }} />
      </div>
      <div style={{ position: "absolute", bottom: "7px", right: "12px", zIndex: 4, fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.14em", color: "rgba(255,255,255,0.22)" }}>{bean.remaining}%</div>
    </motion.article>
  )
}

// ─── ADD BEAN BUTTON ────────────────────────────────────────────────────────────

function AddBeanButton({ onClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        height: "40px",
        padding: "0 26px",
        marginTop: "20px",
        background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"}`,
        color: hovered ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.38)",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "8px",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        transition: "all 0.25s ease",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "18px",
          height: "18px",
          border: `1px solid ${hovered ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.14)"}`,
          fontSize: "12px",
          lineHeight: 1,
          transition: "border-color 0.25s ease",
        }}
      >
        +
      </span>
      Add Bean
    </button>
  )
}

// ─── CINEMATIC CAROUSEL ───────────────────────────────────────────────────────

function BeanGallery({ beans, onSelect, onAddBean, frozen = false }) {
  const [offset, setOffset] = useState(0)
  const [hoverPaused, setHoverPaused] = useState(false)
  const [dragPaused, setDragPaused] = useState(false)
  const intervalRef = useRef(null)
  const draggedRef = useRef(false)
  const CARD_GAP = 16
  const paused = hoverPaused || frozen || dragPaused

  const goNext = () => {
    if (beans.length <= 1) return
    setOffset(prev => (prev + 1) % beans.length)
  }

  const goPrev = () => {
    if (beans.length <= 1) return
    setOffset(prev => (prev - 1 + beans.length) % beans.length)
  }

  const handleDragEnd = (_, info) => {
    setDragPaused(false)
    const SWIPE_OFFSET = 48
    const SWIPE_VELOCITY = 320

    if (info.offset.x <= -SWIPE_OFFSET || info.velocity.x <= -SWIPE_VELOCITY) {
      goNext()
    } else if (info.offset.x >= SWIPE_OFFSET || info.velocity.x >= SWIPE_VELOCITY) {
      goPrev()
    }

    requestAnimationFrame(() => { draggedRef.current = false })
  }

  // Auto-slide: every 3s advance by 1 — paused on hover, drag, or when any modal is open
  useEffect(() => {
    if (paused || beans.length === 0) return
    intervalRef.current = setInterval(() => {
      setOffset(prev => (prev + 1) % beans.length)
    }, 3000)
    return () => clearInterval(intervalRef.current)
  }, [paused, beans.length])

  // We display 3 visible cards centered. Render a tripled array for seamless loop feel
  const visible = beans.length > 0
    ? [0, 1, 2].map(i => beans[(offset + i) % beans.length])
    : []

  return (
    <div
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
    >
      <motion.div
        drag={beans.length > 1 ? "x" : false}
        dragConstraints={{ left: -110, right: 110 }}
        dragElastic={0.38}
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 420, bounceDamping: 32, power: 0.3 }}
        onDragStart={() => {
          draggedRef.current = false
          setDragPaused(true)
        }}
        onDrag={(_, info) => {
          if (Math.abs(info.offset.x) > 6) draggedRef.current = true
        }}
        onDragEnd={handleDragEnd}
        whileDrag={{ cursor: "grabbing" }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: `${CARD_GAP}px`,
          width: "100%",
          perspective: "1400px",
          perspectiveOrigin: "50% 50%",
          cursor: beans.length > 1 ? "grab" : "default",
          touchAction: "pan-y",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <AnimatePresence mode="popLayout">
          {visible.map((bean, idx) => {
            const isCenter = idx === 1
            return (
              <motion.div
                key={`${bean.id}-${offset}-${idx}`}
                initial={{ opacity: 0, x: isCenter ? 0 : 50, rotateY: isCenter ? 0 : idx === 0 ? 28 : -28, z: -60, scale: 0.88 }}
                animate={{
                  opacity: isCenter ? 1 : 0.42,
                  x: 0,
                  rotateY: isCenter ? 0 : idx === 0 ? 22 : -22,
                  z: isCenter ? 48 : -36,
                  scale: isCenter ? 1 : 0.86,
                  filter: isCenter ? "blur(0px)" : "blur(0.6px)",
                }}
                exit={{ opacity: 0, x: isCenter ? 0 : -50, rotateY: isCenter ? 0 : idx === 0 ? -28 : 28, z: -60, scale: 0.88 }}
                transition={{ duration: 0.65, ease: [0.25, 0.46, 0.45, 0.94] }}
                style={{
                  flexShrink: 0,
                  transformStyle: "preserve-3d",
                  zIndex: isCenter ? 10 : 1,
                }}
              >
                <BeanCard
                  bean={bean}
                  featured={isCenter}
                  onClick={() => { if (!draggedRef.current) onSelect(bean) }}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>

      {/* Dot indicators */}
      {beans.length > 0 && (
        <div style={{ display: "flex", gap: "7px", marginTop: "28px" }}>
          {beans.map((_, i) => (
            <button
              key={i}
              onClick={() => setOffset(i)}
              aria-label={`Go to bean ${i + 1}`}
              style={{ width: i === offset ? "20px" : "5px", height: "1px", background: i === offset ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)", border: "none", cursor: "pointer", padding: 0, transition: "all 0.3s ease" }}
            />
          ))}
        </div>
      )}

      <AddBeanButton onClick={onAddBean} />
    </div>
  )
}

// ─── TOP NAV ──────────────────────────────────────────────────────────────────

function TopNav({ active, archiveTab, onChange, onArchiveTab }) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setArchiveOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const navBtn = (id): CSSProperties => ({
    fontFamily: "monospace", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase",
    color: active === id ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
    cursor: "pointer", background: "none", border: "none", padding: "0 2px", transition: "color 0.2s",
  })

  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 80, height: "50px", background: "rgba(3,3,3,0.97)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
        <button onClick={() => onChange("home")} style={navBtn("home")}>Home</button>
        <button onClick={() => onChange("cafe")} style={navBtn("cafe")}>Cafe</button>
        <button onClick={() => onChange("recipe")} style={navBtn("recipe")}>Recipe</button>

        <div ref={ref} style={{ position: "relative" }}>
          <button
            onMouseEnter={() => setArchiveOpen(true)}
            onClick={() => { onChange("archive"); setArchiveOpen(p => !p) }}
            style={{ ...navBtn("archive"), display: "flex", alignItems: "center", gap: "4px" }}
          >
            Archive <span style={{ fontSize: "7px", opacity: 0.4 }}>▾</span>
          </button>
          <AnimatePresence>
            {archiveOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                onMouseLeave={() => setArchiveOpen(false)}
                style={{ position: "absolute", top: "calc(100% + 14px)", left: "50%", transform: "translateX(-50%)", background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.09)", minWidth: "120px", zIndex: 90 }}
              >
                {["Coffee", "Cafe", "Beans"].map((tab, i, arr) => (
                  <button key={tab}
                    onClick={() => { onChange("archive"); onArchiveTab(tab); setArchiveOpen(false) }}
                    style={{ display: "block", width: "100%", textAlign: "center", padding: "11px 14px", fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase", color: archiveTab === tab && active === "archive" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)", background: "none", border: "none", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", cursor: "pointer", transition: "color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.8)"}
                    onMouseLeave={e => e.currentTarget.style.color = archiveTab === tab && active === "archive" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)"}
                  >{tab}</button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </nav>
  )
}

// ─── BEAN ARCHIVE VIEW ────────────────────────────────────────────────────────

function BeanArchiveView({ beans }) {
  if (beans.length === 0) {
    return (
      <div style={{ padding: "80px 0" }}>
        <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.16)", marginBottom: "14px" }}>Archive / Beans</div>
        <h2 style={{ fontFamily: "Georgia, serif", fontSize: "36px", color: "rgba(255,255,255,0.5)", margin: "0 0 14px", fontWeight: 400, fontStyle: "italic", maxWidth: "420px", lineHeight: 1.2 }}>Every bean that passed through.</h2>
        <p style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(255,255,255,0.16)", lineHeight: 1.8, maxWidth: "320px" }}>Archived beans will appear here.</p>
        <div style={{ marginTop: "44px", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "36px" }}>
          <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.08)" }}>No entries yet</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: "60px 0" }}>
      <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.16)", marginBottom: "14px" }}>Archive / Beans</div>
      <h2 style={{ fontFamily: "Georgia, serif", fontSize: "36px", color: "rgba(255,255,255,0.5)", margin: "0 0 32px", fontWeight: 400, fontStyle: "italic" }}>Bean Archive</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {beans.map((bean, i) => {
          const isBlend = bean.beanType === "blend"
          const label = isBlend ? (bean.blendName || bean.name) : `${bean.origin} · ${bean.variety}`
          return (
            <div key={bean.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "18px 0", borderBottom: i < beans.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div>
                <div style={{ fontFamily: "Georgia, serif", fontSize: "16px", color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>{label}</div>
                <div style={{ fontFamily: "monospace", fontSize: "9px", color: "rgba(255,255,255,0.22)", marginTop: "4px", letterSpacing: "0.1em" }}>{bean.roaster}</div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "8px", color: "rgba(255,255,255,0.18)", letterSpacing: "0.12em" }}>
                {bean.remaining}% left
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PLACEHOLDER VIEWS ────────────────────────────────────────────────────────

function PlaceholderView({ label, title, desc }) {
  return (
    <div style={{ padding: "80px 0" }}>
      <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.16)", marginBottom: "14px" }}>{label}</div>
      <h2 style={{ fontFamily: "Georgia, serif", fontSize: "36px", color: "rgba(255,255,255,0.5)", margin: "0 0 14px", fontWeight: 400, fontStyle: "italic", maxWidth: "420px", lineHeight: 1.2 }}>{title}</h2>
      <p style={{ fontFamily: "monospace", fontSize: "10px", color: "rgba(255,255,255,0.16)", lineHeight: 1.8, maxWidth: "320px" }}>{desc}</p>
      <div style={{ marginTop: "44px", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "36px" }}>
        <div style={{ fontFamily: "monospace", fontSize: "7px", letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.08)" }}>No entries yet</div>
      </div>
    </div>
  )
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────

function HomeView({ beans, onAddBean, onArchive, loading = false }) {
  const [selected, setSelected] = useState(null)
  const [showAddBean, setShowAddBean] = useState(false)
  const [greeting, setGreeting] = useState("Good evening")
  const [today, setToday] = useState("")
  const carouselFrozen = !!selected || showAddBean

  useEffect(() => {
    const now = new Date()
    const h = now.getHours()
    if (h >= 6 && h < 12) setGreeting("Good morning")
    else if (h >= 12 && h < 18) setGreeting("Good afternoon")
    setToday(now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
  }, [])

  const handleArchive = bean => {
    onArchive(bean)
    setSelected(null)
  }

  return (
    <>
      <div style={{ paddingTop: "36px", paddingBottom: "0" }}>
        {/* Header — tight spacing */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", marginBottom: "6px" }}>{today || "\u00a0"}</div>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "22px", fontStyle: "italic", fontWeight: 400, color: "rgba(255,255,255,0.55)", margin: "0 0 20px" }}>{greeting}.</h1>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px" }}>
            <div style={{ height: "1px", width: "40px", background: "rgba(255,255,255,0.08)" }} />
            <span style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)" }}>Now Brewing</span>
            <div style={{ height: "1px", width: "40px", background: "rgba(255,255,255,0.08)" }} />
          </div>
        </div>

        {/* Cinematic gallery */}
        <div style={{ position: "relative", paddingBottom: "32px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "100px 0 80px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.32em", textTransform: "uppercase", color: "rgba(255,255,255,0.16)" }}>Loading beans</div>
              <motion.div
                animate={{ opacity: [0.2, 0.55, 0.2] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                style={{ margin: "18px auto 0", width: "24px", height: "1px", background: "rgba(255,255,255,0.4)" }}
              />
            </div>
          ) : (
            <BeanGallery
              beans={beans}
              onSelect={setSelected}
              onAddBean={() => setShowAddBean(true)}
              frozen={carouselFrozen}
            />
          )}
        </div>
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <BeanDetailModal key={selected.id} bean={selected} onClose={() => setSelected(null)} onArchive={handleArchive} />
        )}
      </AnimatePresence>

      {/* Add bean modal */}
      <AnimatePresence>
        {showAddBean && (
          <AddBeanModal
            key="add-bean"
            onClose={() => setShowAddBean(false)}
            onSave={onAddBean}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [active, setActive] = useState("home")
  const [archiveTab, setArchiveTab] = useState("Coffee")
  const [activeBeans, setActiveBeans] = useState([])
  const [archivedBeans, setArchivedBeans] = useState([])
  const [beansLoading, setBeansLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetchBeans()
      .then(({ active: loadedActive, archived: loadedArchived }) => {
        if (cancelled) return
        setActiveBeans(loadedActive)
        setArchivedBeans(loadedArchived)
      })
      .catch(err => {
        console.error("[beans] load failed:", err)
      })
      .finally(() => {
        if (!cancelled) setBeansLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleAddBean = newBean => {
    setActiveBeans(prev => [...prev, newBean])
    postAddBean(newBean).catch(err => {
      console.error("[beans] add failed:", err)
      setActiveBeans(prev => prev.filter(b => b.id !== newBean.id))
    })
  }

  const handleArchiveBean = bean => {
    const snapshot = bean
    setActiveBeans(prev => prev.filter(b => b.id !== bean.id))
    setArchivedBeans(prev => [...prev, { ...bean, archivedAt: new Date().toISOString() }])
    // Pass the whole bean, not just the id, so the API knows which tab to hit.
    postArchiveBean(bean).catch(err => {
      console.error("[beans] archive failed:", err)
      setArchivedBeans(prev => prev.filter(b => b.id !== snapshot.id))
      setActiveBeans(prev => [...prev, snapshot])
    })
  }

  return (
    <div style={{ minHeight: "100vh", background: "#030303", color: "#fff" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #030303; }
        ::-webkit-scrollbar { display: none; }
        select option { background: #111; color: #fff; }
        ::placeholder { color: rgba(255,255,255,0.16); }
        input, textarea, select { color-scheme: dark; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.5); cursor: pointer; opacity: 0.5; }
        input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 0.8; }
      `}</style>

      <TopNav active={active} archiveTab={archiveTab} onChange={setActive} onArchiveTab={setArchiveTab} />

      <main style={{ maxWidth: "860px", margin: "0 auto", padding: "0 28px 80px" }}>
        {active === "home" && (
          <HomeView beans={activeBeans} onAddBean={handleAddBean} onArchive={handleArchiveBean} loading={beansLoading} />
        )}
        {active === "cafe" && <PlaceholderView label="Cafe" title="Coffees from cafes worth remembering." desc="Keep a record of standout cups from cafes — where, what, and how they tasted." />}
        {active === "recipe" && <PlaceholderView label="Recipe" title="Your dialed-in brewing recipes." desc="Save and refine pour-over recipes — dose, ratio, grind, dripper, and pour schedule." />}
        {active === "archive" && archiveTab === "Beans" && <BeanArchiveView beans={archivedBeans} />}
        {active === "archive" && archiveTab !== "Beans" && (
          <PlaceholderView
            label={`Archive / ${archiveTab}`}
            title={archiveTab === "Coffee" ? "Coffee Archive" : "Cafe Log"}
            desc={archiveTab === "Coffee" ? "Every cup you brewed at home, chronologically recorded." : "Standout cups from cafes worth remembering."}
          />
        )}
      </main>
    </div>
  )
}

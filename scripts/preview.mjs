// Draws docs/preview.svg, the animated picture in the README, from the same views the pane uses.
// Run with Node 23.6 or later (it imports crew.ts directly): node scripts/preview.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STRINGS, snapshotOf } from '../hooks/crew.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'preview.svg')

const COLUMNS = 80
const FRAMES = 10 // one turn of the spinner; the body steps every frame
const FRAME_MS = 400
const CELL_W = 9
const CELL_H = 18
const PAD = 16
const TITLE_H = 30

// The terminal theme's names, as a dark theme paints them.
const THEME = {
  claude: '#d97757',
  success: '#4eba65',
  error: '#ff6b80',
  warning: '#ffc107',
  subtle: '#6b7280',
  text: '#e6e6e6',
}

const now = 600_000
const runs = [
  { id: 'r1', type: 'haiku-scout', description: 'scan for TODOs', model: 'claude-haiku-5-5', status: 'done', startedAt: now - 300_000, endedAt: now - 280_000, tools: 6, tokens: 3_100, cached: 41_000 },
  { id: 'r2', type: 'sonnet-light', description: 'write tests for the parser', model: 'claude-sonnet-5-5', status: 'done', startedAt: now - 95_000, endedAt: now - 20_000, tools: 12, tokens: 12_400, cached: 310_000 },
  { id: 'r3', type: 'opus-mid', description: 'refactor the auth middleware', model: 'claude-opus-5-5', status: 'running', startedAt: now - 48_000, tools: 7, lastTool: 'Edit' },
  { id: 'r4', type: 'haiku-scout', description: 'find every login() caller', model: 'claude-haiku-5-5', status: 'running', startedAt: now - 12_000, tools: 4, lastTool: 'Grep' },
  { id: 'r5', type: 'Explore', description: 'map the API routes', model: 'claude-haiku-5-5', status: 'running', startedAt: now - 6_000, tools: 2, lastTool: 'Read' },
]
const residents = ['haiku-scout', 'sonnet-light', 'opus-mid', 'fable-heavy']

// Quadrant blocks as bits: top-left 1, top-right 2, bottom-left 4, bottom-right 8.
const QUADS = { '▘': 1, '▝': 2, '▖': 4, '▗': 8, '▀': 3, '▄': 12, '▌': 5, '▐': 10, '▚': 9, '▞': 6, '▛': 7, '▜': 11, '▙': 13, '▟': 14, '█': 15 }

const BACKGROUND = '#16161a'

// Dim blocks are painted opaque, blended with the background: overlapping halves then leave no seams.
const blend = (hex, alpha) => {
  const channel = (color, i) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16)
  const mixed = [0, 1, 2].map(i => Math.round(channel(hex, i) * alpha + channel(BACKGROUND, i) * (1 - alpha)))
  return `#${mixed.map(n => n.toString(16).padStart(2, '0')).join('')}`
}

const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function drawFrame(lines) {
  const rects = []
  const texts = []
  lines.forEach((pieces, row) => {
    let col = 0
    for (const piece of pieces) {
      const fill = THEME[piece.color] ?? piece.color
      const opacity = piece.isDim ? 0.55 : 1
      const attrs = `fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}`
      const block = `fill="${fill.startsWith('#') && opacity < 1 ? blend(fill, opacity) : fill}"`
      let run = ''
      let runStart = col
      const flush = () => {
        if (run.trim()) {
          const weight = piece.isBold ? ' font-weight="700"' : ''
          texts.push(`<text x="${PAD + runStart * CELL_W}" y="${TITLE_H + PAD + row * CELL_H + 13}" ${attrs}${weight}>${esc(run)}</text>`)
        }
        run = ''
      }
      for (const char of piece.text) {
        const bits = QUADS[char]
        if (bits === undefined) {
          if (!run) runStart = col
          run += char
        } else {
          flush()
          const x = PAD + col * CELL_W
          const y = TITLE_H + PAD + row * CELL_H
          const half = CELL_H / 2
          const halfW = CELL_W / 2
          const quad = (qx, qy) => rects.push(`<rect x="${qx}" y="${qy}" width="${halfW + 0.5}" height="${half + 0.5}" ${block}/>`)
          if (bits & 1) quad(x, y)
          if (bits & 2) quad(x + halfW, y)
          if (bits & 4) quad(x, y + half)
          if (bits & 8) quad(x + halfW, y + half)
        }
        col += 1
      }
      flush()
    }
  })
  return rects.join('') + texts.join('')
}

const frames = Array.from({ length: FRAMES }, (_, tick) => snapshotOf(runs, residents, now, tick, COLUMNS, 5, STRINGS.en))
const rows = Math.max(...frames.map(lines => lines.length))
const width = PAD * 2 + COLUMNS * CELL_W
const height = TITLE_H + PAD * 2 + rows * CELL_H
const cycle = (FRAMES * FRAME_MS) / 1000

const groups = frames
  .map((lines, i) => {
    const delay = i === 0 ? 0 : -(cycle - (i * FRAME_MS) / 1000)
    return `<g class="f" style="animation-delay:${delay.toFixed(1)}s">${drawFrame(lines)}</g>`
  })
  .join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:15px;white-space:pre}
.f{opacity:0;animation:show ${cycle}s step-end infinite}
.f:first-of-type{opacity:1}
@keyframes show{0%{opacity:1}${(100 / FRAMES).toFixed(2)}%{opacity:0}100%{opacity:0}}
</style>
<rect width="${width}" height="${height}" rx="10" fill="${BACKGROUND}"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="#3a3a42"/>
<text x="${PAD}" y="20" fill="${THEME.claude}" font-weight="700">Claudis</text>
<line x1="0" y1="${TITLE_H}" x2="${width}" y2="${TITLE_H}" stroke="#3a3a42"/>
${groups}
</svg>
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, svg)
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(0)} KB, ${FRAMES} frames)`)

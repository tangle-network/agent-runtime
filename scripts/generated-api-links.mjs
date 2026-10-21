// Markdown reflection anchors can reserve suffixes for references that are never rendered.
// Resolve against the headings readers receive; only a unique exact label permits repair.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function proseLines(text) {
  let fence = ''
  return text.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = ''
      return [line, false]
    }
    return [line, !fence]
  })
}

export function generatedApiLinks(write = false) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/api')
  const pages = new Map()
  const plain = (text) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`\\]/g, '')
  for (const name of readdirSync(root).filter((name) => name.endsWith('.md'))) {
    const file = join(root, name), text = readFileSync(file, 'utf8')
    const anchors = new Set(), labels = new Map()
    for (const [line, prose] of proseLines(text)) {
      if (!prose) continue
      const heading = line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)
      if (!heading) continue
      const label = plain(heading[1])
      const slug = label.replace(/<[^>]*>/g, '').toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\s-]/gu, '').replace(/\s/g, '-')
      let anchor = slug, suffix = 0
      while (anchors.has(anchor)) anchor = `${slug}-${++suffix}`
      anchors.add(anchor)
      labels.set(label, labels.has(label) ? null : anchor)
    }
    for (const match of text.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1])
    pages.set(file, { text, anchors, labels })
  }
  let checked = 0, repaired = 0
  const missing = []
  for (const [file, page] of pages) {
    const output = proseLines(page.text).map(([line, prose]) => !prose ? line : line.replace(/\[([^\]\n]+)\]\(([^\s)]*#[^\s)]+)\)/g, (link, label, url) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return link
      const hash = url.indexOf('#'), path = url.slice(0, hash), fragment = url.slice(hash + 1)
      const target = pages.get(path ? resolve(dirname(file), path) : file)
      if (!target) return link
      checked++
      if (target.anchors.has(decodeURIComponent(fragment))) return link
      const anchor = target.labels.get(plain(label))
      if (write && anchor) { repaired++; return `[${label}](${path}#${anchor})` }
      missing.push(`${file.slice(root.length + 1)} → ${url}`)
      return link
    })).join('\n')
    if (write && output !== page.text) writeFileSync(file, output)
  }
  console.log(`API anchors: ${checked} checked, ${repaired} repaired, ${missing.length} unresolved`)
  for (const target of missing) console.warn(`  ${target}`)
  return missing
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generatedApiLinks(process.argv.includes('--write'))
}

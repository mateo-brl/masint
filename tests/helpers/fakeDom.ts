// Document minimal pour jouer hors navigateur les scripts de page de la recherche assistée :
// arbre d'éléments, sélecteurs CSS simples (balise, #id, .classe, [attr], [attr=v], [attr^=v],
// [attr*=v], drapeau `i`, descendance, listes), texte visible, focus et clics enregistrés.

export interface Spec {
  tag: string
  attrs?: Record<string, string>
  /** Texte propre de l'élément (avant celui de ses enfants). */
  text?: string
  children?: Spec[]
  value?: string
  /** Élément masqué (et ses descendants) : pas de boîte, pas de texte visible. */
  hidden?: boolean
}

export interface FakePage {
  document: FakeDocument
  location: { pathname: string; href: string; hostname: string }
  /** Libellés des éléments cliqués, dans l'ordre. */
  clicks: string[]
  /** Exécute un script de page (expression) et renvoie sa valeur. */
  run<T = unknown>(script: string): T
}

interface FakeDocument {
  body: FakeElement
  documentElement: FakeElement
  title: string
  readyState: string
  activeElement: FakeElement | null
  querySelector(sel: string): FakeElement | null
  querySelectorAll(sel: string): FakeElement[]
}

type Attr = { name: string; op: '' | '=' | '^=' | '*=' | '$='; value: string; ci: boolean }
type Compound = { tag: string | null; attrs: Attr[] }

function parseCompound(src: string): Compound {
  const out: Compound = { tag: null, attrs: [] }
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:(\^=|\*=|\$=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(i)?)?\s*\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1]) out.tag = m[1] === '*' ? null : m[1].toUpperCase()
    else if (m[2]) out.attrs.push({ name: 'id', op: '=', value: m[2], ci: false })
    else if (m[3]) out.attrs.push({ name: 'class', op: '*=', value: m[3], ci: false })
    else out.attrs.push({ name: m[4], op: (m[5] ?? '') as Attr['op'], value: m[6] ?? m[7] ?? m[8] ?? '', ci: !!m[9] })
  }
  return out
}

function matchCompound(el: FakeElement, c: Compound): boolean {
  if (c.tag && el.tagName !== c.tag) return false
  return c.attrs.every((a) => {
    const raw = el.getAttribute(a.name)
    if (raw === null) return false
    const v = a.ci ? raw.toLowerCase() : raw
    const w = a.ci ? a.value.toLowerCase() : a.value
    switch (a.op) {
      case '':
        return true
      case '=':
        return v === w
      case '^=':
        return v.startsWith(w)
      case '$=':
        return v.endsWith(w)
      case '*=':
        return v.includes(w)
    }
  })
}

function matches(el: FakeElement, selector: string): boolean {
  return selector
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .some((group) => {
      const parts = group.split(/\s+/).map(parseCompound)
      if (!matchCompound(el, parts[parts.length - 1])) return false
      // Combinateur descendant : chaque partie précédente sur un ancêtre, dans l'ordre.
      let i = parts.length - 2
      let cur = el.parentElement
      while (i >= 0 && cur) {
        if (matchCompound(cur, parts[i])) i--
        cur = cur.parentElement
      }
      return i < 0
    })
}

class FakeElement {
  tagName: string
  attrs: Record<string, string>
  children: FakeElement[] = []
  parentElement: FakeElement | null
  ownText: string
  hiddenSelf: boolean
  private current: string

  constructor(
    spec: Spec,
    parent: FakeElement | null,
    readonly page: { doc: FakeDocument | null; clicks: string[] }
  ) {
    this.tagName = spec.tag.toUpperCase()
    this.attrs = { ...(spec.attrs ?? {}) }
    this.parentElement = parent
    this.ownText = spec.text ?? ''
    this.hiddenSelf = !!spec.hidden
    this.current = spec.value ?? this.attrs.value ?? ''
    this.children = (spec.children ?? []).map((c) => new FakeElement(c, this, page))
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }
  get id(): string {
    return this.attrs.id ?? ''
  }
  get type(): string {
    return (this.attrs.type ?? '').toLowerCase()
  }
  get value(): string {
    return this.current
  }
  set value(v: string) {
    this.current = String(v)
  }
  get hidden(): boolean {
    for (let e: FakeElement | null = this; e; e = e.parentElement) if (e.hiddenSelf) return true
    return false
  }
  get innerText(): string {
    if (this.hidden) return ''
    return [this.ownText, ...this.children.map((c) => c.innerText)].filter(Boolean).join('\n')
  }
  get textContent(): string {
    return [this.ownText, ...this.children.map((c) => c.textContent)].filter(Boolean).join(' ')
  }
  get offsetParent(): object | null {
    return this.hidden ? null : (this.parentElement ?? {})
  }
  getClientRects(): object[] {
    return this.hidden ? [] : [{}]
  }
  get form(): FakeElement | null {
    return this.closest('form')
  }
  focus(): void {
    if (this.page.doc) this.page.doc.activeElement = this
  }
  click(): void {
    this.page.clicks.push((this.innerText || this.value || this.getAttribute('aria-label') || this.tagName).trim())
  }
  dispatchEvent(): boolean {
    return true
  }
  matches(sel: string): boolean {
    return matches(this, sel)
  }
  closest(sel: string): FakeElement | null {
    for (let e: FakeElement | null = this; e; e = e.parentElement) if (e.matches(sel)) return e
    return null
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.descendants()])
  }
  querySelectorAll(sel: string): FakeElement[] {
    return this.descendants().filter((e) => e.matches(sel))
  }
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null
  }
}

/** Page simulée : `body` contient l'arbre donné. */
export function fakePage(body: Spec[], opts: { url: string; title?: string }): FakePage {
  const u = new URL(opts.url)
  const shared: { doc: FakeDocument | null; clicks: string[] } = { doc: null, clicks: [] }
  const root = new FakeElement({ tag: 'html', children: [{ tag: 'body', children: body }] }, null, shared)
  const bodyEl = root.children[0]
  const doc: FakeDocument = {
    body: bodyEl,
    documentElement: root,
    title: opts.title ?? '',
    readyState: 'complete',
    activeElement: bodyEl,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel)
  }
  shared.doc = doc
  const location = { pathname: u.pathname, href: u.href, hostname: u.hostname }
  return {
    document: doc,
    location,
    clicks: shared.clicks,
    run: <T>(script: string): T => new Function('document', 'location', `return ${script}`)(doc, location) as T
  }
}

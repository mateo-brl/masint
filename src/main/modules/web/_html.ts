// Extraction d'informations d'une page HTML sans dépendance (expressions régulières
// tolérantes : attributs dans n'importe quel ordre, guillemets simples ou doubles).

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  euml: 'ë',
  iuml: 'ï',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const clean = (s: string): string => decodeEntities(s).replace(/\s+/g, ' ').trim()

/** Attributs d'une balise ouvrante (`<meta name="x" content="y">`). */
export function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-z_:][-a-z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi
  const body = tag.replace(/^<\s*[a-z0-9-]+/i, '').replace(/\/?>$/, '')
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

export function tags(html: string, name: string): Array<Record<string, string>> {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi')
  return (html.match(re) ?? []).map(attributes)
}

export function title(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? clean(m[1]) || null : null
}

/** Balises meta indexées par `name`, `property` ou `http-equiv` (en minuscules). */
export function metas(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of tags(html, 'meta')) {
    const key = (a.name ?? a.property ?? a['http-equiv'] ?? a.itemprop ?? '').toLowerCase()
    if (key && a.content !== undefined && !(key in out)) out[key] = clean(a.content)
  }
  return out
}

export function htmlLang(html: string): string | null {
  const a = tags(html, 'html')[0]
  return a?.lang || a?.['xml:lang'] || null
}

/** Liens absolus (`href` des balises a / link). */
export function links(html: string, base: string): string[] {
  const out = new Set<string>()
  for (const a of [...tags(html, 'a'), ...tags(html, 'link'), ...tags(html, 'area')]) {
    const href = a.href ? decodeEntities(a.href).trim() : ''
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue
    if (/^(mailto|tel|callto|sms):/i.test(href)) {
      out.add(href)
      continue
    }
    try {
      out.add(new URL(href, base).toString())
    } catch {
      /* lien invalide ignoré */
    }
  }
  return Array.from(out)
}

/** Texte visible : sans scripts, styles ni balises. */
export function visibleText(html: string): string {
  return clean(
    html
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi
const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|woff2?|ttf|eot|mp4|webm|pdf)$/i
// Clés techniques ressemblant à des emails (DSN Sentry, CDN...).
const NOISE = /@([a-z0-9.-]+\.)?(sentry\.io|wixpress\.com|sentry-next\.wixpress\.com)$/i
const PLACEHOLDER = /^(you|your|name|nom|user|username|email|e-mail|exemple|example|test|john|jane|prenom|firstname)(\.[a-z]+)?@|@(example|exemple|domain|domaine|email|test|sentry|sentry-next|wixpress)\./i

/** Emails cités dans la page (liens mailto et texte), sans les faux positifs courants. */
export function emails(html: string): string[] {
  const found = new Set<string>()
  const candidates = [
    ...(decodeEntities(html.replace(/%40/g, '@')).match(EMAIL_RE) ?? []),
    ...links(html, 'https://x.invalid/')
      .filter((l) => /^mailto:/i.test(l))
      .map((l) => decodeURIComponent(l.slice(7).split('?')[0]))
  ]
  for (const raw of candidates) {
    const e = raw.toLowerCase().replace(/^[.%+-]+/, '')
    if (NOT_EMAIL_TLD.test(e) || PLACEHOLDER.test(e) || NOISE.test(e) || /@\d+x\b/.test(e) || /^[0-9a-f]{24,}@/.test(e)) continue
    found.add(e)
  }
  return Array.from(found)
}

// Plateformes sociales reconnues dans les liens : identifiant extrait du chemin.
interface SocialRule {
  platform: string
  host: RegExp
  path: RegExp
  /** Chemins réservés (pages génériques, partage, connexion...). */
  reserved?: RegExp
}

const RESERVED = /^(share|sharer|sharer\.php|intent|home|login|signup|privacy|policy|legal|about|help|terms|search|hashtag|explore|watch|embed|plugins|dialog|tr|events|groups|pages|business|ads|settings|i|p|reel|stories|status|v|tos|cookie|cookies|developers|jobs|careers|download|feed|results|channel)$/i

const SOCIAL: SocialRule[] = [
  { platform: 'facebook', host: /(^|\.)facebook\.com$|(^|\.)fb\.com$/, path: /^\/(?:pg\/)?([A-Za-z0-9.\-_]{2,})\/?/ },
  { platform: 'instagram', host: /(^|\.)instagram\.com$/, path: /^\/([A-Za-z0-9._]{2,30})\/?/ },
  { platform: 'x', host: /(^|\.)(twitter|x)\.com$/, path: /^\/([A-Za-z0-9_]{1,15})\/?$/ },
  { platform: 'linkedin', host: /(^|\.)linkedin\.com$/, path: /^\/((?:in|company|school|showcase)\/[^/?#]+)\/?/ },
  { platform: 'youtube', host: /(^|\.)youtube\.com$/, path: /^\/(@[^/?#]+|(?:channel|c|user)\/[^/?#]+)\/?/ },
  { platform: 'tiktok', host: /(^|\.)tiktok\.com$/, path: /^\/@([A-Za-z0-9._]{2,24})\/?/ },
  { platform: 'github', host: /^github\.com$/, path: /^\/([A-Za-z0-9-]{1,39})\/?$/ },
  { platform: 'gitlab', host: /^gitlab\.com$/, path: /^\/([A-Za-z0-9_.-]{2,})\/?$/ },
  { platform: 'telegram', host: /^(t\.me|telegram\.me)$/, path: /^\/([A-Za-z0-9_]{4,32})\/?$/ },
  { platform: 'pinterest', host: /(^|\.)pinterest\.[a-z.]+$/, path: /^\/([A-Za-z0-9_]{3,30})\/?$/ },
  { platform: 'twitch', host: /(^|\.)twitch\.tv$/, path: /^\/([A-Za-z0-9_]{3,25})\/?$/ },
  { platform: 'vimeo', host: /^vimeo\.com$/, path: /^\/([A-Za-z][A-Za-z0-9_]{2,})\/?$/ },
  { platform: 'medium', host: /^medium\.com$/, path: /^\/@([A-Za-z0-9._-]+)\/?/ },
  { platform: 'reddit', host: /(^|\.)reddit\.com$/, path: /^\/((?:u|user|r)\/[A-Za-z0-9_-]+)\/?/ },
  { platform: 'threads', host: /(^|\.)threads\.(net|com)$/, path: /^\/@([A-Za-z0-9._]+)\/?/ },
  { platform: 'bluesky', host: /^bsky\.app$/, path: /^\/profile\/([^/?#]+)\/?/ },
  { platform: 'snapchat', host: /(^|\.)snapchat\.com$/, path: /^\/add\/([A-Za-z0-9._-]{3,15})\/?/ },
  { platform: 'whatsapp', host: /^(wa\.me|api\.whatsapp\.com)$/, path: /^\/(\d{6,15})\/?/ },
  { platform: 'discord', host: /^(discord\.gg|discord\.com)$/, path: /^\/(?:invite\/)?([A-Za-z0-9-]{2,})\/?$/ },
  { platform: 'vk', host: /^(vk\.com|vkontakte\.ru)$/, path: /^\/([A-Za-z0-9_.]{2,})\/?$/ },
  { platform: 'dailymotion', host: /(^|\.)dailymotion\.com$/, path: /^\/([A-Za-z0-9_-]{3,})\/?$/ },
  { platform: 'soundcloud', host: /^soundcloud\.com$/, path: /^\/([A-Za-z0-9_-]{3,})\/?$/ },
  { platform: 'patreon', host: /(^|\.)patreon\.com$/, path: /^\/([A-Za-z0-9_-]{3,})\/?$/ },
  { platform: 'linktree', host: /^linktr\.ee$/, path: /^\/([A-Za-z0-9_.]{2,})\/?$/ },
  { platform: 'tripadvisor', host: /(^|\.)tripadvisor\.[a-z.]+$/, path: /^\/(Profile\/[^/?#]+)/ },
  { platform: 'trustpilot', host: /(^|\.)trustpilot\.com$/, path: /^\/review\/([^/?#]+)/ },
  { platform: 'mastodon', host: /^(mastodon\.[a-z.]+|mstdn\.[a-z.]+|[a-z0-9.-]+\.social)$/, path: /^\/@([A-Za-z0-9_]+)\/?$/ }
]

export interface SocialLink {
  platform: string
  username: string
  url: string
}

export function socialLink(href: string): SocialLink | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|fr|en|business)\./, '')
  for (const r of SOCIAL) {
    if (!r.host.test(host)) continue
    const m = u.pathname.match(r.path)
    if (!m) return null
    const username = decodeURIComponent(m[1])
    const first = username.split('/')[0].replace(/^@/, '')
    if (RESERVED.test(first) || (r.platform === 'facebook' && /\.php$/.test(first))) return null
    if (r.platform === 'mastodon') return { platform: r.platform, username: `@${username}@${host}`, url: `https://${host}/@${username}` }
    return { platform: r.platform, username, url: `https://${u.hostname}${u.pathname.replace(/\/$/, '')}` }
  }
  return null
}

export interface Tracker {
  id: string
  kind: string
}

const TRACKERS: Array<{ kind: string; re: RegExp; needs?: RegExp }> = [
  { kind: 'Google Analytics (UA)', re: /\b(UA-\d{4,10}-\d{1,4})\b/g },
  { kind: 'Google Analytics 4', re: /['"=?&/](G-[A-Z0-9]{8,12})\b/g, needs: /googletagmanager|gtag\(|google-analytics/ },
  { kind: 'Google Tag Manager', re: /\b(GTM-[A-Z0-9]{4,9})\b/g },
  { kind: 'Google Ads', re: /\b(AW-\d{9,11})\b/g },
  { kind: 'Google AdSense', re: /\b(ca-pub-\d{10,20})\b/g },
  { kind: 'Google AdSense', re: /[?&]client=(ca-pub-\d{10,20})/g },
  { kind: 'Facebook Pixel', re: /fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{10,20})/g },
  { kind: 'Facebook Pixel', re: /facebook\.com\/tr\/?\?id=(\d{10,20})/g },
  { kind: 'Yandex Metrica', re: /\bym\(\s*(\d{5,10})\s*,\s*['"]init['"]/g },
  { kind: 'Yandex Metrica', re: /mc\.yandex\.ru\/watch\/(\d{5,10})/g },
  { kind: 'Hotjar', re: /\bhjid\s*:\s*(\d{5,10})/g },
  { kind: 'Hotjar', re: /static\.hotjar\.com\/c\/hotjar-(\d{5,10})\.js/g },
  { kind: 'Microsoft Clarity', re: /clarity\.ms\/tag\/([a-z0-9]{8,12})/g },
  { kind: 'Microsoft Clarity', re: /["']clarity["']\s*,\s*["']script["']\s*,\s*["']([a-z0-9]{8,12})["']/g },
  { kind: 'TikTok Pixel', re: /ttq\.load\(\s*['"]([A-Z0-9]{15,25})['"]/g },
  { kind: 'LinkedIn Insight', re: /_linkedin_partner_id\s*=\s*["']?(\d{4,10})/g },
  { kind: 'Pinterest Tag', re: /pintrk\(\s*['"]load['"]\s*,\s*['"](\d{10,16})['"]/g },
  { kind: 'Snap Pixel', re: /snaptr\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]{36})['"]/g },
  { kind: 'Matomo', re: /setSiteId['"]\s*,\s*['"]?(\d{1,6})['"]?\s*\]/g },
  { kind: 'Amazon Associates', re: /[?&]tag=([a-z0-9-]{3,30}-2[01])\b/g }
]

export function trackers(html: string): Tracker[] {
  const found = new Map<string, Tracker>()
  for (const t of TRACKERS) {
    if (t.needs && !t.needs.test(html)) continue
    for (const m of html.matchAll(t.re)) {
      let id = m[1]
      // L'identifiant Matomo seul n'a pas de sens sans le serveur qui l'héberge.
      if (t.kind === 'Matomo') {
        const server = html.match(/(?:u|matomoUrl|piwikUrl)\s*=\s*["'](?:https?:)?\/\/([^/"']+)/)
        if (!server) continue
        id = `${server[1]}#${id}`
      }
      if (!found.has(id)) found.set(id, { id, kind: t.kind })
    }
  }
  return Array.from(found.values())
}

export interface Technology {
  name: string
  version?: string
  kind?: string
}

const HTML_TECH: Array<{ name: string; re: RegExp; kind?: string; version?: RegExp }> = [
  { name: 'WordPress', re: /\/wp-(content|includes)\//, kind: 'CMS' },
  { name: 'WooCommerce', re: /\/plugins\/woocommerce\/|woocommerce-(?:page|no-js|layout)|wc-block-/, kind: 'E-commerce' },
  { name: 'Elementor', re: /\/plugins\/elementor\/|elementor-(?:kit|section|widget|element)-/, kind: 'Page builder' },
  { name: 'Divi', re: /et_pb_|\/Divi\//, kind: 'Page builder' },
  { name: 'Shopify', re: /cdn\.shopify\.com|Shopify\.theme/, kind: 'E-commerce' },
  { name: 'Wix', re: /static\.wixstatic\.com|wix-warmup-data|_wixCssImports/, kind: 'CMS' },
  { name: 'Squarespace', re: /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/, kind: 'CMS' },
  { name: 'Webflow', re: /data-wf-site|webflow\.js|assets\.website-files\.com/, kind: 'CMS' },
  { name: 'Joomla', re: /\/media\/jui\/|\/components\/com_|Joomla!/, kind: 'CMS' },
  { name: 'Drupal', re: /Drupal\.settings|\/sites\/default\/files\/|drupal-settings-json/, kind: 'CMS' },
  { name: 'PrestaShop', re: /var prestashop\b|content="PrestaShop|\/modules\/ps_[a-z]+\//, kind: 'E-commerce' },
  { name: 'Magento', re: /Mage\.Cookies|\/static\/version\d+\/frontend\/|mage\/cookies/, kind: 'E-commerce' },
  { name: 'Ghost', re: /ghost-(?:portal|sdk)|content="Ghost/, kind: 'CMS' },
  { name: 'Jimdo', re: /jimdo(?:cdn)?\.com/, kind: 'CMS' },
  { name: 'Weebly', re: /editmysite\.com|weebly\.com/, kind: 'CMS' },
  { name: 'Blogger', re: /blogger\.com\/static|\.blogspot\.com/, kind: 'CMS' },
  { name: 'Next.js', re: /__NEXT_DATA__|\/_next\/static\//, kind: 'Framework' },
  { name: 'Nuxt', re: /__NUXT__|\/_nuxt\//, kind: 'Framework' },
  { name: 'Gatsby', re: /___gatsby/, kind: 'Framework' },
  { name: 'Angular', re: /ng-version=/, kind: 'Framework', version: /ng-version="([\d.]+)"/ },
  { name: 'React', re: /data-reactroot|react-dom(?:\.production)?(?:\.min)?\.js/, kind: 'Framework' },
  { name: 'Vue.js', re: /data-v-[a-f0-9]{8}|vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js/, kind: 'Framework' },
  { name: 'Svelte', re: /svelte-[a-z0-9]{6}/, kind: 'Framework' },
  { name: 'jQuery', re: /jquery(?:[.-]\d[\d.]*)?(?:\.min)?\.js/i, kind: 'Library', version: /jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/i },
  { name: 'Bootstrap', re: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)/i, kind: 'Library' },
  { name: 'Tailwind CSS', re: /cdn\.tailwindcss\.com|tailwindcss@|--tw-[a-z]/, kind: 'Library' },
  { name: 'Font Awesome', re: /font-?awesome/i, kind: 'Library' },
  { name: 'Google Fonts', re: /fonts\.googleapis\.com/, kind: 'Fonts' },
  { name: 'Adobe Fonts', re: /use\.typekit\.net/, kind: 'Fonts' },
  { name: 'Google reCAPTCHA', re: /google\.com\/recaptcha|recaptcha\/api\.js/, kind: 'Security' },
  { name: 'hCaptcha', re: /hcaptcha\.com\/1\/api\.js/, kind: 'Security' },
  { name: 'Cloudflare Turnstile', re: /challenges\.cloudflare\.com\/turnstile/, kind: 'Security' },
  { name: 'Stripe', re: /js\.stripe\.com/, kind: 'Payment' },
  { name: 'PayPal', re: /paypal\.com\/sdk\/js|paypalobjects\.com/, kind: 'Payment' },
  { name: 'Intercom', re: /widget\.intercom\.io|intercomSettings/, kind: 'Chat' },
  { name: 'Crisp', re: /client\.crisp\.chat/, kind: 'Chat' },
  { name: 'Zendesk', re: /static\.zdassets\.com|zopim/, kind: 'Chat' },
  { name: 'Tawk.to', re: /embed\.tawk\.to/, kind: 'Chat' },
  { name: 'HubSpot', re: /js\.hs-scripts\.com|js\.hsforms\.net/, kind: 'Marketing' },
  { name: 'Mailchimp', re: /list-manage\.com|chimpstatic\.com/, kind: 'Marketing' },
  { name: 'Brevo', re: /sibforms\.com|sendinblue/i, kind: 'Marketing' },
  { name: 'Axeptio', re: /axept\.io|axeptioSettings/, kind: 'Cookie consent' },
  { name: 'Didomi', re: /sdk\.privacy-center\.org|didomiConfig/, kind: 'Cookie consent' },
  { name: 'OneTrust', re: /cdn\.cookielaw\.org|optanon/i, kind: 'Cookie consent' },
  { name: 'Cookiebot', re: /consent\.cookiebot\.com/, kind: 'Cookie consent' },
  { name: 'tarteaucitron', re: /tarteaucitron/, kind: 'Cookie consent' },
  { name: 'Matomo', re: /matomo\.js|piwik\.js/, kind: 'Analytics' },
  { name: 'Plausible', re: /plausible\.io\/js/, kind: 'Analytics' },
  { name: 'Cloudflare Web Analytics', re: /static\.cloudflareinsights\.com/, kind: 'Analytics' },
  { name: 'Cloudflare Rocket Loader', re: /rocket-loader/, kind: 'CDN' },
  { name: 'jsDelivr', re: /cdn\.jsdelivr\.net/, kind: 'CDN' },
  { name: 'cdnjs', re: /cdnjs\.cloudflare\.com/, kind: 'CDN' },
  { name: 'Google Maps', re: /maps\.googleapis\.com|google\.com\/maps\/embed/, kind: 'Maps' },
  { name: 'Leaflet', re: /leaflet(?:\.min)?\.js/, kind: 'Maps' },
  { name: 'YouTube (intégration)', re: /youtube(?:-nocookie)?\.com\/embed\//, kind: 'Video' }
]

const HEADER_TECH: Array<{ name: string; header: string; re?: RegExp; kind?: string }> = [
  { name: 'Cloudflare', header: 'cf-ray', kind: 'CDN' },
  { name: 'Amazon CloudFront', header: 'x-amz-cf-id', kind: 'CDN' },
  { name: 'Fastly', header: 'x-served-by', re: /cache-/, kind: 'CDN' },
  { name: 'Akamai', header: 'x-akamai-transformed', kind: 'CDN' },
  { name: 'Vercel', header: 'x-vercel-id', kind: 'Hosting' },
  { name: 'Netlify', header: 'x-nf-request-id', kind: 'Hosting' },
  { name: 'GitHub Pages', header: 'x-github-request-id', kind: 'Hosting' },
  { name: 'Shopify', header: 'x-shopid', kind: 'E-commerce' },
  { name: 'Wix', header: 'x-wix-request-id', kind: 'CMS' },
  { name: 'Drupal', header: 'x-drupal-cache', kind: 'CMS' },
  { name: 'Varnish', header: 'x-varnish', kind: 'Cache' },
  { name: 'Varnish', header: 'via', re: /varnish/i, kind: 'Cache' },
  { name: 'WP Engine', header: 'x-powered-by', re: /wp engine/i, kind: 'Hosting' },
  { name: 'LiteSpeed Cache', header: 'x-litespeed-cache', kind: 'Cache' },
  { name: 'Sucuri', header: 'x-sucuri-id', kind: 'Security' },
  { name: 'Imperva', header: 'x-iinfo', kind: 'Security' }
]

/** Technologies visibles dans les en-têtes et le code de la page. */
export function technologies(html: string, headers: Record<string, string>, meta: Record<string, string>): Technology[] {
  const out = new Map<string, Technology>()
  const add = (t: Technology): void => {
    const prev = out.get(t.name.toLowerCase())
    if (!prev) out.set(t.name.toLowerCase(), t)
    else if (!prev.version && t.version) prev.version = t.version
  }
  // Serveur et langage annoncés : « nginx/1.18.0 », « PHP/8.1.2 ».
  for (const h of ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator']) {
    const v = headers[h]
    if (!v) continue
    for (const part of v.split(/,\s*|\s+(?=[A-Za-z][\w.-]*\/\d)/)) {
      const m = part.trim().match(/^([A-Za-z][\w .-]*?)(?:\/(\d[\w.-]*))?(?:\s*\(.*\))?$/)
      if (m && m[1].length <= 40) add({ name: m[1].trim(), version: m[2], kind: h === 'server' ? 'Web server' : 'Platform' })
    }
  }
  for (const t of HEADER_TECH) {
    const v = headers[t.header]
    if (v !== undefined && (!t.re || t.re.test(v))) add({ name: t.name, kind: t.kind })
  }
  // « WordPress 6.4.2 », « Joomla! - Open Source Content Management », « Hugo 0.120.4 ».
  const generator = meta.generator
  if (generator) {
    const m = generator.match(/^(.+?)\s+v?(\d+(?:\.\d+)+)(?:[-\s;,(].*)?$/)
    const name = (m ? m[1] : generator.split(/\s+-\s+|;|,/)[0]).trim()
    if (name.length <= 40) add({ name, version: m?.[2], kind: 'CMS' })
  }
  for (const t of HTML_TECH) {
    if (!t.re.test(html)) continue
    add({ name: t.name, version: t.version ? html.match(t.version)?.[1] : undefined, kind: t.kind })
  }
  return Array.from(out.values())
}

export const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy'
]

// Analyse locale d'une chaîne User-Agent : navigateur, moteur, système, type et modèle
// d'appareil, application intégrée (Facebook, Instagram...) et robots connus. Hors ligne.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, tr } from './_util'

export interface UaInfo {
  browser: string | null
  browserVersion: string | null
  engine: string | null
  os: string | null
  osVersion: string | null
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'tool' | 'tv' | 'console' | null
  deviceModel: string | null
  deviceVendor: string | null
  app: string | null
}

const BOTS: Array<[RegExp, string]> = [
  [/Googlebot(?:-[A-Za-z]+)?\/?([\d.]+)?/, 'Googlebot'],
  [/bingbot\/([\d.]+)/i, 'Bingbot'],
  [/YandexBot\/([\d.]+)/, 'YandexBot'],
  [/Baiduspider(?:-render)?\/?([\d.]+)?/, 'Baiduspider'],
  [/DuckDuckBot\/?([\d.]+)?/, 'DuckDuckBot'],
  [/Applebot\/([\d.]+)/, 'Applebot'],
  [/facebookexternalhit\/([\d.]+)/, 'Facebook (aperçu de lien)'],
  [/Twitterbot\/([\d.]+)/, 'Twitterbot'],
  [/LinkedInBot\/([\d.]+)/, 'LinkedInBot'],
  [/Slackbot(?:-LinkExpanding)? ?([\d.]+)?/, 'Slackbot'],
  [/Discordbot\/([\d.]+)/, 'Discordbot'],
  [/TelegramBot/, 'TelegramBot'],
  [/WhatsApp\/([\d.]+)/, 'WhatsApp (aperçu de lien)'],
  [/AhrefsBot\/([\d.]+)/, 'AhrefsBot'],
  [/SemrushBot\/?([\d.]+)?/, 'SemrushBot'],
  [/GPTBot\/([\d.]+)/, 'GPTBot (OpenAI)'],
  [/ClaudeBot\/([\d.]+)/, 'ClaudeBot (Anthropic)'],
  [/PerplexityBot\/([\d.]+)/, 'PerplexityBot'],
  [/CCBot\/([\d.]+)/, 'CCBot (Common Crawl)']
]

const TOOLS: Array<[RegExp, string]> = [
  [/^curl\/([\d.]+)/, 'curl'],
  [/^Wget\/([\d.]+)/, 'Wget'],
  [/python-requests\/([\d.]+)/, 'Python Requests'],
  [/python-urllib\/?([\d.]+)?/i, 'Python urllib'],
  [/aiohttp\/([\d.]+)/, 'aiohttp'],
  [/Go-http-client\/([\d.]+)/, 'Go net/http'],
  [/okhttp\/([\d.]+)/, 'OkHttp'],
  [/^Java\/([\d._]+)/, 'Java'],
  [/PostmanRuntime\/([\d.]+)/, 'Postman'],
  [/node-fetch\/?([\d.]+)?/, 'node-fetch'],
  [/axios\/([\d.]+)/, 'axios'],
  [/HeadlessChrome\/([\d.]+)/, 'Chrome headless'],
  [/PhantomJS\/([\d.]+)/, 'PhantomJS'],
  [/sqlmap\/([\d.]+)/, 'sqlmap'],
  [/Nmap Scripting Engine/, 'Nmap'],
  [/zgrab\/([\d.]+)/, 'zgrab'],
  [/masscan\/([\d.]+)/, 'masscan'],
  [/Nuclei/, 'Nuclei']
]

const APPS: Array<[RegExp, string]> = [
  [/FBAN\/|FBAV\/|FB_IAB\//, 'Facebook'],
  [/Instagram [\d.]+/, 'Instagram'],
  [/musical_ly|BytedanceWebview|TikTok/, 'TikTok'],
  [/Snapchat\/?[\d.]*/, 'Snapchat'],
  [/LinkedInApp/, 'LinkedIn'],
  [/Twitter for iPhone|TwitterAndroid/, 'X (Twitter)'],
  [/ Line\/[\d.]+/, 'LINE'],
  [/MicroMessenger\/[\d.]+/, 'WeChat'],
  [/Pinterest/, 'Pinterest'],
  [/GSA\/[\d.]+/, 'Google App'],
  [/Telegram-Android|TelegramWebview/, 'Telegram']
]

const BROWSERS: Array<[RegExp, string]> = [
  [/EdgA?\/([\d.]+)|EdgiOS\/([\d.]+)/, 'Microsoft Edge'],
  [/Edge\/([\d.]+)/, 'Microsoft Edge (Legacy)'],
  [/OPR\/([\d.]+)|OPT\/([\d.]+)|Opera\/([\d.]+)/, 'Opera'],
  [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
  [/YaBrowser\/([\d.]+)/, 'Yandex Browser'],
  [/Vivaldi\/([\d.]+)/, 'Vivaldi'],
  [/UCBrowser\/([\d.]+)/, 'UC Browser'],
  [/DuckDuckGo\/([\d.]+)/, 'DuckDuckGo'],
  [/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/, 'Firefox'],
  [/CriOS\/([\d.]+)/, 'Chrome'],
  [/Chrome\/([\d.]+)/, 'Chrome'],
  [/Version\/([\d.]+).*Safari\//, 'Safari'],
  [/MSIE ([\d.]+)/, 'Internet Explorer'],
  [/Trident\/.*rv:([\d.]+)/, 'Internet Explorer']
]

const WINDOWS: Record<string, string> = {
  '10.0': '10 / 11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.2': 'XP x64',
  '5.1': 'XP'
}

const VENDORS: Array<[RegExp, string]> = [
  [/^(SM-|GT-|SCH-|SGH-|Galaxy)/i, 'Samsung'],
  [/^Pixel/i, 'Google'],
  [/^(Redmi|Mi |MI |POCO|M2\d{3}|2\d{3}[A-Z0-9]{4,})/, 'Xiaomi'],
  [/^(HUAWEI|ELE-|VOG-|ANE-|MAR-|LYA-|NOH-)/i, 'Huawei'],
  [/^(ONEPLUS|CPH\d|IN20|KB20|LE21|NE22)/i, 'OnePlus / Oppo'],
  [/^(moto|Moto|XT\d)/, 'Motorola'],
  [/^(Nokia|TA-)/i, 'Nokia'],
  [/^(LM-|LG-)/, 'LG'],
  [/^(vivo|V2\d{3})/i, 'vivo'],
  [/^(RMX\d)/, 'Realme'],
  [/^(Infinix|TECNO)/i, 'Transsion'],
  [/^(SO-|XQ-|G\d{4})/, 'Sony']
]

const firstGroup = (m: RegExpMatchArray | null): string | null => (m ? (m.slice(1).find((g) => g !== undefined) ?? null) : null)

export function parseUserAgent(ua: string): UaInfo {
  const s = ua.trim()
  const info: UaInfo = {
    browser: null,
    browserVersion: null,
    engine: null,
    os: null,
    osVersion: null,
    deviceType: null,
    deviceModel: null,
    deviceVendor: null,
    app: null
  }

  for (const [re, name] of BOTS) {
    const m = s.match(re)
    if (m) return { ...info, browser: name, browserVersion: firstGroup(m), deviceType: 'bot' }
  }
  for (const [re, name] of TOOLS) {
    const m = s.match(re)
    if (m && name !== 'Chrome headless') return { ...info, browser: name, browserVersion: firstGroup(m), deviceType: 'tool' }
    if (m) {
      info.browser = name
      info.browserVersion = firstGroup(m)
      info.deviceType = 'tool'
    }
  }

  // Système d'exploitation.
  let m: RegExpMatchArray | null
  if ((m = s.match(/Windows NT ([\d.]+)/))) {
    info.os = 'Windows'
    info.osVersion = WINDOWS[m[1]] ?? m[1]
  } else if ((m = s.match(/Windows Phone (?:OS )?([\d.]+)/))) {
    info.os = 'Windows Phone'
    info.osVersion = m[1]
  } else if ((m = s.match(/iPhone OS ([\d_]+)/))) {
    info.os = 'iOS'
    info.osVersion = m[1].replace(/_/g, '.')
  } else if ((m = s.match(/iPad.*? OS ([\d_]+)/))) {
    info.os = 'iPadOS'
    info.osVersion = m[1].replace(/_/g, '.')
  } else if ((m = s.match(/Android ([\d.]+)/)) || /Android/.test(s)) {
    info.os = 'Android'
    info.osVersion = m?.[1] ?? null
  } else if ((m = s.match(/CrOS [\w]+ ([\d.]+)/))) {
    info.os = 'ChromeOS'
    info.osVersion = m[1]
  } else if ((m = s.match(/Mac OS X ([\d_.]+)/))) {
    info.os = 'macOS'
    info.osVersion = m[1].replace(/_/g, '.')
  } else if (/PlayStation/.test(s)) info.os = 'PlayStation'
  else if (/Xbox/.test(s)) info.os = 'Xbox'
  else if (/Tizen/.test(s)) info.os = 'Tizen'
  else if (/Ubuntu/.test(s)) info.os = 'Ubuntu'
  else if (/Fedora/.test(s)) info.os = 'Fedora'
  else if (/Linux/.test(s)) info.os = 'Linux'

  // Navigateur et moteur.
  if (!info.browser) {
    for (const [re, name] of BROWSERS) {
      const b = s.match(re)
      if (b) {
        info.browser = name
        info.browserVersion = firstGroup(b)
        break
      }
    }
  }
  if (/Trident|MSIE/.test(s)) info.engine = 'Trident'
  else if (/Edge\//.test(s)) info.engine = 'EdgeHTML'
  else if (info.os === 'iOS' || info.os === 'iPadOS') info.engine = 'WebKit'
  else if (/Gecko\/\d/.test(s) && /Firefox/.test(s)) info.engine = 'Gecko'
  else if (/Chrome\/|Chromium/.test(s)) info.engine = 'Blink'
  else if (/AppleWebKit/.test(s)) info.engine = 'WebKit'
  else if (/Presto/.test(s)) info.engine = 'Presto'

  for (const [re, name] of APPS) {
    if (re.test(s)) {
      info.app = name
      break
    }
  }

  // Appareil.
  if (info.deviceType !== 'tool') {
    if (/iPad|Tablet|Tab\b/.test(s)) info.deviceType = 'tablet'
    else if (/SmartTV|SMART-TV|HbbTV|AppleTV|GoogleTV|BRAVIA|Web0S|Tizen.*TV/i.test(s)) info.deviceType = 'tv'
    else if (/PlayStation|Xbox|Nintendo/.test(s)) info.deviceType = 'console'
    else if (/iPhone|iPod|Mobile|Windows Phone/.test(s)) info.deviceType = 'mobile'
    else if (info.os === 'Android') info.deviceType = 'tablet'
    else if (info.os) info.deviceType = 'desktop'
  }
  if (/iPhone/.test(s)) {
    info.deviceModel = 'iPhone'
    info.deviceVendor = 'Apple'
  } else if (/iPad/.test(s)) {
    info.deviceModel = 'iPad'
    info.deviceVendor = 'Apple'
  } else if (/Macintosh/.test(s)) info.deviceVendor = 'Apple'
  const model = s.match(/Android[ \d.]*;\s*(?:[a-z]{2}[-_][a-zA-Z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/)
  if (model && !/^(K|wv|Mobile|Linux|U)$/i.test(model[1].trim())) {
    info.deviceModel = model[1].trim()
    info.deviceVendor = VENDORS.find(([re]) => re.test(info.deviceModel!))?.[1] ?? null
  }
  return info
}

export function userAgentOutput(ctx: Pick<ModuleContext, 'lang'>, ua: string): ModuleOutput {
  const i = parseUserAgent(ua)
  const types: Record<string, [string, string]> = {
    desktop: ['ordinateur', 'desktop'],
    mobile: ['mobile', 'mobile'],
    tablet: ['tablette', 'tablet'],
    bot: ['robot d’indexation', 'crawler bot'],
    tool: ['outil ou script automatisé', 'automated tool or script'],
    tv: ['téléviseur connecté', 'smart TV'],
    console: ['console de jeu', 'game console']
  }
  const properties = compact({
    browser: i.browser,
    browser_version: i.browserVersion,
    engine: i.engine,
    os: i.os,
    os_version: i.osVersion,
    device_type: i.deviceType ? tr(ctx, ...types[i.deviceType]) : null,
    device_model: i.deviceModel,
    device_vendor: i.deviceVendor,
    in_app: i.app,
    automated: i.deviceType === 'bot' || i.deviceType === 'tool' ? true : null
  })
  const entities: OutEntity[] = []
  // Seul un modèle précis (Android) est un pivot utile : « iPhone » seul ne l'est pas.
  if (i.deviceModel && !['iPhone', 'iPad'].includes(i.deviceModel)) {
    entities.push({
      type: 'device',
      label: i.deviceVendor && !i.deviceModel.toLowerCase().startsWith(i.deviceVendor.toLowerCase()) ? `${i.deviceVendor} ${i.deviceModel}` : i.deviceModel,
      data: { model: i.deviceModel, os: [i.os, i.osVersion].filter(Boolean).join(' ') || null },
      linkLabel: tr(ctx, 'appareil', 'device')
    })
  }
  return { properties, entities, raw: i }
}

export default defineModule({
  id: 'misc.user_agent',
  name: { fr: 'Analyse du User-Agent', en: 'User-Agent analysis' },
  description: {
    fr: "Navigateur et version, moteur, système d'exploitation, type et modèle d'appareil, application intégrée (Facebook, Instagram, TikTok...), robots et outils automatisés. Hors ligne.",
    en: 'Browser and version, engine, operating system, device type and model, in-app browser (Facebook, Instagram, TikTok...), crawlers and automated tools. Offline.'
  },
  category: 'forensic',
  inputTypes: ['user_agent'],
  async run(input, ctx) {
    if (!input.label.trim()) return {}
    return userAgentOutput(ctx, input.label)
  }
})

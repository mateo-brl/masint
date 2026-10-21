// Pastilles d'entités en HTML statique (logo de plateforme, icône du type ou initiales),
// identiques à celles du canevas, pour les documents exportés.

import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { BRAND_ICONS } from '../../lib/brandIcons'
import { escapeHtml, initials, safeColor, textOn } from './format'

/** Contenu SVG (éléments enfants) d'une icône Lucide à partir de son nom. */
export type IconMarkup = (name: string) => string

export function iconSvg(inner: string, size: number, color: string, strokeWidth = 2): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  )
}

const round = (n: number): number => Math.round(n * 10) / 10

function box(size: number, radius: number, extra: string, inner: string): string {
  return (
    `<span class="mx-badge" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;` +
    `width:${size}px;height:${size}px;border-radius:${radius}px;${extra}">${inner}</span>`
  )
}

export function platformBadgeHtml(platform: string, size: number, radius = 5): string {
  const p = getPlatform(platform)
  const brand = p?.si ? BRAND_ICONS[p.si] : undefined
  const bg = brand ? `#${brand.hex}` : safeColor(p?.color, '#555555')
  const fg = textOn(bg)
  const inner = brand
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${round(size * 0.62)}" height="${round(size * 0.62)}" fill="${fg}" aria-hidden="true"><path d="${escapeHtml(brand.path)}"/></svg>`
    : `<span style="color:${fg};font-size:${round(size * 0.38)}px;font-weight:700;letter-spacing:-0.3px;line-height:1">${escapeHtml(initials(p?.name ?? platform))}</span>`
  return box(size, radius, `background:${bg};`, inner)
}

export function typeBadgeHtml(type: string, size: number, iconMarkup: IconMarkup, color?: string, icon?: string): string {
  const def = getEntityType(type)
  const c = safeColor(color, def.color)
  const hex = /^#[0-9a-f]{6}$/i.test(c)
  const markup = iconMarkup(icon ?? def.icon) || iconMarkup(def.icon) || '<circle cx="12" cy="12" r="9"/>'
  return box(
    size,
    5,
    hex ? `background:${c}22;border:1px solid ${c}55;` : `background:transparent;border:1px solid ${c};`,
    iconSvg(markup, round(size * 0.58), c)
  )
}

/** Pastille d'une entité sans image : logo de plateforme sinon icône du type (même règle que l'interface). */
export function entityBadgeHtml(
  n: { type: string; platform: string | null; style?: { icon?: string; color?: string } },
  size: number,
  iconMarkup: IconMarkup
): string {
  const icon = n.style?.icon
  if (icon?.startsWith('brand:')) return platformBadgeHtml(icon.slice(6), size)
  if (n.platform && getPlatform(n.platform) && !icon) return platformBadgeHtml(n.platform, size)
  return typeBadgeHtml(n.type, size, iconMarkup, n.style?.color, icon)
}

/** Clé de déduplication d'une pastille. */
export function badgeKey(n: { type: string; platform: string | null; style?: { icon?: string; color?: string } }): string {
  return [n.type, n.platform ?? '', n.style?.icon ?? '', n.style?.color ?? ''].join('|')
}

/** Logo MASINT (même dessin que le composant Logo et l'icône de l'application). */
export function logoHtml(size: number): string {
  return (
    `<svg class="mx-logo" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024" aria-label="MASINT" style="flex-shrink:0">` +
    '<rect x="32" y="32" width="960" height="960" rx="192" fill="#16161a" stroke="#2a2a2f" stroke-width="16"/>' +
    '<path d="M264 760 L264 264 L512 600 L760 264 L760 760" fill="none" stroke="#e5484d" stroke-width="112" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<g fill="#f4f4f5"><circle cx="264" cy="264" r="100"/><circle cx="760" cy="264" r="100"/><circle cx="264" cy="760" r="100"/><circle cx="760" cy="760" r="100"/></g>' +
    '<circle cx="512" cy="600" r="124" fill="#f4f4f5"/><circle cx="512" cy="600" r="64" fill="#e5484d"/></svg>'
  )
}

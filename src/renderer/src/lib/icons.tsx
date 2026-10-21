import { icons, type LucideProps } from 'lucide-react'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { BRAND_ICONS } from './brandIcons'

export function Icon({ name, ...props }: { name: string } & LucideProps): React.JSX.Element {
  const C = icons[name as keyof typeof icons] ?? icons.Circle
  return <C {...props} />
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase()
}

/** Contraste lisible sur une couleur de fond. */
function textOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? '#111' : '#fff'
}

/** Logo d'une plateforme dans une pastille carrée. */
export function PlatformBadge({ platform, size = 24, radius = 5 }: { platform: string; size?: number; radius?: number }): React.JSX.Element {
  const p = getPlatform(platform)
  const color = p?.color ?? '#555'
  const brand = p?.si ? BRAND_ICONS[p.si] : undefined
  const bg = brand ? `#${brand.hex}` : color
  const fg = textOn(bg)
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{ width: size, height: size, borderRadius: radius, background: bg }}
      title={p?.name ?? platform}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill={fg} aria-hidden>
          <path d={brand.path} />
        </svg>
      ) : (
        <span style={{ color: fg, fontSize: size * 0.38, fontWeight: 700, letterSpacing: -0.3 }}>{initials(p?.name ?? platform)}</span>
      )}
    </div>
  )
}

/** Icône d'un type d'entité dans une pastille colorée. */
export function TypeBadge({ type, size = 24, color, icon }: { type: string; size?: number; color?: string; icon?: string }): React.JSX.Element {
  const def = getEntityType(type)
  const c = color ?? def.color
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[5px]"
      style={{ width: size, height: size, background: `${c}22`, color: c, border: `1px solid ${c}55` }}
    >
      <Icon name={icon ?? def.icon} size={size * 0.58} strokeWidth={2} />
    </div>
  )
}

/** Pastille d'une entité : image jointe, sinon logo de plateforme, sinon icône du type. */
export function EntityBadge({
  type,
  platform,
  imageUrl,
  size = 24,
  color,
  icon
}: {
  type: string
  platform?: string | null
  imageUrl?: string | null
  size?: number
  color?: string
  icon?: string
}): React.JSX.Element {
  if (imageUrl)
    return (
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: 5 }}
      />
    )
  if (icon?.startsWith('brand:')) return <PlatformBadge platform={icon.slice(6)} size={size} />
  const p = platform ? getPlatform(platform) : undefined
  if (p && getEntityType(type).keepTypeIcon) return <TypeBadge type={type} size={size} color={color ?? p.color} icon={icon} />
  if (p && !icon) return <PlatformBadge platform={platform!} size={size} />
  return <TypeBadge type={type} size={size} color={color} icon={icon} />
}

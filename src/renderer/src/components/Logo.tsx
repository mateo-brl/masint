/** Logo MASINT : un « M » formé de nœuds reliés (même dessin que l'icône de l'application). */
export function Logo({ size = 32 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-label="MASINT">
      <rect x="32" y="32" width="960" height="960" rx="192" fill="#16161a" stroke="#2a2a2f" strokeWidth="16" />
      <path
        d="M264 760 L264 264 L512 600 L760 264 L760 760"
        fill="none"
        stroke="#e5484d"
        strokeWidth="112"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <g fill="#f4f4f5">
        <circle cx="264" cy="264" r="100" />
        <circle cx="760" cy="264" r="100" />
        <circle cx="264" cy="760" r="100" />
        <circle cx="760" cy="760" r="100" />
      </g>
      <circle cx="512" cy="600" r="124" fill="#f4f4f5" />
      <circle cx="512" cy="600" r="64" fill="#e5484d" />
    </svg>
  )
}

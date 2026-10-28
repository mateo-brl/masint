import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../lib/icons'
import { useApp, type Toast } from '../../store/app'

/** `danger-solid` : uniquement pour confirmer une action destructive (rouge = danger). */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

export function Button({
  variant = 'secondary',
  icon,
  children,
  className = '',
  size = 'md',
  ...props
}: {
  variant?: BtnVariant
  icon?: string
  size?: 'sm' | 'md'
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-accent text-on-accent hover:bg-accent-strong',
    secondary: 'bg-panel-2 border border-line text-fg hover:bg-panel-3',
    ghost: 'text-muted hover:text-fg hover:bg-panel-3',
    danger: 'bg-panel-2 border border-line text-danger hover:bg-danger-soft',
    'danger-solid': 'bg-danger-solid text-white hover:bg-danger-solid-hover'
  }
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...props}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  title,
  active,
  className = '',
  size = 16,
  ...props
}: { icon: string; title?: string; active?: boolean; size?: number } & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-[0.97] ${
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-panel-3 hover:text-fg'
      } ${className}`}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return <Icon name="LoaderCircle" size={size} className="spin" />
}

/** Fenêtres modales ouvertes, de la plus ancienne à la plus récente : seule la dernière répond. */
const modalStack: Array<RefObject<HTMLElement | null>> = []

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Deux derniers éléments focalisés. Un champ `autoFocus` prend le focus pendant le rendu,
 * avant l'effet de la fenêtre : l'élément d'origine est alors l'avant-dernier.
 */
const focusTrail: Element[] = []
if (typeof document !== 'undefined')
  document.addEventListener(
    'focusin',
    (e) => {
      focusTrail.push(e.target as Element)
      if (focusTrail.length > 2) focusTrail.shift()
    },
    true
  )

/**
 * Comportement d'une fenêtre modale : Échap la ferme (la plus récente seulement, si plusieurs
 * sont empilées), Tab reste à l'intérieur, le focus y entre à l'ouverture et revient à
 * l'élément d'origine à la fermeture.
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const inside = (x: Element | null): boolean => !!x && !!ref.current?.contains(x)
    const previous = (inside(document.activeElement) ? focusTrail.find((x) => !inside(x)) : document.activeElement) as HTMLElement | null
    modalStack.push(ref)
    // Focus d'entrée, sauf si un champ s'en est déjà chargé (autoFocus).
    const raf = requestAnimationFrame(() => {
      const el = ref.current
      if (!el || el.contains(document.activeElement)) return
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus()
    })
    const onKey = (e: KeyboardEvent): void => {
      if (modalStack[modalStack.length - 1] !== ref) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (!items.length) {
        e.preventDefault()
        ref.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      const i = modalStack.lastIndexOf(ref)
      if (i >= 0) modalStack.splice(i, 1)
      // Retour du focus à l'élément qui l'avait, s'il est encore là.
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [open, ref])
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 560,
  footer
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width?: number
  footer?: ReactNode
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModal(box, open, onClose)
  if (!open) return null
  return createPortal(
    <div className="enter-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="popover enter-pop flex max-h-full flex-col rounded-2xl outline-none"
        style={{ width, maxWidth: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <IconButton icon="X" title={t('common.close')} onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: Array<{ id: T; label: ReactNode }>
}): React.JSX.Element {
  return (
    <div className="flex gap-1 rounded-xl bg-panel-2 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] transition ${
            value === it.id ? 'border border-line-strong bg-panel-3 font-medium text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export interface MenuItem {
  label: ReactNode
  icon?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
  separator?: boolean
}

/**
 * Menu déroulant ancré sous (ou au-dessus de) son déclencheur. Rendu au premier plan de la
 * fenêtre (portail) pour ne jamais passer sous un bloc du canevas ni être coupé par un panneau.
 */
export function Dropdown({
  trigger,
  items,
  align = 'left',
  width = 220,
  up = false
}: {
  trigger: (open: boolean) => ReactNode
  items: MenuItem[] | (() => MenuItem[])
  align?: 'left' | 'right' | 'center'
  width?: number
  up?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Ouvert au clavier : le focus entre dans le menu. Un clic souris le laisse sur le déclencheur.
  const viaKeyboard = useRef(false)
  const triggerEl = (): HTMLElement | null => ref.current?.querySelector<HTMLElement>('button, [tabindex]') ?? null
  const entries = (): HTMLElement[] => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])

  // État du menu sur le bouton fourni par l'appelant, pour les lecteurs d'écran.
  useEffect(() => {
    const el = triggerEl()
    el?.setAttribute('aria-haspopup', 'menu')
    el?.setAttribute('aria-expanded', String(open))
  })

  useEffect(() => {
    if (!open) return
    const raf = viaKeyboard.current ? requestAnimationFrame(() => entries()[0]?.focus()) : 0
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      const inside = !!menu.current?.contains(document.activeElement)
      if (e.key === 'Escape') {
        if (inside) triggerEl()?.focus()
        setOpen(false)
      } else if (e.key === 'Tab' && inside) {
        // Tab reprend après le déclencheur, dans l'ordre de la page.
        triggerEl()?.focus()
        setOpen(false)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const all = entries()
        if (!all.length) return
        e.preventDefault()
        const i = all.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : e.key === 'ArrowDown' ? (i + 1) % all.length : i <= 0 ? all.length - 1 : i - 1
        all[next].focus()
      }
    }
    const onResize = (): void => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  const toggle = (e: React.MouseEvent): void => {
    // Un clic venu du clavier (Entrée, Espace) n'a pas de compteur de clics.
    viaKeyboard.current = e.detail === 0
    if (!open && ref.current) setAnchor(ref.current.getBoundingClientRect())
    setOpen(!open)
  }
  const list = typeof items === 'function' ? (open ? items() : []) : items
  let style: React.CSSProperties = { width }
  if (anchor) {
    const x = align === 'right' ? anchor.right - width : align === 'center' ? anchor.left + anchor.width / 2 - width / 2 : anchor.left
    style = {
      width,
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      ...(up ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
      maxHeight: up ? anchor.top - 16 : window.innerHeight - anchor.bottom - 16
    }
  }
  return (
    <div className="relative" ref={ref}>
      <div onClick={toggle}>{trigger(open)}</div>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="popover enter-menu fixed z-[70] overflow-y-auto rounded-xl p-1"
            // Le menu s'ouvre depuis son déclencheur.
            style={{ ...style, transformOrigin: `${align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'} ${up ? 'bottom' : 'top'}` }}
          >
            {list.map((it, i) =>
              it.separator ? (
                <div key={i} role="separator" className="my-1 border-t border-line" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  tabIndex={-1}
                  disabled={it.disabled}
                  onClick={() => {
                    // Focus rendu au déclencheur : une modale ouverte par l'action y reviendra en se fermant.
                    if (menu.current?.contains(document.activeElement)) triggerEl()?.focus()
                    setOpen(false)
                    it.onClick?.()
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition focus-visible:-outline-offset-2 disabled:opacity-40 ${
                    it.danger ? 'text-danger hover:bg-danger-soft' : 'text-fg hover:bg-panel-3'
                  }`}
                >
                  {it.icon && <Icon name={it.icon} size={14} className="shrink-0 text-muted" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const { t } = useTranslation()
  const toasts = useApp((s) => s.toasts)
  // Région toujours présente : les lecteurs d'écran annoncent ce qui y apparaît.
  return (
    <div
      role="region"
      aria-label={t('common.notifications')}
      aria-live="polite"
      className="pointer-events-none fixed right-5 bottom-20 z-[60] flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

/**
 * Un message. Son minutage s'arrête tant que la souris ou le focus est dessus, ou que la
 * fenêtre est cachée. Sans durée (message avec actions), il reste jusqu'à ce qu'on le ferme.
 */
function ToastItem({ toast }: { toast: Toast }): React.JSX.Element {
  const { t } = useTranslation()
  const dismiss = useApp((s) => s.dismissToast)
  const [leaving, setLeaving] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const remaining = useRef(toast.duration)

  useEffect(() => {
    const onVisibility = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const paused = hovered || focused || hidden
  useEffect(() => {
    if (leaving || paused || remaining.current === undefined) return
    const started = Date.now()
    const timer = setTimeout(() => setLeaving(true), remaining.current)
    return () => {
      clearTimeout(timer)
      if (remaining.current !== undefined) remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [leaving, paused])

  // Retrait après la transition de sortie (voir .toast[data-leaving]).
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => dismiss(toast.id), 120)
    return () => clearTimeout(timer)
  }, [leaving, dismiss, toast.id])

  return (
    <div
      data-leaving={leaving || undefined}
      onClick={() => setLeaving(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
      className="popover toast pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl py-2.5 pr-2 pl-3.5 text-[12.5px]"
    >
      <Icon
        name={toast.kind === 'error' ? 'CircleX' : toast.kind === 'success' ? 'CircleCheck' : 'Info'}
        size={15}
        className={`shrink-0 ${toast.kind === 'error' ? 'text-danger' : toast.kind === 'success' ? 'text-success' : 'text-muted'}`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="break-words">{toast.text}</span>
        {toast.actions && (
          <div className="flex flex-wrap gap-1.5">
            {toast.actions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setLeaving(true)
                  a.onClick()
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setLeaving(true)
        }}
        aria-label={t('common.close')}
        title={t('common.close')}
        className="shrink-0 rounded-md p-0.5 text-muted hover:bg-panel-3 hover:text-fg"
      >
        <Icon name="X" size={13} />
      </button>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** Nom lu par les lecteurs d'écran quand l'interrupteur n'est pas dans un `<label>`. */
  label?: string
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-panel-3 border border-line'}`}
    >
      {/* Déplacé par translate (compositeur) plutôt que par `left` (mise en page). */}
      <span
        className={`absolute top-1/2 left-[3px] h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[translate,background-color] duration-150 ease-[var(--ease-out)] ${
          checked ? 'translate-x-[15px] bg-on-accent' : 'bg-muted'
        }`}
      />
    </button>
  )
}

export function Empty({ icon, title, children }: { icon: string; title: ReactNode; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-2 text-muted">
        <Icon name={icon} size={20} />
      </div>
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-sm text-[12.5px] text-muted">{children}</div>}
    </div>
  )
}

/** Boîte de confirmation asynchrone. */
let confirmResolver: ((ok: boolean) => void) | null = null
let setConfirmState: ((s: { title: string; body?: string; danger?: boolean } | null) => void) | null = null

export function confirmDialog(title: string, body?: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    confirmResolver = resolve
    setConfirmState?.({ title, body, danger })
  })
}

export function ConfirmHost({ okLabel, cancelLabel }: { okLabel: string; cancelLabel: string }): React.JSX.Element {
  const [state, setState] = useState<{ title: string; body?: string; danger?: boolean } | null>(null)
  useEffect(() => {
    setConfirmState = setState
    return () => {
      setConfirmState = null
    }
  }, [])
  const close = (ok: boolean): void => {
    confirmResolver?.(ok)
    confirmResolver = null
    setState(null)
  }
  return (
    <Dialog
      open={!!state}
      onClose={() => close(false)}
      title={state?.title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {cancelLabel}
          </Button>
          <Button variant={state?.danger ? 'danger-solid' : 'primary'} onClick={() => close(true)} autoFocus>
            {okLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] [overflow-wrap:anywhere] text-muted">{state?.body}</div>
    </Dialog>
  )
}

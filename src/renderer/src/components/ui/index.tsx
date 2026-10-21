import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store/app'

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

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
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40 disabled:pointer-events-none'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-strong',
    secondary: 'bg-panel-2 border border-line text-fg hover:bg-panel-3',
    ghost: 'text-muted hover:text-fg hover:bg-panel-3',
    danger: 'bg-panel-2 border border-line text-accent hover:bg-accent-soft'
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
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className="glass flex max-h-full flex-col rounded-2xl"
        style={{ width, maxWidth: '100%' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold">{title}</div>
          <IconButton icon="X" onClick={onClose} />
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

/** Menu déroulant ancré sous son déclencheur. */
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
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const list = typeof items === 'function' ? (open ? items() : []) : items
  const pos = align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger(open)}</div>
      {open && (
        <div
          className={`glass absolute z-40 rounded-xl p-1 ${pos} ${up ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{ width }}
        >
          {list.map((it, i) =>
            it.separator ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick?.()
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition disabled:opacity-40 ${
                  it.danger ? 'text-accent hover:bg-accent-soft' : 'text-fg hover:bg-panel-3'
                }`}
              >
                {it.icon && <Icon name={it.icon} size={14} className="shrink-0 text-muted" />}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-5 bottom-20 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="glass pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]"
        >
          <Icon
            name={t.kind === 'error' ? 'CircleX' : t.kind === 'success' ? 'CircleCheck' : 'Info'}
            size={15}
            className={t.kind === 'error' ? 'text-accent' : t.kind === 'success' ? 'text-success' : 'text-muted'}
          />
          <span className="break-words">{t.text}</span>
        </div>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-panel-3 border border-line'}`}
    >
      <span
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-all"
        style={{ left: checked ? 18 : 3 }}
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
          <Button variant={state?.danger ? 'primary' : 'secondary'} onClick={() => close(true)} autoFocus>
            {okLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-muted">{state?.body}</div>
    </Dialog>
  )
}

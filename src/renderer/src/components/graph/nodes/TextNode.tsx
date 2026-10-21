import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { GraphNode, NodeInput } from '@shared/types'
import { Icon } from '../../../lib/icons'
import { useGraph, type FlowNode } from '../../../store/graph'

/** Couleurs de post-it : pastels lisibles dans les deux thèmes. */
const POSTITS = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#e9d5ff']
const FONT_SIZES = [11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]

/** Annotation libre : double-clic pour éditer, post-it si un fond est défini. */
function TextNodeImpl({ id, data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(n.label)
  const area = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const fontSize = n.style.fontSize ?? 16
  const postit = !!n.style.bg
  const color = n.style.color ?? (postit ? '#1c1917' : 'var(--text)')

  useEffect(() => {
    if (!editing) return
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // La zone de saisie grandit avec le texte.
  useLayoutEffect(() => {
    const el = area.current
    if (!editing || !el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, draft, fontSize])

  // Désélectionner le nœud termine l'édition.
  useEffect(() => {
    if (!selected && editing) area.current?.blur()
  }, [selected, editing])

  const commit = (): void => {
    setEditing(false)
    const label = draft.replace(/\s+$/, '')
    const patch: NodeInput = {}
    if (label !== n.label) patch.label = label
    // Agrandit la boîte si le texte déborde.
    const el = area.current
    const b = box.current
    if (el && b) {
      const cs = getComputedStyle(b)
      const needed = Math.ceil(el.scrollHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom))
      // Hauteur du nœud (le fond, lui, suit déjà le texte pendant l'édition).
      const current = b.parentElement?.offsetHeight ?? b.offsetHeight
      if (needed > current + 1) patch.height = needed
    }
    if (Object.keys(patch).length) void useGraph.getState().updateNode(id, patch)
  }

  const setStyle = (patch: Partial<GraphNode['style']>): void => {
    void useGraph.getState().updateNode(id, { style: { ...n.style, ...patch } })
  }
  const stepFont = (dir: 1 | -1): void => {
    const next = dir > 0 ? FONT_SIZES.find((s) => s > fontSize) : FONT_SIZES.findLast((s) => s < fontSize)
    if (next) setStyle({ fontSize: next })
  }

  const textStyle: React.CSSProperties = { color, fontSize, lineHeight: 1.35 }

  return (
    <>
      <NodeToolbar position={Position.Top} offset={10} isVisible={selected && !editing ? undefined : false}>
        <div className="glass flex items-center gap-0.5 rounded-xl p-1">
          <ToolButton title={t('canvas2.fontSmaller')} onClick={() => stepFont(-1)}>
            <Icon name="AArrowDown" size={15} />
          </ToolButton>
          <span className="w-7 text-center text-[11px] text-muted tabular-nums">{fontSize}</span>
          <ToolButton title={t('canvas2.fontLarger')} onClick={() => stepFont(1)}>
            <Icon name="AArrowUp" size={15} />
          </ToolButton>
          <div className="mx-1 h-4 w-px bg-line" />
          <ToolButton title={t('canvas2.plain')} active={!postit} onClick={() => setStyle({ bg: undefined })}>
            <Icon name="Type" size={14} />
          </ToolButton>
          {POSTITS.map((c) => (
            <button
              key={c}
              title={t('canvas2.postit')}
              onClick={() => setStyle({ bg: c })}
              className="mx-0.5 h-[18px] w-[18px] rounded-[4px]"
              style={{ background: c, outline: n.style.bg === c ? '2px solid var(--accent)' : '1px solid rgb(0 0 0 / .15)', outlineOffset: n.style.bg === c ? 2 : -1 }}
            />
          ))}
        </div>
      </NodeToolbar>
      <div
        ref={box}
        onDoubleClick={(e) => {
          e.stopPropagation()
          // Double-clic dans la zone de saisie : sélection d'un mot, pas une nouvelle édition.
          if (editing) return
          setDraft(n.label)
          setEditing(true)
        }}
        className={`group relative w-full ${editing ? 'min-h-full' : 'h-full'} ${postit ? 'rounded-[3px] px-3.5 py-3' : 'rounded-md px-1.5 py-1'} ${
          !postit && !selected ? 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-line-strong' : ''
        }`}
        style={
          postit
            ? {
                background: n.style.bg,
                boxShadow: selected
                  ? '0 0 0 1px var(--accent), 0 10px 24px rgb(0 0 0 / .3)'
                  : '0 1px 2px rgb(0 0 0 / .18), 0 8px 22px rgb(0 0 0 / .22)'
              }
            : undefined
        }
      >
        {editing ? (
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault()
                area.current?.blur()
              }
            }}
            spellCheck={false}
            className="nodrag nowheel nopan block min-h-full w-full resize-none overflow-hidden bg-transparent p-0 outline-none"
            style={{ font: 'inherit', ...textStyle, caretColor: postit ? '#1c1917' : 'var(--accent)' }}
          />
        ) : (
          <div className="h-full w-full overflow-hidden break-words whitespace-pre-wrap" style={textStyle}>
            {n.label || <span className="italic" style={{ color: postit ? '#78716c' : 'var(--faint)' }}>{t('canvas2.textPlaceholder')}</span>}
          </div>
        )}
        {postit && (
          // Coin replié du post-it.
          <span
            className="pointer-events-none absolute right-0 bottom-0 h-3.5 w-3.5"
            style={{ background: 'linear-gradient(135deg, rgb(0 0 0 / .12) 50%, var(--canvas) 50%)', borderTopLeftRadius: 3 }}
          />
        )}
      </div>
      <NodeResizer isVisible={selected && !editing} minWidth={40} minHeight={postit ? 48 : 22} />
    </>
  )
}

function ToolButton({
  title,
  active,
  onClick,
  children
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${active ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-3 hover:text-fg'}`}
    >
      {children}
    </button>
  )
}

export const TextNode = memo(TextNodeImpl)

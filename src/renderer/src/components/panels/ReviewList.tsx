import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { detectEntity } from '@shared/detect'
import { searchUrlFor } from '@shared/searchEngines'
import { getEntityType } from '@shared/entityTypes'
import { propertyLabel } from '@shared/propertyLabels'
import { findingKey, type AssistFinding, type AssistResult, type LinkContext, type PropValue, type Suggestion } from '@shared/types'
import { api, openLink } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { useAssist } from '../../store/assist'

/**
 * Résultats à vérifier : hypothèses des modules et recherches à faire à la main. Rien de tout
 * cela n'est dans le graphe tant que l'enquêteur ne l'a pas validé.
 */
export function ReviewList({ suggestions, compact = false }: { suggestions: Suggestion[]; compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const [showDone, setShowDone] = useState(false)
  const pending = suggestions.filter((s) => s.status === 'pending')
  const done = suggestions.filter((s) => s.status !== 'pending')
  // Hypothèses d'abord, puis les recherches manuelles.
  const ordered = [...pending.filter((s) => s.kind === 'entity'), ...pending.filter((s) => s.kind === 'manual')]
  const manualIds = ordered.filter((s) => s.kind === 'manual').map((s) => s.id)
  return (
    <div className="flex flex-col gap-1.5">
      {!compact && <p className="text-[11.5px] leading-snug text-muted">{t('review.intro')}</p>}
      {manualIds.length > 1 && (
        <div className="flex items-center gap-2">
          <RowButton icon="ScanSearch" label={t('assist.runAll', { count: manualIds.length })} title={t('assist.runAllTitle')} strong onClick={() => void useAssist.getState().runAll(manualIds)} />
        </div>
      )}
      {ordered.length === 0 && <div className="py-2 text-[12px] text-muted">{t('review.empty')}</div>}
      {ordered.map((s) => (s.kind === 'manual' ? <ManualRow key={s.id} s={s} /> : <EntityRow key={s.id} s={s} />))}
      {done.length > 0 && (
        <button onClick={() => setShowDone(!showDone)} className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted hover:text-fg">
          <Icon name={showDone ? 'ChevronDown' : 'ChevronRight'} size={12} />
          {t('review.done', { count: done.length })}
        </button>
      )}
      {showDone && done.map((s) => <DoneRow key={s.id} s={s} />)}
    </div>
  )
}

/** Contexte d'ouverture : une page capturée depuis le navigateur d'enquête se rattache au nœud d'origine. */
const ctxOf = (s: Suggestion): LinkContext => ({ investigationId: s.investigationId, nodeId: s.nodeId })

async function resolve(
  id: string,
  action: 'accept' | 'reject' | 'checked' | 'reopen',
  found?: { type: string; label: string; platform?: string | null; data?: Record<string, PropValue> }
): Promise<void> {
  try {
    await api('suggestions:resolve', id, action, found)
  } catch (e) {
    useApp.getState().toast('error', errorMessage(e))
  }
}

function useModuleName(): (id: string) => string {
  const modules = useApp((s) => s.modules)
  const { tx } = useLang()
  return useMemo(() => {
    const names = new Map(modules.map((m) => [m.id, tx(m.name)]))
    return (id: string) => names.get(id) ?? id
  }, [modules, tx])
}

function EntityRow({ s }: { s: Suggestion }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const moduleName = useModuleName()
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 px-2 py-1.5">
      <EntityBadge type={s.type} platform={s.platform} size={22} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[10.5px] font-medium text-muted">{tx(getEntityType(s.type).label)}</div>
        <div className="truncate text-[12.5px] font-medium" title={s.label}>
          {s.label}
        </div>
        <div className="mt-0.5 text-[11px] [overflow-wrap:anywhere] text-muted">
          {s.reason || t('review.unconfirmed')} · {moduleName(s.moduleId)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {s.url && <RowButton icon="ExternalLink" title={t('review.open')} onClick={() => openLink(s.url!, ctxOf(s))} />}
        <RowButton label={t('review.rejectShort')} title={t('review.reject')} onClick={() => void resolve(s.id, 'reject')} />
        <RowButton icon="Check" label={t('review.acceptShort')} title={t('review.accept')} strong onClick={() => void resolve(s.id, 'accept')} />
      </div>
    </div>
  )
}

function ManualRow({ s }: { s: Suggestion }): React.JSX.Element {
  // « Ouvrir » suit le moteur choisi : une recherche Google peut passer par Startpage.
  const engine = useApp((st) => st.settings?.searchEngine ?? 'auto')
  const lang = useApp((st) => st.settings?.lang ?? 'fr')
  const { t } = useTranslation()
  const { tx } = useLang()
  const [finding, setFinding] = useState(false)
  const [value, setValue] = useState('')
  const d = detectEntity(value)
  const submit = (): void => {
    const text = value.trim()
    if (!text) return
    void resolve(s.id, 'accept', d ? { type: d.type, label: d.value, platform: d.platform ?? null } : { type: 'keyword', label: text })
    setFinding(false)
    setValue('')
  }
  const assist = useAssist((st) => st.entries[s.id])
  return (
    <div className="rounded-lg border border-dashed border-line px-2 py-1.5">
      <div className="flex items-start gap-2">
        <Icon name="Search" size={14} className="mt-0.5 shrink-0 text-faint" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[12.5px] font-medium">{s.label}</div>
          {s.reason && <div className="mt-0.5 text-[11px] [overflow-wrap:anywhere] text-muted">{s.reason}</div>}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-0.5 pl-[22px]">
        <RowButton
          icon={assist?.running ? 'LoaderCircle' : 'ScanSearch'}
          label={assist?.running ? t('assist.running') : t('assist.run')}
          title={s.flow ? t('assist.flow.runTitle') : t('assist.runTitle')}
          strong
          onClick={() => void useAssist.getState().run(s.id)}
        />
        <RowButton icon="ExternalLink" label={t('review.openShort')} title={t('review.open')} onClick={() => s.url && openLink(searchUrlFor(s.url, engine, lang), ctxOf(s))} />
        <RowButton label={t('review.nothingShort')} title={t('review.nothing')} onClick={() => void resolve(s.id, 'checked')} />
        <RowButton icon="Plus" label={t('review.foundShort')} title={t('review.found')} onClick={() => setFinding(!finding)} />
      </div>
      {assist?.result && <AssistResults s={s} />}
      {finding && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-[22px]">
          {d && <EntityBadge type={d.type} platform={d.platform} size={18} />}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setFinding(false)
            }}
            placeholder={t('review.foundPlaceholder')}
            className="field !py-1 !text-[12px]"
          />
          {d && <span className="shrink-0 text-[10.5px] text-muted">{tx(getEntityType(d.type).label)}</span>}
        </div>
      )}
    </div>
  )
}

/** Résultats de la recherche assistée : seulement ce qui contient la valeur cherchée. */
function AssistResults({ s }: { s: Suggestion }): React.JSX.Element | null {
  const { t } = useTranslation()
  const entry = useAssist((st) => st.entries[s.id])
  const r = entry?.result
  if (!r) return null
  if (r.extracted) return <FlowResults s={s} r={r} added={entry.added} at={entry.at} />
  if (r.status !== 'ok')
    return <div className="mt-1 pl-[22px] text-[11px] text-muted">{r.status === 'cancelled' ? t('assist.cancelled') : r.status === 'timeout' ? t('assist.timeout') : r.error}</div>
  const list = r.matches.filter((m) => !entry.added.includes(m.url))
  return (
    <div className="mt-1.5 flex flex-col gap-1 pl-[22px]">
      {r.engine && (
        <div className="text-[10.5px] text-faint">{t(r.fallback ? 'assist.viaFallback' : 'assist.via', { engine: r.engine === 'startpage' ? 'Startpage' : 'Google' })}</div>
      )}
      {(entry.at || r.captureId) && (
        <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
          {entry.at && <span>{t('assist.savedAt', { date: new Date(entry.at).toLocaleString() })}</span>}
          {r.captureId && (
            <span className="flex items-center gap-1">
              <Icon name="Camera" size={11} /> {t('assist.captured')}
            </span>
          )}
        </div>
      )}
      {r.matches.length === 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {t('assist.none')}
          <RowButton label={t('review.nothingShort')} title={t('review.nothing')} onClick={() => void resolve(s.id, 'checked')} />
        </div>
      )}
      {r.matches.length > 0 && <div className="text-[11px] text-muted">{t('assist.found', { count: r.matches.length })}</div>}
      {list.map((m) => (
        <div key={m.url} className="rounded-md bg-panel-2 px-2 py-1.5">
          <button onClick={() => openLink(m.url, ctxOf(s))} className="block w-full truncate text-left text-[12px] font-medium hover:underline" title={m.url}>
            {m.title}
          </button>
          <div className="line-clamp-3 text-[11px] [overflow-wrap:anywhere] text-muted">{m.snippet}</div>
          <div className="mt-1 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] text-faint">{m.url}</span>
            <RowButton
              icon="Plus"
              label={t('assist.add')}
              title={t('assist.addTitle')}
              strong
              onClick={() => {
                useAssist.getState().markAdded(s.id, m.url)
                void resolve(s.id, 'accept', { type: 'url', label: m.url, data: { title: m.title, snippet: m.snippet } })
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Ce qu'un parcours scripté a lu (Facebook « Retrouvez votre compte », fiche Tellows) : chaque
 * élément s'ajoute d'un clic, qui vaut validation. Un nom devient un nœud relié à celui de la
 * recherche ; un contact masqué rejoint ses indices et relance leur recoupement.
 */
function FlowResults({ s, r, added, at }: { s: Suggestion; r: AssistResult; added: string[]; at?: number }): React.JSX.Element {
  const { t } = useTranslation()
  const lang = useApp((st) => st.settings?.lang ?? 'fr')
  const ex = r.extracted!
  const left = (kind: AssistFinding['kind'], list: string[]): string[] => list.filter((value) => !added.includes(findingKey({ kind, value })))
  const add = (finding: AssistFinding): void => {
    useAssist
      .getState()
      .addFinding(s.id, finding)
      .catch((e: unknown) => useApp.getState().toast('error', errorMessage(e)))
  }
  const shown = ex.names.length + ex.maskedNames.length
  const head =
    r.status === 'ok'
      ? ex.state === 'candidates' && !shown
        ? t('assist.flow.state.candidatesNoName')
        : t(`assist.flow.state.${ex.state}`, { count: shown })
      : r.status === 'timeout'
        ? t('assist.timeout')
        : (r.error ?? '')
  const props = ex.properties && !added.includes(findingKey({ kind: 'properties', value: '' })) ? Object.entries(ex.properties) : []
  const associated = new Set(Object.values(ex.photoOf ?? {}))
  const rows: Array<{ kind: AssistFinding['kind']; icon: string; list: string[]; button: string; title: string }> = [
    { kind: 'name', icon: 'User', list: left('name', ex.names), button: t('assist.add'), title: t('assist.flow.addName') },
    { kind: 'username', icon: 'AtSign', list: left('username', ex.usernames), button: t('assist.add'), title: t('assist.flow.addUsername') },
    { kind: 'masked_name', icon: 'EyeOff', list: left('masked_name', ex.maskedNames), button: t('assist.flow.addHint'), title: t('assist.flow.addHintTitle') },
    { kind: 'masked_email', icon: 'Mail', list: left('masked_email', ex.maskedEmails), button: t('assist.flow.addHint'), title: t('assist.flow.addHintTitle') },
    { kind: 'masked_phone', icon: 'Phone', list: left('masked_phone', ex.maskedPhones), button: t('assist.flow.addHint'), title: t('assist.flow.addHintTitle') }
  ]
  return (
    <div className="mt-1.5 flex flex-col gap-1 pl-[22px]">
      {(at || r.captureId) && (
        <div className="flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
          {at && <span>{t('assist.savedAt', { date: new Date(at).toLocaleString() })}</span>}
          {r.captureId && (
            <span className="flex items-center gap-1">
              <Icon name="Camera" size={11} /> {t('assist.captured')}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {head}
        {ex.state === 'none' && <RowButton label={t('review.nothingShort')} title={t('review.nothing')} onClick={() => void resolve(s.id, 'checked')} />}
      </div>
      {ex.note && <div className="text-[11px] [overflow-wrap:anywhere] text-muted">{ex.note}</div>}
      {rows.flatMap((row) =>
        row.list.map((value) => {
          const photo = row.kind === 'name' ? ex.photoOf?.[value] : undefined
          return (
            <div key={`${row.kind}:${value}`} className="flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1">
              <Icon name={row.icon} size={12} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-[12px]" title={value}>
                {value}
              </span>
              {photo && <RowButton icon="Image" title={t('assist.flow.photo')} onClick={() => openLink(photo, ctxOf(s))} />}
              <RowButton icon="Plus" label={row.button} title={row.title} strong onClick={() => add({ kind: row.kind, value, ...(photo ? { photo } : {}) })} />
            </div>
          )
        })
      )}
      {ex.photos
        .filter((p) => !associated.has(p))
        .map((p) => (
          <button key={p} onClick={() => openLink(p, ctxOf(s))} className="flex items-center gap-1 self-start text-[11px] text-muted hover:text-fg" title={p}>
            <Icon name="Image" size={12} /> {t('assist.flow.photo')}
          </button>
        ))}
      {props.length > 0 && (
        <div className="rounded-md bg-panel-2 px-2 py-1.5">
          {props.map(([k, v]) => (
            <div key={k} className="text-[11px] [overflow-wrap:anywhere] text-muted">
              <span className="text-fg">{propertyLabel(k, lang)}</span>
              {lang === 'fr' ? ' : ' : ': '}
              {Array.isArray(v) ? v.join(', ') : String(v)}
            </div>
          ))}
          <div className="mt-1 flex justify-end">
            <RowButton icon="Plus" label={t('assist.flow.addProperties')} title={t('assist.flow.addPropertiesTitle')} strong onClick={() => add({ kind: 'properties', value: '' })} />
          </div>
        </div>
      )}
    </div>
  )
}

function DoneRow({ s }: { s: Suggestion }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-muted">
      <Icon name={s.status === 'accepted' ? 'CircleCheck' : s.status === 'checked' ? 'SearchX' : 'CircleX'} size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={s.label}>
        {s.label}
      </span>
      <span className="shrink-0 text-faint">{t(`review.status.${s.status}`)}</span>
      {s.status !== 'accepted' && <RowButton icon="RotateCcw" title={t('review.reopen')} onClick={() => void resolve(s.id, 'reopen')} />}
    </div>
  )
}

function RowButton({
  icon,
  label,
  title,
  onClick,
  strong
}: {
  icon?: string
  label?: string
  title: string
  onClick: () => void
  strong?: boolean
}): React.JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-6 items-center justify-center gap-1 rounded-md text-[11px] font-medium transition ${label ? 'px-1.5' : 'w-6'} ${
        strong ? 'bg-accent-soft text-accent hover:bg-accent hover:text-on-accent' : 'text-muted hover:bg-panel-3 hover:text-fg'
      }`}
    >
      {icon && <Icon name={icon} size={12} />}
      {label}
    </button>
  )
}

/** Résultats à vérifier de toute l'enquête, groupés par nœud d'origine. */
export function ReviewAll({ onPick }: { onPick: (nodeId: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const suggestions = useGraph((s) => s.suggestions)
  const nodes = useGraph((s) => s.nodes)
  const groups = useMemo(() => {
    const by = new Map<string, Suggestion[]>()
    for (const s of suggestions) if (s.status === 'pending') by.set(s.nodeId, [...(by.get(s.nodeId) ?? []), s])
    return Array.from(by.entries())
  }, [suggestions])
  if (!groups.length) return <div className="py-6 text-center text-[12.5px] text-muted">{t('review.allDone')}</div>
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] leading-snug text-muted">{t('review.intro')}</p>
      {groups.map(([nodeId, list]) => {
        const node = nodes.find((n) => n.id === nodeId)?.data.node
        return (
          <div key={nodeId} className="flex flex-col gap-1.5">
            <button onClick={() => onPick(nodeId)} className="flex items-center gap-2 self-start rounded-md text-left hover:text-accent">
              {node && <EntityBadge type={node.type} platform={node.platform} size={18} />}
              <span className="text-[12.5px] font-semibold">{node?.label || t('node.untitled')}</span>
              <span className="text-[11px] text-muted">{t('review.count', { count: list.length })}</span>
            </button>
            <ReviewList suggestions={list} compact />
          </div>
        )
      })}
    </div>
  )
}

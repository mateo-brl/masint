import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACTIVITY_GROUPS, activityLine, type ActivityGroup, type ActivityWords } from '@shared/evidence'
import type { ActivityAction, ActivityCheck, ActivityEntry, ActivityPage } from '@shared/types'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button, Spinner } from '../ui'

const PAGE = 50

type Filter = 'all' | ActivityGroup

const GROUP_ICON: Record<ActivityGroup, string> = {
  nodes: 'Circle',
  edges: 'Spline',
  modules: 'Zap',
  review: 'ListTodo',
  evidence: 'Camera',
  sharing: 'Share'
}

const groupOf = (action: ActivityAction): ActivityGroup =>
  (Object.keys(ACTIVITY_GROUPS) as ActivityGroup[]).find((g) => ACTIVITY_GROUPS[g].includes(action)) ?? 'nodes'

/** Mots traduits de la description des entrées (partagée avec le rapport). */
export function useActivityWords(): ActivityWords {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      modules: (count) => t('journal.modules', { count }),
      more: (count) => t('journal.more', { count }),
      field: (key) => t(`journal.field.${key}`, { defaultValue: key }),
      untitled: t('journal.untitled'),
      followUp: t('journal.followUp'),
      chain: (depth) => t('journal.chain', { depth }),
      removedEdges: (count) => t('journal.removedEdges', { count })
    }),
    [t]
  )
}

/**
 * Journal d'activité de l'enquête : qui a fait quoi et quand, filtré par famille d'actions,
 * avec la vérification de la chaîne d'empreintes.
 */
export function JournalView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const inv = useGraph((s) => s.investigation)
  const toast = useApp((s) => s.toast)
  const words = useActivityWords()
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<ActivityPage | null>(null)
  const [reload, setReload] = useState(0)
  const [check, setCheck] = useState<ActivityCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const invId = inv?.id

  useEffect(() => {
    if (!invId) return
    let alive = true
    const actions = filter === 'all' ? undefined : ACTIVITY_GROUPS[filter]
    api('activity:list', invId, { offset: page * PAGE, limit: PAGE, actions })
      .then((d) => alive && setData(d))
      .catch((e: unknown) => toast('error', errorMessage(e)))
    return () => {
      alive = false
    }
  }, [invId, filter, page, reload, toast])

  const counts = data?.counts ?? {}
  const countOf = (f: Filter): number =>
    (f === 'all' ? (Object.values(counts) as number[]) : ACTIVITY_GROUPS[f].map((a) => counts[a] ?? 0)).reduce((a, b) => a + b, 0)
  const total = data?.total ?? 0
  const locale = i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR'
  const date = (iso: string): string => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })

  const verify = async (): Promise<void> => {
    if (!invId) return
    setChecking(true)
    try {
      setCheck(await api('activity:verify', invId))
      setReload((n) => n + 1)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setChecking(false)
    }
  }
  // Entrée altérée : page qui la contient, sans filtre (ordre du plus récent au plus ancien).
  const gotoBroken = (): void => {
    if (!check?.broken) return
    setFilter('all')
    setPage(Math.max(0, Math.floor((check.count - check.broken.seq) / PAGE)))
  }
  const copy = (hash: string): void => {
    void navigator.clipboard.writeText(hash).then(() => toast('success', t('journal.copied')))
  }
  const pick = (f: Filter): void => {
    setFilter(f)
    setPage(0)
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label-xs">{t('journal.kicker')}</div>
          <h1 className="mt-1 text-[22px] font-semibold">{t('journal.title')}</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-snug text-muted">{t('journal.intro')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button icon="RefreshCw" onClick={() => setReload((n) => n + 1)} title={t('journal.refresh')} />
          <Button variant="primary" icon={checking ? undefined : 'ShieldCheck'} disabled={checking} onClick={() => void verify()}>
            {checking && <Spinner />}
            {checking ? t('journal.verifying') : t('journal.verify')}
          </Button>
        </div>
      </div>

      {check && (
        <div
          className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-[12.5px] ${
            check.ok ? 'border-success/40 bg-success/5' : 'border-danger/50 bg-danger-soft'
          }`}
        >
          <Icon name={check.ok ? 'ShieldCheck' : 'ShieldAlert'} size={16} className={check.ok ? 'text-success' : 'text-danger'} />
          <span className="min-w-0 flex-1">
            {check.ok
              ? check.count
                ? t('journal.intact', { count: check.count })
                : t('journal.emptyChain')
              : t('journal.broken', {
                  seq: check.broken!.seq,
                  action: t(`journal.action.${check.broken!.action}`, { defaultValue: check.broken!.action }),
                  date: date(check.broken!.at),
                  reason: t(`journal.reason.${check.broken!.reason}`)
                })}
          </span>
          {check.lastHash && (
            <button onClick={() => copy(check.lastHash!)} className="font-mono text-[11px] text-muted hover:text-fg" title={t('journal.copyHash')}>
              {t('journal.lastHash')} {check.lastHash.slice(0, 16)}…
            </button>
          )}
          {check.broken && (
            <Button size="sm" icon="ArrowRight" onClick={gotoBroken}>
              {t('journal.goto')}
            </Button>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['all', ...(Object.keys(ACTIVITY_GROUPS) as ActivityGroup[])] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => pick(f)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition ${
              filter === f ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:text-fg'
            }`}
          >
            {f !== 'all' && <Icon name={GROUP_ICON[f]} size={12} />}
            {f === 'all' ? t('journal.all') : t(`journal.groups.${f}`)}
            <span className="text-[11px] text-faint">{countOf(f)}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-line">
        <div className="sticky top-0 z-10 grid grid-cols-[3rem_9.5rem_7rem_11rem_minmax(0,1fr)_minmax(0,14rem)_6.5rem] gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[11.5px] font-semibold text-muted">
          <span>{t('journal.col.seq')}</span>
          <span>{t('journal.col.date')}</span>
          <span>{t('journal.col.actor')}</span>
          <span>{t('journal.col.action')}</span>
          <span>{t('journal.col.subject')}</span>
          <span>{t('journal.col.detail')}</span>
          <span>{t('journal.col.hash')}</span>
        </div>
        {data && data.entries.length === 0 && <div className="bg-panel px-4 py-6 text-center text-muted">{t('journal.empty')}</div>}
        {data?.entries.map((e) => (
          <Row key={e.id} e={e} words={words} date={date} broken={check?.broken?.seq === e.seq} onCopy={copy} />
        ))}
      </div>

      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-muted">
          <span>{t('journal.page', { from: page * PAGE + 1, to: Math.min(total, (page + 1) * PAGE), total })}</span>
          <Button size="sm" icon="ChevronLeft" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('journal.previous')}
          </Button>
          <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>
            {t('journal.next')}
            <Icon name="ChevronRight" size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({
  e,
  words,
  date,
  broken,
  onCopy
}: {
  e: ActivityEntry
  words: ActivityWords
  date: (iso: string) => string
  broken: boolean
  onCopy: (hash: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { subject, detail } = activityLine(e, words)
  const group = groupOf(e.action)
  return (
    <div
      data-seq={e.seq}
      className={`grid grid-cols-[3rem_9.5rem_7rem_11rem_minmax(0,1fr)_minmax(0,14rem)_6.5rem] items-start gap-3 border-b border-line px-4 py-2 text-[12px] last:border-0 ${
        broken ? 'bg-danger-soft' : 'bg-panel'
      }`}
    >
      <span className="font-mono text-[11px] text-faint">{e.seq}</span>
      <span className="text-muted" title={e.at}>
        {date(e.at)}
      </span>
      <span className="truncate" title={e.actor}>
        {e.actor}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <Icon name={GROUP_ICON[group]} size={12} className="shrink-0 text-muted" />
        <span className="truncate">{t(`journal.action.${e.action}`, { defaultValue: e.action })}</span>
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]" title={subject}>
        {subject}
      </span>
      <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{detail}</span>
      <button onClick={() => onCopy(e.hash)} className="truncate text-left font-mono text-[11px] text-faint hover:text-fg" title={`${t('journal.copyHash')}\n${e.hash}`}>
        {e.hash.slice(0, 10)}
      </button>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModuleCategory, ModuleInfo, ModuleRoute, ModuleRun } from '@shared/types'
import { api, openExternal } from '../../lib/api'
import { useLang } from '../../lib/i18n'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Switch, Tabs } from '../ui'

const CATEGORY_ICON: Record<ModuleCategory, string> = {
  phone: 'Phone',
  email: 'Mail',
  username: 'AtSign',
  person: 'User',
  domain: 'Globe',
  ip: 'Network',
  web: 'AppWindow',
  crypto: 'Bitcoin',
  finance: 'Landmark',
  company: 'Building',
  location: 'MapPin',
  image: 'Image',
  messaging: 'MessageCircle',
  social: 'Share2',
  forensic: 'ShieldAlert',
  misc: 'Cpu',
  roso: 'Sparkles'
}

/** Catalogue des modules (activation, clés, routage proxy) et journal des exécutions. */
export function ModulesView(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'catalog' | 'log'>('catalog')
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-8 py-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="label-xs">{t('modules.kicker')}</div>
          <h1 className="mt-1 text-[22px] font-semibold">{t('modules.title')}</h1>
        </div>
        <div className="w-72">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'catalog', label: t('modules.catalog') },
              { id: 'log', label: t('modules.log') }
            ]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{tab === 'catalog' ? <Catalog /> : <RunLog />}</div>
    </div>
  )
}

function Catalog(): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const modules = useApp((s) => s.modules)
  const settings = useApp((s) => s.settings)
  const refresh = useApp((s) => s.refreshModules)
  const updateSettings = useApp((s) => s.updateSettings)
  const openSettings = useApp((s) => s.openSettings)
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = modules.filter((m) => !s || `${m.id} ${tx(m.name)} ${tx(m.description)}`.toLowerCase().includes(s))
    const map = new Map<ModuleCategory, ModuleInfo[]>()
    for (const m of list) map.set(m.category, [...(map.get(m.category) ?? []), m])
    return Array.from(map.entries())
  }, [modules, q, tx])

  const setRoute = (id: string, route: ModuleRoute): void => {
    if (!settings) return
    const perModule = { ...settings.proxy.perModule }
    if (route === 'default') delete perModule[id]
    else perModule[id] = route
    void updateSettings({ proxy: { ...settings.proxy, perModule } })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('modules.search')} className="field max-w-sm" />
        <span className="text-[12px] text-faint">{t('modules.count', { count: modules.length })}</span>
      </div>
      {groups.map(([cat, list]) => (
        <section key={cat}>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <Icon name={CATEGORY_ICON[cat] ?? 'Puzzle'} size={15} className="text-muted" />
            {t(`modules.cat.${cat}`)}
            <span className="text-[11px] font-normal text-faint">{list.length}</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line">
            {list.map((m) => (
              <div key={m.id} className="flex items-center gap-4 border-b border-line bg-panel px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{tx(m.name)}</span>
                    <span className="font-mono text-[10.5px] text-faint">{m.id}</span>
                    {m.ondemand && <Badge tone="accent">{t('modules.ondemand')}</Badge>}
                    {m.experimental && <Badge tone="warning">{t('modules.experimental')}</Badge>}
                    {m.noisy && <Badge tone="warning">{t('modules.noisy')}</Badge>}
                    {m.keys.length > 0 && (
                      <button onClick={() => openSettings('keys')}>
                        <Badge tone={m.configured ? 'success' : 'muted'}>
                          <Icon name="KeyRound" size={10} /> {m.configured ? t('modules.keyOk') : t('modules.needsKey')}
                        </Badge>
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{tx(m.description)}</div>
                </div>
                {m.homepage && (
                  <button onClick={() => openExternal(m.homepage!)} className="text-muted hover:text-fg" title={m.homepage}>
                    <Icon name="ExternalLink" size={14} />
                  </button>
                )}
                {settings && settings.proxy.mode !== 'none' && (
                  <select
                    value={settings.proxy.perModule[m.id] ?? 'default'}
                    onChange={(e) => setRoute(m.id, e.target.value as ModuleRoute)}
                    className="field !w-28 !py-1 text-[11.5px]"
                    title={t('modules.route')}
                  >
                    <option value="default">{t('modules.routeDefault')}</option>
                    <option value="proxy">{t('modules.routeProxy')}</option>
                    <option value="direct">{t('modules.routeDirect')}</option>
                  </select>
                )}
                <Switch checked={m.enabled} onChange={(v) => void api('modules:setEnabled', m.id, v).then(refresh)} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'accent' | 'warning' | 'success' | 'muted'; children: React.ReactNode }): React.JSX.Element {
  const cls = {
    accent: 'bg-accent-soft text-accent',
    warning: 'bg-panel-3 text-warning',
    success: 'bg-panel-3 text-success',
    muted: 'bg-panel-3 text-muted'
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] ${cls}`}>{children}</span>
}

function RunLog(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { tx } = useLang()
  const inv = useGraph((s) => s.investigation)
  const nodes = useGraph((s) => s.nodes)
  const modules = useApp((s) => s.modules)
  const jobs = useApp((s) => s.jobs)
  const [runs, setRuns] = useState<ModuleRun[]>([])
  const [onlyErrors, setOnlyErrors] = useState(false)

  useEffect(() => {
    if (inv) void api('modules:runs', inv.id).then(setRuns)
  }, [inv, jobs])

  const label = new Map(nodes.map((n) => [n.id, n.data.node.label]))
  const list = runs.filter((r) => !onlyErrors || r.status === 'error')
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        <Switch checked={onlyErrors} onChange={setOnlyErrors} /> {t('modules.onlyErrors')}
      </label>
      <div className="overflow-hidden rounded-2xl border border-line">
        {list.length === 0 && <div className="bg-panel px-4 py-6 text-center text-muted">{t('modules.noRuns')}</div>}
        {list.slice(0, 500).map((r) => {
          const m = modules.find((x) => x.id === r.moduleId)
          return (
            <div key={r.id} className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 text-[12px] last:border-0">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  r.status === 'error' ? 'bg-accent' : r.status === 'done' ? (r.resultCount || r.found ? 'bg-success' : 'bg-faint') : 'bg-warning'
                }`}
              />
              <span className="w-48 shrink-0 truncate font-medium">{m ? tx(m.name) : r.moduleId}</span>
              <span className="w-44 shrink-0 truncate text-muted">{label.get(r.nodeId) ?? '?'}</span>
              <span className="min-w-0 flex-1 truncate text-muted" title={r.error ?? undefined}>
                {r.error ?? (r.found === false ? t('runs.notFound') : r.resultCount ? t('runs.results', { count: r.resultCount }) : t(`runs.status.${r.status}`))}
              </span>
              <span className="shrink-0 text-faint">{r.startedAt ? new Date(r.startedAt).toLocaleTimeString(i18n.language) : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

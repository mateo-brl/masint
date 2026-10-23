import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeyRequirement, LinkOpening, ProxyMode, ProxyTestResult, RosoStatus, Settings, SitesStatus, SitesTier } from '@shared/types'
import { SEARCH_ENGINES } from '@shared/searchEngines'
import { api, onEvent, openExternal } from '../../lib/api'
import { useLang } from '../../lib/i18n'
import { Icon } from '../../lib/icons'
import { Logo } from '../Logo'
import { useApp } from '../../store/app'
import { errorMessage } from '../../lib/errors'
import { Button, Dialog, Spinner, Switch } from '../ui'

type Tab = 'general' | 'network' | 'keys' | 'about'

export function SettingsDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const open = useApp((s) => s.settingsOpen)
  const tab = useApp((s) => s.settingsTab) as Tab
  const close = useApp((s) => s.closeSettings)
  const setTab = (next: Tab): void => useApp.setState({ settingsTab: next })
  const tabs: Array<{ id: Tab; icon: string }> = [
    { id: 'general', icon: 'SlidersHorizontal' },
    { id: 'network', icon: 'Shield' },
    { id: 'keys', icon: 'KeyRound' },
    { id: 'about', icon: 'Info' }
  ]
  return (
    <Dialog open={open} onClose={close} title={t('settings.title')} width={820}>
      {/* Hauteur fixe : la fenêtre ne change pas de taille d'un onglet à l'autre. */}
      <div className="flex h-[min(540px,calc(100vh-170px))] gap-6">
        <div className="flex w-44 shrink-0 flex-col gap-0.5">
          {tabs.map((it) => (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] ${
                tab === it.id ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'
              }`}
            >
              <Icon name={it.icon} size={15} /> {t(`settings.tabs.${it.id}`)}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          {tab === 'general' && <GeneralTab />}
          {tab === 'network' && <NetworkTab />}
          {tab === 'keys' && <KeysTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </Dialog>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function GeneralTab(): React.JSX.Element | null {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  // Nom de session du système : enquêteur du journal quand aucun nom n'est saisi.
  const [systemUser, setSystemUser] = useState('')
  useEffect(() => {
    void api('app:info')
      .then((info) => setSystemUser(info.user))
      .catch(() => undefined)
  }, [])
  if (!settings) return null
  return (
    <div>
      <Row label={t('settings.language')}>
        <select value={settings.lang} onChange={(e) => void update({ lang: e.target.value as Settings['lang'] })} className="field !w-40">
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </Row>
      <Row label={t('settings.theme')}>
        <select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Settings['theme'] })} className="field !w-40">
          <option value="dark">{t('settings.dark')}</option>
          <option value="light">{t('settings.light')}</option>
        </select>
      </Row>
      <Row label={t('settings.autoEnrich')} hint={t('settings.autoEnrichHint')}>
        <Switch label={t('settings.autoEnrich')} checked={settings.autoEnrich} onChange={(v) => void update({ autoEnrich: v })} />
      </Row>
      <Row label={t('settings.chainDepth')} hint={t('settings.chainDepthHint')}>
        <select value={settings.chainDepth ?? 0} onChange={(e) => void update({ chainDepth: Number(e.target.value) })} className="field !w-40">
          <option value={0}>{t('settings.chainOff')}</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {t('enrich.hops', { count: n })}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('settings.passiveMode')} hint={t('settings.passiveModeHint')}>
        <Switch label={t('settings.passiveMode')} checked={settings.passiveMode} onChange={(v) => void update({ passiveMode: v })} />
      </Row>
      <Row label={t('settings.isolate')} hint={t('settings.isolateHint')}>
        <Switch label={t('settings.isolate')} checked={settings.isolateInvestigations} onChange={(v) => void update({ isolateInvestigations: v })} />
      </Row>
      <Row label={t('settings.investigatorName')} hint={t('settings.investigatorNameHint', { user: systemUser || '?' })}>
        {/* `key` : le champ reprend la valeur enregistrée (espaces retirés). */}
        <input
          key={settings.investigatorName}
          defaultValue={settings.investigatorName}
          placeholder={systemUser}
          onBlur={(e) => e.target.value.trim() !== settings.investigatorName && void update({ investigatorName: e.target.value })}
          className="field !w-48"
        />
      </Row>
      <Row label={t('settings.searchEngine')} hint={t('settings.searchEngineHint')}>
        <select value={settings.searchEngine ?? 'auto'} onChange={(e) => void update({ searchEngine: e.target.value as Settings['searchEngine'] })} className="field !w-48">
          {SEARCH_ENGINES.map((e) => (
            <option key={e} value={e}>
              {t(`settings.searchEngines.${e}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('settings.assistCapture')} hint={t('settings.assistCaptureHint')}>
        <Switch checked={settings.assistCapture} onChange={(v) => void update({ assistCapture: v })} />
      </Row>
      <Row label={t('settings.concurrency')} hint={t('settings.concurrencyHint')}>
        <input
          type="number"
          min={1}
          max={32}
          defaultValue={settings.concurrency}
          onBlur={(e) => void update({ concurrency: Number(e.target.value) })}
          className="field !w-24"
        />
      </Row>
      <Row label={t('settings.globalConcurrency')} hint={t('settings.globalConcurrencyHint')}>
        <input
          type="number"
          min={1}
          max={64}
          defaultValue={settings.globalConcurrency}
          onBlur={(e) => void update({ globalConcurrency: Number(e.target.value) })}
          className="field !w-24"
        />
      </Row>
      <Row label={t('settings.timeout')} hint={t('settings.timeoutHint')}>
        <input
          type="number"
          min={3}
          max={120}
          defaultValue={Math.round(settings.timeoutMs / 1000)}
          onBlur={(e) => void update({ timeoutMs: Number(e.target.value) * 1000 })}
          className="field !w-24"
        />
      </Row>
      <div className="py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="flex-1 text-[13px]">{t('settings.userAgent')}</span>
          <button onClick={() => void update({ userAgent: '' })} className="text-[11.5px] text-muted hover:text-fg">
            {t('settings.userAgentAuto')}
          </button>
        </div>
        {/* `key` : le champ reprend la valeur enregistrée après un retour à l'en-tête automatique. */}
        <input
          key={settings.userAgent}
          defaultValue={settings.userAgent}
          onBlur={(e) => e.target.value !== settings.userAgent && void update({ userAgent: e.target.value })}
          className="field font-mono !text-[11.5px]"
        />
        <div className="mt-1 text-[11.5px] text-muted">{t('settings.userAgentHint')}</div>
      </div>
      <SitesSection />
    </div>
  )
}

/** Base des sites de recherche de pseudo : mise à jour, contrôle témoin et état des sites. */
function SitesSection(): React.JSX.Element {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings?.lang ?? 'fr')
  const [status, setStatus] = useState<SitesStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tier, setTier] = useState<SitesTier>('essential')
  const [progress, setProgress] = useState<{ done: number; total: number; detail?: string } | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void api('sites:status').then((s) => {
      if (!alive) return
      setStatus(s)
      // Contrôle lancé avant la réouverture des paramètres : on attend sa fin (même promesse côté principal).
      if (s.checking)
        void api('sites:check', 'essential')
          .then((next) => alive && setStatus(next))
          .finally(() => alive && setProgress(null))
    })
    const off = onEvent('sites:progress', setProgress)
    return () => {
      alive = false
      off()
    }
  }, [])
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR'
  const date = (d: string | number): string => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const checking = !!status?.checking || progress !== null

  const updateDb = async (): Promise<void> => {
    setUpdating(true)
    setUpdateMsg(null)
    try {
      const res = await api('sites:updateDb')
      setUpdateMsg(res.ok ? { ok: true, text: t(`settings.sites.${res.status === 'updated' ? 'updated' : 'current'}`) } : { ok: false, text: t('settings.sites.updateFailed', { error: res.error }) })
      setStatus(await api('sites:status'))
    } catch (e) {
      setUpdateMsg({ ok: false, text: t('settings.sites.updateFailed', { error: errorMessage(e) }) })
    } finally {
      setUpdating(false)
    }
  }
  const check = async (): Promise<void> => {
    setCheckError(null)
    setProgress({ done: 0, total: status?.tiers.find((x) => x.tier === tier)?.total ?? 0 })
    try {
      setStatus(await api('sites:check', tier))
    } catch (e) {
      setCheckError(errorMessage(e))
    } finally {
      setProgress(null)
    }
  }
  const network = !status ? '' : status.egress === 'direct' ? t('settings.sites.direct') : status.egress === 'tor' ? 'Tor' : t('settings.sites.proxy')

  return (
    <div className="mt-2 flex flex-col gap-2.5 border-t border-line pt-4">
      <div className="text-[13px] font-medium">{t('settings.sites.title')}</div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 text-[12px] text-muted">
          {status &&
            t(status.db.source === 'user' ? 'settings.sites.dbUser' : 'settings.sites.dbBundled', {
              date: status.db.updatedAt ? date(status.db.updatedAt) : '?',
              count: status.db.sites
            })}
        </div>
        <Button size="sm" disabled={updating} onClick={() => void updateDb()}>
          {updating ? <Spinner size={12} /> : <Icon name="CloudDownload" size={14} />}
          {t('settings.sites.update')}
        </Button>
      </div>
      {updateMsg && <div className={`text-[11.5px] ${updateMsg.ok ? 'text-success' : 'text-accent'}`}>{updateMsg.text}</div>}
      {status?.tiers.map((x) => (
        <div key={x.tier} className="text-[12px]">
          <span className="text-fg">{t(`settings.sites.tier.${x.tier}`)}</span>
          <span className="text-muted"> · {t('settings.sites.counts', { active: x.active, failed: x.failed, skipped: x.skipped })}</span>
        </div>
      ))}
      <div className="text-[11.5px] text-muted">
        {status &&
          (status.checkedAt
            ? t('settings.sites.lastCheck', {
                network,
                date: date(status.checkedAt),
                ok: status.last?.ok ?? 0,
                failed: (status.last?.false_positive ?? 0) + (status.last?.missed ?? 0),
                inconclusive: (status.last?.inconclusive ?? 0) + (status.last?.untestable ?? 0)
              })
            : t('settings.sites.neverChecked', { network }))}
      </div>
      <div className="flex items-center gap-2">
        <select value={tier} onChange={(e) => setTier(e.target.value as SitesTier)} disabled={checking} className="field !w-40 !py-1.5">
          <option value="essential">{t('settings.sites.tier.essential')}</option>
          <option value="extended">{t('settings.sites.tier.extended')}</option>
        </select>
        <Button size="sm" disabled={checking} onClick={() => void check()}>
          {checking ? <Spinner size={12} /> : <Icon name="ShieldCheck" size={14} />}
          {t('settings.sites.check')}
        </Button>
        {checking && (
          <Button size="sm" variant="ghost" onClick={() => void api('sites:cancelCheck')}>
            {t('common.cancel')}
          </Button>
        )}
        {progress && progress.total > 0 && (
          <span className="truncate text-[11.5px] text-muted">
            {progress.done}/{progress.total}
            {progress.detail ? ` · ${progress.detail}` : ''}
          </span>
        )}
      </div>
      {checkError && <div className="text-[11.5px] text-accent">{checkError}</div>}
      <p className="text-[11.5px] text-faint">{t('settings.sites.checkHint')}</p>
    </div>
  )
}

function NetworkTab(): React.JSX.Element | null {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const [url, setUrl] = useState(settings?.proxy.url ?? '')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProxyTestResult | null>(null)
  const [renewed, setRenewed] = useState(false)
  if (!settings) return null
  const p = settings.proxy
  const newTorIdentity = async (): Promise<void> => {
    useApp.setState({ settings: await api('proxy:newTorIdentity') })
    setResult(null)
    setRenewed(true)
  }
  const setMode = (mode: ProxyMode): void => {
    setResult(null)
    void update({ proxy: { ...p, mode } })
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await api('proxy:test'))
    } finally {
      setTesting(false)
    }
  }
  const modes: Array<{ id: ProxyMode; icon: string }> = [
    { id: 'none', icon: 'Globe' },
    { id: 'http', icon: 'Server' },
    { id: 'socks5', icon: 'Waypoints' },
    { id: 'tor', icon: 'ShieldCheck' }
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted">{t('settings.proxyIntro')}</p>
      <div className="grid grid-cols-4 gap-2">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-[12.5px] ${
              p.mode === m.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:border-line-strong'
            }`}
          >
            <Icon name={m.icon} size={18} />
            {t(`settings.proxy.${m.id}`)}
          </button>
        ))}
      </div>
      {(p.mode === 'http' || p.mode === 'socks5') && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">{t('settings.proxyUrl')}</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => void update({ proxy: { ...p, url } })}
            placeholder={p.mode === 'http' ? 'http://user:pass@127.0.0.1:8080' : 'socks5://127.0.0.1:1080'}
            className="field font-mono"
          />
        </label>
      )}
      {p.mode === 'tor' && (
        <div className="flex flex-col gap-2">
          <Row label={t('settings.torPort')} hint={t('settings.torPortHint')}>
            <input
              type="number"
              defaultValue={p.torPort}
              onBlur={(e) => void update({ proxy: { ...p, torPort: Number(e.target.value) || 9050 } })}
              className="field !w-28"
            />
          </Row>
          <div className="rounded-xl border border-line bg-panel-2 p-3 text-[12px] text-muted">{t('settings.torHelp')}</div>
          <Row label={t('settings.torIdentity')} hint={renewed ? t('settings.torIdentityDone') : t('settings.torIdentityHint')}>
            <Button icon="RefreshCw" onClick={() => void newTorIdentity()}>
              {t('settings.torIdentityButton')}
            </Button>
          </Row>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button icon="Activity" onClick={() => void test()} disabled={testing}>
          {t('settings.testConnection')}
        </Button>
        {testing && <Spinner />}
        {result &&
          (result.ok ? (
            <span className="text-[12.5px] text-success">
              {t('settings.testOk', { ip: result.ip, country: result.country ?? '?' })} {result.isTor ? `· ${t('settings.viaTor')}` : ''}
            </span>
          ) : (
            <span className="text-[12.5px] text-accent">{result.error}</span>
          ))}
      </div>
      <p className="text-[11.5px] text-faint">{t('settings.proxyNote')}</p>
      <Row label={t('settings.linkOpening')} hint={t(`settings.linkOpeningHint.${settings.linkOpening}`)}>
        <select
          value={settings.linkOpening}
          onChange={(e) => void update({ linkOpening: e.target.value as LinkOpening })}
          className="field !w-56"
        >
          {(['auto', 'internal', 'external'] as const).map((v) => (
            <option key={v} value={v}>
              {t(`settings.linkOpeningMode.${v}`)}
            </option>
          ))}
        </select>
      </Row>
    </div>
  )
}

function RosoStatusLine({ status }: { status: RosoStatus }): React.JSX.Element {
  const { t } = useTranslation()
  if (!status.ok)
    return (
      <div className="mt-2 flex items-start gap-1.5 text-[11.5px] text-accent">
        <Icon name="CircleX" size={13} className="mt-px shrink-0" />
        <span className="break-words">{status.error}</span>
      </div>
    )
  const parts = [
    status.credits !== undefined && t('settings.rosoCredits', { count: status.credits }),
    status.bonusCredits ? t('settings.rosoBonus', { count: status.bonusCredits }) : '',
    status.creditsPerDay !== undefined && t('settings.rosoDaily', { used: status.dailyUsed ?? 0, max: status.creditsPerDay }),
    status.tier && t('settings.rosoTier', { tier: status.tier })
  ].filter(Boolean)
  return (
    <div className="mt-2 flex flex-col gap-1 text-[11.5px]">
      <div className="flex items-start gap-1.5 text-success">
        <Icon name="CircleCheck" size={13} className="mt-px shrink-0" />
        <span>{[t('settings.rosoValid'), ...parts].join(' · ')}</span>
      </div>
      {status.captcha && (
        <div className="flex items-start gap-1.5 text-warning">
          <Icon name="TriangleAlert" size={13} className="mt-px shrink-0" />
          <span>{t('settings.rosoCaptcha')}</span>
        </div>
      )}
    </div>
  )
}

function KeysTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const modules = useApp((s) => s.modules)
  const secrets = useApp((s) => s.secrets)
  const refreshSecrets = useApp((s) => s.refreshSecrets)
  const refreshModules = useApp((s) => s.refreshModules)
  const [values, setValues] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [security, setSecurity] = useState<{ encrypted: boolean; backend: string } | null>(null)
  const [roso, setRoso] = useState<RosoStatus | 'checking' | null>(null)
  useEffect(() => {
    void api('secrets:security').then(setSecurity)
  }, [])
  const checkRoso = async (): Promise<void> => {
    setRoso('checking')
    setRoso(await api('roso:status').catch((e) => ({ ok: false, error: errorMessage(e) })))
  }

  // Une ligne par clé, avec les modules qui l'utilisent.
  const keys = useMemo(() => {
    const map = new Map<string, { req: KeyRequirement; modules: string[] }>()
    for (const m of modules)
      for (const k of m.keys) {
        const entry = map.get(k.id) ?? { req: k, modules: [] }
        entry.modules.push(tx(m.name))
        map.set(k.id, entry)
      }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === 'roso' ? -1 : b === 'roso' ? 1 : a.localeCompare(b)))
      .filter(([id, e]) => !q || `${id} ${e.req.label} ${e.modules.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  }, [modules, tx, q])

  useEffect(() => {
    void refreshSecrets()
  }, [refreshSecrets])

  const isSet = (id: string): boolean => secrets.some((s) => s.id === id && s.set)
  const save = async (id: string): Promise<void> => {
    await api('secrets:set', id, values[id] ?? '')
    setValues({ ...values, [id]: '' })
    await Promise.all([refreshSecrets(), refreshModules()])
    if (id === 'roso') void checkRoso()
  }
  const remove = async (id: string): Promise<void> => {
    await api('secrets:delete', id)
    await Promise.all([refreshSecrets(), refreshModules()])
    if (id === 'roso') setRoso(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted">{t('settings.keysIntro')}</p>
      {security && !security.encrypted && (
        <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-panel-2 p-3 text-[12px] text-warning">
          <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
          <span>{t('settings.keyringMissing', { backend: security.backend })}</span>
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.filter')} className="field" />
      <div className="flex flex-col gap-2">
        {keys.length === 0 && <div className="py-6 text-center text-muted">{t('settings.noKeys')}</div>}
        {keys.map(([id, { req, modules: used }]) => (
          <div key={id} className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="flex items-center gap-2">
              <Icon name={isSet(id) ? 'CircleCheck' : 'Circle'} size={14} className={isSet(id) ? 'text-success' : 'text-faint'} />
              <span className="text-[13px] font-medium">{req.label}</span>
              {req.optional && <span className="rounded bg-panel-3 px-1.5 text-[10px] text-muted">{t('settings.optional')}</span>}
              <div className="flex-1" />
              {req.url && (
                <button onClick={() => openExternal(req.url!)} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-fg">
                  {t('settings.getKey')} <Icon name="ExternalLink" size={11} />
                </button>
              )}
            </div>
            <div className="mt-1 truncate text-[11px] text-faint" title={used.join(', ')}>
              {t('settings.usedBy', { list: used.join(', ') })}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={values[id] ?? ''}
                onChange={(e) => setValues({ ...values, [id]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && void save(id)}
                placeholder={isSet(id) ? t('settings.keySaved') : t('settings.pasteKey')}
                className="field !py-1.5 font-mono"
              />
              <Button size="sm" variant="primary" disabled={!values[id]} onClick={() => void save(id)}>
                {t('common.save')}
              </Button>
              {isSet(id) && id === 'roso' && (
                <Button size="sm" disabled={roso === 'checking'} onClick={() => void checkRoso()}>
                  {roso === 'checking' ? <Spinner size={12} /> : t('settings.rosoCheck')}
                </Button>
              )}
              {isSet(id) && <Button size="sm" variant="ghost" icon="Trash" onClick={() => void remove(id)} />}
            </div>
            {id === 'roso' && roso && roso !== 'checking' && <RosoStatusLine status={roso} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function AboutTab(): React.JSX.Element {
  const { t } = useTranslation()
  const update = useApp((s) => s.update)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const [info, setInfo] = useState<{ version: string; platform: string; dataPath: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  useEffect(() => {
    void api('app:info').then(setInfo)
  }, [])
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      useApp.setState({ update: await api('update:check') })
    } catch (e) {
      useApp.setState({ update: { state: 'error', error: errorMessage(e) } })
    } finally {
      setChecking(false)
      setCheckedAt(new Date().toLocaleTimeString(settings?.lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }))
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <div className="text-[16px] font-semibold">MASINT</div>
          <div className="text-[12px] text-muted">
            {t('about.version', { version: info?.version ?? '…' })} · {info?.platform}
          </div>
        </div>
      </div>
      <Row label={t('about.autoUpdate')} hint={t('about.autoUpdateHint')}>
        <Switch label={t('about.autoUpdate')} checked={!!settings?.autoUpdate} onChange={(v) => void updateSettings({ autoUpdate: v })} />
      </Row>
      <div className="flex items-center gap-3">
        <Button disabled={checking} onClick={() => void check()}>
          {checking ? <Spinner size={13} /> : <Icon name="RefreshCw" size={15} />}
          {t('about.check')}
        </Button>
        <span className="text-[12.5px] text-muted" title={update.state === 'error' ? update.error : undefined}>
          {checking
            ? t('about.state.checking')
            : update.state === 'error' && update.error === 'dev'
              ? t('about.devMode')
              : t(`about.state.${update.state}`, { version: update.version, progress: Math.round(update.progress ?? 0) })}
          {!checking && checkedAt && <span className="text-faint"> · {t('about.checkedAt', { time: checkedAt })}</span>}
        </span>
        {update.state === 'ready' && (
          <Button variant="primary" icon="CloudDownload" onClick={() => void api('update:install')}>
            {t('about.install')}
          </Button>
        )}
      </div>
      <Row label={t('about.dataPath')}>
        <button onClick={() => info && void api('app:showInFolder', info.dataPath)} className="max-w-72 truncate font-mono text-[11px] text-muted hover:text-fg">
          {info?.dataPath}
        </button>
      </Row>
      <div className="rounded-xl border border-line bg-panel-2 p-3 text-[11.5px] leading-relaxed text-muted">{t('about.legal')}</div>
      <button onClick={() => openExternal('https://github.com/mateo-brl/masint')} className="self-start text-[12px] text-muted hover:text-fg">
        github.com/mateo-brl/masint
      </button>
    </div>
  )
}

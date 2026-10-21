import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Lang } from '@shared/types'
import { useLang } from '../../lib/i18n'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button, Dialog, Spinner, Tabs } from '../ui'
import { DEFAULT_SECTIONS, REPORT_SECTIONS, type ReportOptions, type ReportSectionId } from './report'
import { generateReportHtml, generateReportPdf, type ReportStep } from './reportGen'

const PREFS_KEY = 'masint.report'

interface Prefs {
  investigator?: string
  classification?: string
  sections?: Partial<Record<ReportSectionId, boolean>>
  references?: Record<string, string>
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  } catch {
    return {}
  }
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* préférences facultatives */
  }
}

const SECTION_ICONS: Record<ReportSectionId, string> = {
  summary: 'ChartColumn',
  graph: 'Share2',
  notes: 'NotebookPen',
  entities: 'IdCard',
  links: 'Link',
  sources: 'ScrollText',
  raw: 'Braces'
}

/** Boîte de dialogue de génération du rapport PDF de l'enquête. */
export function ReportDialog(): React.JSX.Element | null {
  const open = useApp((s) => s.reportOpen)
  const investigation = useGraph((s) => s.investigation)
  if (!open || !investigation) return null
  return <ReportForm key={investigation.id} />
}

function ReportForm(): React.JSX.Element {
  const { t } = useTranslation()
  const { lang: appLang } = useLang()
  const setOpen = useApp((s) => s.setReportOpen)
  const toast = useApp((s) => s.toast)
  const investigation = useGraph((s) => s.investigation)!
  const entityCount = useGraph((s) => s.nodes.filter((n) => n.data.node.kind === 'entity').length)
  const edgeCount = useGraph((s) => s.edges.length)
  const [prefs] = useState(readPrefs)
  const [title, setTitle] = useState(investigation.name)
  const [investigator, setInvestigator] = useState(prefs.investigator ?? '')
  const [reference, setReference] = useState(prefs.references?.[investigation.id] ?? '')
  const [classification, setClassification] = useState(prefs.classification ?? '')
  const [lang, setLang] = useState<Lang>(appLang)
  const [sections, setSections] = useState<Record<ReportSectionId, boolean>>({ ...DEFAULT_SECTIONS, ...prefs.sections })
  const [step, setStep] = useState<ReportStep | null>(null)

  const busy = step !== null
  const anySection = REPORT_SECTIONS.some((id) => sections[id])
  const close = (): void => {
    if (!busy) setOpen(false)
  }

  const run = async (mode: 'pdf' | 'html'): Promise<void> => {
    const options: ReportOptions = { title, investigator, reference, classification, lang, sections }
    writePrefs({
      investigator,
      classification,
      sections,
      references: { ...prefs.references, [investigation.id]: reference }
    })
    setStep('collect')
    try {
      const path = mode === 'pdf' ? await generateReportPdf(options, setStep) : await generateReportHtml(options, setStep)
      if (path) {
        toast('success', t('report.dialog.success', { path }))
        setOpen(false)
      }
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setStep(null)
    }
  }

  const count: Partial<Record<ReportSectionId, number>> = { entities: entityCount, links: edgeCount }

  return (
    <Dialog
      open
      onClose={close}
      width={640}
      title={
        <span className="flex items-center gap-2">
          <Icon name="FileText" size={16} className="text-accent" />
          {t('report.dialog.title')}
        </span>
      }
      footer={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted">
            {busy ? (
              <>
                <Spinner size={13} />
                <span className="truncate">{t(`report.dialog.steps.${step}`)}</span>
              </>
            ) : (
              !anySection && <span className="text-accent">{t('report.dialog.nothingSelected')}</span>
            )}
          </div>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button icon="Globe" onClick={() => void run('html')} disabled={busy || !anySection}>
            {t('report.dialog.exportHtml')}
          </Button>
          <Button variant="primary" icon="FileDown" onClick={() => void run('pdf')} disabled={busy || !anySection}>
            {t('report.dialog.generatePdf')}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted">{t('report.dialog.intro')}</p>
        <Field label={t('report.dialog.docTitle')}>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={investigation.name} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('report.dialog.investigator')}>
            <input
              className="field"
              value={investigator}
              onChange={(e) => setInvestigator(e.target.value)}
              placeholder={t('report.dialog.investigatorPlaceholder')}
            />
          </Field>
          <Field label={t('report.dialog.reference')}>
            <input className="field" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('report.dialog.referencePlaceholder')} />
          </Field>
          <Field label={t('report.dialog.classification')}>
            <input
              className="field"
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
              placeholder={t('report.dialog.classificationPlaceholder')}
            />
          </Field>
          <Field label={t('report.dialog.language')} group>
            <Tabs<Lang>
              value={lang}
              onChange={setLang}
              items={[
                { id: 'fr', label: 'Français' },
                { id: 'en', label: 'English' }
              ]}
            />
          </Field>
        </div>
        <div>
          <div className="label-xs mb-1.5">{t('report.dialog.sections')}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {REPORT_SECTIONS.map((id) => (
              <label
                key={id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition ${
                  sections[id] ? 'border-line-strong bg-panel-2' : 'border-line hover:bg-panel-2'
                }`}
              >
                <input
                  type="checkbox"
                  checked={sections[id]}
                  onChange={(e) => setSections({ ...sections, [id]: e.target.checked })}
                  className="mt-0.5 shrink-0"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    <Icon name={SECTION_ICONS[id]} size={13} className="text-muted" />
                    {t(`report.dialog.section.${id}`)}
                    {count[id] !== undefined && <span className="ml-auto text-[11px] font-normal text-faint">{count[id]}</span>}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t(`report.dialog.hint.${id}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>
    </Dialog>
  )
}

function Field({ label, children, group }: { label: string; children: React.ReactNode; group?: boolean }): React.JSX.Element {
  // Un groupe de boutons ne doit pas être enveloppé dans un <label> (le clic activerait le premier bouton).
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="flex min-w-0 flex-col gap-1.5">
      <span className="label-xs">{label}</span>
      {children}
    </Tag>
  )
}

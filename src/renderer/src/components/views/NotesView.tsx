import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGraph } from '../../store/graph'

/** Notes libres de l'enquête et description. */
export function NotesView(): React.JSX.Element {
  const { t } = useTranslation()
  const investigation = useGraph((s) => s.investigation)
  const update = useGraph((s) => s.updateInvestigation)
  const [notes, setNotes] = useState(investigation?.notes ?? '')
  const [description, setDescription] = useState(investigation?.description ?? '')

  useEffect(() => {
    if (!investigation || (notes === investigation.notes && description === investigation.description)) return
    const id = setTimeout(() => void update({ notes, description }), 500)
    return () => clearTimeout(id)
  }, [notes, description, investigation, update])

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 px-8 py-8">
      <div>
        <div className="label-xs">{t('notes.kicker')}</div>
        <h1 className="mt-1 text-[22px] font-semibold">{investigation?.name}</h1>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">{t('home.description')}</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
      </label>
      <label className="flex min-h-0 flex-1 flex-col gap-1.5">
        <span className="text-[12px] text-muted">{t('notes.title')}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('notes.placeholder')}
          className="field min-h-0 flex-1 resize-none font-mono !text-[13px] leading-relaxed"
        />
      </label>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { ENTITY_TYPES } from '@shared/entityTypes'
import { addEntityAt, usePlacement, useVisibleCenter } from '../../lib/actions'
import { api } from '../../lib/api'
import { useLang } from '../../lib/i18n'
import { Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Dropdown, Switch } from '../ui'

const QUICK_TYPES = ['person', 'username', 'email', 'phone', 'account', 'domain', 'ip', 'url', 'address', 'company', 'crypto_wallet', 'iban', 'photo', 'event']
const DRAW_COLORS = ['#e5484d', '#ffc53d', '#30a46c', '#0090ff', '#d6409f', '#ededef']

/** Barre d'outils du bas : ajout de nœuds, texte, photo, carte, dessin, style du graphe. */
export function BottomBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const center = useVisibleCenter()
  const place = usePlacement()
  const tool = useGraph((s) => s.tool)
  const setTool = useGraph((s) => s.setTool)
  const drawColor = useGraph((s) => s.drawColor)
  const drawWidth = useGraph((s) => s.drawWidth)
  const setDrawStyle = useGraph((s) => s.setDrawStyle)
  const addNodes = useGraph((s) => s.addNodes)
  const investigation = useGraph((s) => s.investigation)
  const settings = useApp((s) => s.settings)
  const theme = useApp((s) => s.theme)
  const updateSettings = useApp((s) => s.updateSettings)
  const toggleCatalog = useApp((s) => s.toggleCatalog)

  const addText = (): void => {
    const [p] = place([{ width: 220, height: 60 }])
    void addNodes([{ kind: 'text', type: 'text', label: t('bottombar.newText'), x: p.x, y: p.y, width: 220, height: 60, style: { fontSize: 16 } }])
  }

  const addPhoto = async (source: 'file' | 'clipboard'): Promise<void> => {
    if (!investigation) return
    const atts = await api(source === 'file' ? 'attachments:pick' : 'attachments:paste', investigation.id)
    if (source === 'clipboard' && !atts.length) useApp.getState().toast('info', t('props.noClipboardImage'))
    const spots = place(atts.map(() => ({ width: 260, height: 180 })))
    if (atts.length)
      await addNodes(
        atts.map((a, i) => ({ kind: 'image' as const, type: 'image', label: a.name, imageId: a.id, x: spots[i].x, y: spots[i].y, width: 260, height: 180 }))
      )
  }

  const addMap = (): void => {
    const [p] = place([{ width: 320, height: 220 }])
    // La carte se centre sur l'entité géolocalisée sélectionnée, sinon sur Paris.
    const sel = useGraph.getState().selectedNodes().find((n) => typeof n.data.lat === 'number' && typeof n.data.lon === 'number')
    void addNodes([
      {
        kind: 'map',
        type: 'map',
        label: sel?.label ?? '',
        data: { lat: (sel?.data.lat as number) ?? 48.8566, lon: (sel?.data.lon as number) ?? 2.3522, zoom: sel ? 14 : 11 },
        x: p.x,
        y: p.y,
        width: 320,
        height: 220
      }
    ])
  }

  return (
    <div className="surface absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl px-2 py-1.5">
      <Dropdown
        up
        align="left"
        width={240}
        trigger={(open) => (
          <BarButton icon="Waypoints" label={t('bottombar.node')} trailing={<Icon name={open ? 'ChevronDown' : 'ChevronUp'} size={12} />} strong />
        )}
        items={[
          ...QUICK_TYPES.map((id) => {
            const def = ENTITY_TYPES.find((e) => e.id === id)!
            return { label: tx(def.label), icon: def.icon, onClick: () => void addEntityAt(id, center()) }
          }),
          { separator: true, label: '' },
          { label: t('bottombar.moreTypes'), icon: 'Layers', onClick: () => toggleCatalog(true) },
          { label: t('bottombar.importList'), icon: 'FileSpreadsheet', onClick: () => useApp.getState().setImportOpen(true) }
        ]}
      />
      <Divider />
      <BarButton icon="Type" label={t('bottombar.text')} onClick={addText} />
      <Dropdown
        up
        align="center"
        width={250}
        trigger={() => <BarButton icon="ImagePlus" label={t('bottombar.photo')} />}
        items={[
          { label: t('bottombar.photoFile'), icon: 'FolderOpen', onClick: () => void addPhoto('file') },
          { label: t('bottombar.photoPaste'), icon: 'ClipboardPaste', hint: 'Ctrl+V', onClick: () => void addPhoto('clipboard') }
        ]}
      />
      <BarButton icon="MapPin" label={t('bottombar.map')} onClick={addMap} />
      <div className="relative flex items-center">
        <BarButton icon="Pencil" label={t('bottombar.draw')} active={tool === 'draw'} onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')} />
        {tool === 'draw' && (
          <div className="popover absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-2">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setDrawStyle(c, drawWidth)}
                aria-label={`${t('style.color')} ${c}`}
                aria-pressed={drawColor === c}
                className="h-5 w-5 rounded-full"
                style={{ background: c, outline: drawColor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
              />
            ))}
            <div className="mx-1 h-4 w-px bg-line" />
            {[2, 4, 8, 14].map((w) => (
              <button
                key={w}
                onClick={() => setDrawStyle(drawColor, w)}
                aria-label={`${t('style.strokeWidth')} ${w}`}
                aria-pressed={drawWidth === w}
                className={`flex h-6 w-6 items-center justify-center rounded-md ${drawWidth === w ? 'bg-panel-3' : ''}`}
              >
                <span className="rounded-full bg-fg" style={{ width: Math.min(14, w + 2), height: Math.min(14, w + 2) }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <Divider />
      <Dropdown
        up
        align="right"
        width={250}
        trigger={() => <BarButton icon="Palette" label={t('bottombar.style')} />}
        items={() => [
          { label: t('style.edgeBezier'), icon: settings?.edgeStyle === 'bezier' ? 'Check' : 'Spline', onClick: () => void updateSettings({ edgeStyle: 'bezier' }) },
          { label: t('style.edgeStep'), icon: settings?.edgeStyle === 'smoothstep' ? 'Check' : 'CornerDownRight', onClick: () => void updateSettings({ edgeStyle: 'smoothstep' }) },
          { label: t('style.edgeStraight'), icon: settings?.edgeStyle === 'straight' ? 'Check' : 'Slash', onClick: () => void updateSettings({ edgeStyle: 'straight' }) },
          {
            label: (
              <span className="flex items-center justify-between">
                {t('style.edgeLabelsAll')} <Switch checked={settings?.edgeLabels === 'always'} onChange={() => undefined} />
              </span>
            ),
            onClick: () => void updateSettings({ edgeLabels: settings?.edgeLabels === 'always' ? 'auto' : 'always' })
          },
          { separator: true, label: '' },
          {
            label: (
              <span className="flex items-center justify-between">
                {t('style.minimap')} <Switch checked={settings?.showMinimap !== false} onChange={() => undefined} />
              </span>
            ),
            onClick: () => void updateSettings({ showMinimap: !(settings?.showMinimap !== false) })
          },
          {
            label: (
              <span className="flex items-center justify-between">
                {t('style.lightTheme')} <Switch checked={theme === 'light'} onChange={() => undefined} />
              </span>
            ),
            onClick: () => void updateSettings({ theme: theme === 'light' ? 'dark' : 'light' })
          }
        ]}
      />
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <div className="mx-1 h-5 w-px bg-line" />
}

function BarButton({
  icon,
  label,
  onClick,
  active,
  strong,
  trailing
}: {
  icon: string
  label: string
  onClick?: () => void
  active?: boolean
  strong?: boolean
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition ${
        active ? 'bg-accent-soft text-accent' : 'hover:bg-panel-3'
      } ${strong ? 'font-semibold' : 'font-medium'}`}
    >
      <Icon name={icon} size={14} className={active ? '' : 'text-muted'} />
      {label}
      {trailing}
    </button>
  )
}

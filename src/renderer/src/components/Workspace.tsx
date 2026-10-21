import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useGraph } from '../store/graph'
import { useApp } from '../store/app'
import { ReportDialog } from './export/ReportDialog'
import { GraphCanvas } from './graph/GraphCanvas'
import { CatalogPanel } from './panels/CatalogPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { BottomBar } from './toolbar/BottomBar'
import { TopBar } from './toolbar/TopBar'
import { MapView } from './views/MapView'
import { ModulesView } from './views/ModulesView'
import { NotesView } from './views/NotesView'
import { TimelineView } from './views/TimelineView'

/** Espace de travail d'une enquête ouverte. */
export function Workspace(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const catalogOpen = useApp((s) => s.catalogOpen)
  const name = useGraph((s) => s.investigation?.name)
  useEffect(() => {
    document.title = name ? `${name} · MASINT` : 'MASINT'
    return () => {
      document.title = 'MASINT'
    }
  }, [name])
  return (
    <ReactFlowProvider>
      <div className="absolute inset-0 overflow-hidden bg-canvas">
        {view === 'graph' && (
          <>
            <GraphCanvas />
            {catalogOpen && <CatalogPanel />}
            <TopBar />
            <BottomBar />
          </>
        )}
        {view === 'map' && <MapView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'modules' && <ModulesView />}
        {view === 'notes' && <NotesView />}
        {(view === 'graph' || view === 'map' || view === 'timeline') && <PropertiesPanel />}
        <ReportDialog />
      </div>
    </ReactFlowProvider>
  )
}

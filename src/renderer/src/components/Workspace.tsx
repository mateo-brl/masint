import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useGraph } from '../store/graph'
import { useApp } from '../store/app'
import { useCorrelationSync } from '../store/correlation'
import { useFilters } from '../store/filters'
import { DuplicateAlerts } from './DuplicateAlerts'
import { ReportDialog } from './export/ReportDialog'
import { ImportDialog } from './import/ImportDialog'
import { GraphCanvas } from './graph/GraphCanvas'
import { AnalysisPanel } from './panels/AnalysisPanel'
import { CatalogPanel } from './panels/CatalogPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { BottomBar } from './toolbar/BottomBar'
import { TopBar } from './toolbar/TopBar'
import { MapView } from './views/MapView'
import { ModulesView } from './views/ModulesView'
import { JournalView } from './views/JournalView'
import { NotesView } from './views/NotesView'
import { TableView } from './views/TableView'
import { TimelineView } from './views/TimelineView'

/** Espace de travail d'une enquête ouverte. */
export function Workspace(): React.JSX.Element {
  const view = useApp((s) => s.view)
  const catalogOpen = useApp((s) => s.catalogOpen)
  const analysisOpen = useApp((s) => s.analysisOpen)
  const name = useGraph((s) => s.investigation?.name)
  const investigationId = useGraph((s) => s.investigation?.id)
  // Filtres et calques de l'enquête ; corrélation avec les autres enquêtes.
  useEffect(() => {
    if (investigationId) useFilters.getState().load(investigationId)
  }, [investigationId])
  useCorrelationSync()
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
            {analysisOpen && <AnalysisPanel />}
            <TopBar />
            <BottomBar />
          </>
        )}
        {view === 'map' && <MapView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'table' && <TableView />}
        {view === 'modules' && <ModulesView />}
        {view === 'notes' && <NotesView />}
        {view === 'journal' && <JournalView />}
        {(view === 'graph' || view === 'map' || view === 'timeline' || view === 'table') && <PropertiesPanel />}
        <ReportDialog />
        <ImportDialog />
        <DuplicateAlerts />
      </div>
    </ReactFlowProvider>
  )
}

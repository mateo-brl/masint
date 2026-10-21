import { useApp } from '../store/app'

/** Bascule FR / EN en bas à droite. */
export function LangSwitch(): React.JSX.Element {
  const lang = useApp((s) => s.settings?.lang ?? 'fr')
  const update = useApp((s) => s.updateSettings)
  return (
    <div className="glass fixed right-4 bottom-4 z-30 flex rounded-full p-1">
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => void update({ lang: l })}
          className={`h-8 w-10 rounded-full text-[12px] font-bold transition ${lang === l ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

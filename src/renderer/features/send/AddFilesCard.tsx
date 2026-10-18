/**
 * AddFilesCard — the big "Add Files" hero in the Send modal: click to open
 * the native picker, or drop files/folders on it. `compact` renders the
 * slim "Add more" variant shown above a staged list.
 *
 * @example <AddFilesCard />
 */
import { pickFiles, stageFiles } from '../../controllers/share'
import { useFileDrop } from '../../hooks/useFileDrop'
import { cn } from '../../lib/cn'
import { useStagedFilesStore } from '../../stores/staged-files-store'
import { Icon } from '../../components/ui/Icon'
import { Spinner } from '../../components/ui/Spinner'

export function AddFilesCard({ compact }: { compact?: boolean }) {
  const loading = useStagedFilesStore((s) => s.loading)
  const { isOver, bind } = useFileDrop((files) => void stageFiles(files))
  return (
    <button
      type="button"
      {...bind}
      onClick={() => void pickFiles()}
      className={cn(
        'flex w-full items-center rounded-2xl border-2 border-dashed text-left transition-colors',
        compact ? 'gap-3 px-4 py-3' : 'gap-5 px-6 py-7',
        isOver ? 'border-accent bg-accent/15' : 'border-accent/30 bg-accent/[0.07] hover:border-accent/60 hover:bg-accent/10'
      )}
    >
      <span className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-fg/10 text-fg', compact ? 'h-9 w-9' : 'h-[60px] w-[60px]')}>
        {loading ? <Spinner className="h-5 w-5 text-accent" /> : <Icon name={compact ? 'plus' : 'folder-outline'} className={compact ? 'h-4 w-4' : 'h-6 w-6'} />}
      </span>
      <span className="min-w-0">
        <span className={cn('block font-bold text-fg', compact ? 'text-sm' : 'text-xl')}>{compact ? 'Add more files' : 'Add Files'}</span>
        <span className={cn('block text-muted', compact ? 'text-xs' : 'mt-0.5 text-sm')}>
          {isOver ? 'Drop to add' : 'Drag and drop here or click to browse'}
        </span>
      </span>
    </button>
  )
}

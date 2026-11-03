import { SORT_FIELD_LABELS, type PrSort, type SortField } from '../lib/prFilters'

const FIELDS = Object.keys(SORT_FIELD_LABELS) as SortField[]

export function SortControl({ sort, onChange }: { sort: PrSort; onChange(sort: PrSort): void }) {
  return (
    <div className="inline-flex items-center rounded-lg ring-1 ring-zinc-800">
      <label className="flex items-center gap-1.5 pl-2.5 text-xs text-zinc-500">
        Sort
        <select
          value={sort.field}
          onChange={(e) => onChange({ ...sort, field: e.target.value as SortField })}
          className="cursor-pointer bg-transparent py-1 pr-1 text-zinc-200 outline-none"
        >
          {FIELDS.map((field) => (
            <option key={field} value={field} className="bg-zinc-900">
              {SORT_FIELD_LABELS[field]}
            </option>
          ))}
        </select>
      </label>
      <button
        title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
        onClick={() => onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
        className="border-l border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:text-white"
      >
        {sort.direction === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  )
}

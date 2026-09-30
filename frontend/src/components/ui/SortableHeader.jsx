import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils.js';

/**
 * A sortable column heading.
 * ---------------------------------------------------------------------------
 * Why shared: three admin tables needed this and each would have grown its own
 * arrow logic, its own hover state and its own idea of what "sorted" looks
 * like. The behaviour is identical everywhere; only the column name changes.
 *
 * Sorting happens on the server, not in the browser. The tables are paginated,
 * so re-ordering the twenty rows currently on screen would produce a list that
 * is sorted within the page and unsorted across it — which looks like it works
 * and is wrong in exactly the way nobody checks.
 *
 * Accessibility. `aria-sort` on the `<th>` is what tells a screen reader the
 * column is ordered and which way; the arrow alone conveys that to sighted
 * users only. The control is a real `<button>`, so it is reachable by keyboard
 * and announced as pressable — a `<th onClick>` is neither.
 */

/**
 * @param {object} props
 * @param {string} props.column       This column's sort key, e.g. "price".
 * @param {string} [props.sort]       The active sort, e.g. "price:desc".
 * @param {(next: string) => void} props.onSort
 * @param {'left'|'right'|'center'} [props.align]
 */
export function SortableHeader({ column, sort, onSort, align = 'left', className, children }) {
  const [activeColumn, activeDirection = 'asc'] = (sort ?? '').split(':');
  const isActive = activeColumn === column;
  const descending = isActive && activeDirection === 'desc';

  // Ascending first, then descending, then back to the list's natural order —
  // a third click should undo the sort, not trap you cycling between two.
  const next = !isActive ? `${column}:asc` : descending ? '' : `${column}:desc`;

  const Icon = !isActive ? ChevronsUpDown : descending ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (descending ? 'descending' : 'ascending') : 'none'}
      className={cn(
        'px-3 py-2.5 font-medium',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        className={cn(
          'group inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60',
          align === 'right' && 'flex-row-reverse',
          isActive && 'text-gold',
        )}
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-opacity',
            // The neutral arrows are a hint, not decoration: at full strength
            // every heading looks sorted and the real one stops standing out.
            isActive ? 'opacity-100' : 'opacity-30 group-hover:opacity-70',
          )}
        />
      </button>
    </th>
  );
}

export default SortableHeader;

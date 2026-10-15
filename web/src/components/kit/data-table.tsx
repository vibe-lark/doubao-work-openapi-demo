// DataTable — a batteries-included table built on @tanstack/react-table v8 (sorting, single-column
// text filter, pagination). Pass column definitions + rows; you get a desktop table that AUTO
// CARD-IFIES at ≤768px (each row stacks into a labelled card via the `data-label` CSS pattern in
// data-table.css — no work required from the caller). Give a column a readable mobile label through
// `meta.label`; otherwise a string `header` (or the column id) is used.
//
//   const columns: ColumnDef<Row>[] = [
//     { accessorKey: "name", header: "Name", meta: { label: "Name" } },
//     { accessorKey: "email", header: "Email" },
//   ];
//   <DataTable columns={columns} data={rows} filterColumn="name" filterPlaceholder="Filter names…" />
import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import "./data-table.css";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Column id/accessorKey to expose a single text filter for. Omit to hide the filter box. */
  filterColumn?: string;
  filterPlaceholder?: string;
  pageSize?: number;
  className?: string;
  /** Shown in the table body when there are no rows. */
  emptyMessage?: React.ReactNode;
  /**
   * Make whole rows clickable (open a drawer, drill in…). Clicks landing on interactive elements
   * inside cells (button/a/input/select/textarea/[role=button]/[data-no-row-click]) are ignored so
   * per-cell actions keep working. Rows become keyboard-focusable; Enter/Space activate.
   */
  onRowClick?: (row: TData) => void;
}

// Row-level click must never swallow per-cell controls — anything interactive inside a cell wins.
function isInnerInteractive(el: Element | null): boolean {
  return Boolean(el?.closest("button, a, input, select, textarea, [role='button'], [data-no-row-click]"));
}

// A plain-string label for the mobile card (`td::before content`). Prefers meta.label, then a string
// header, then the column id — anything renderable-but-not-a-string can't live in an attribute.
function mobileLabel<TData, TValue>(column: ColumnDef<TData, TValue>, id: string): string {
  const metaLabel = (column.meta as { label?: string } | undefined)?.label;
  if (metaLabel) return metaLabel;
  if (typeof column.header === "string") return column.header;
  return id;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterColumn,
  filterPlaceholder = "Filter…",
  pageSize = 10,
  className,
  emptyMessage = "No results.",
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  // initialState is mount-only; callers sizing pageSize off async-loaded data (e.g. rows.length to
  // disable pagination) would otherwise be stuck with the first-mount value.
  React.useEffect(() => {
    table.setPageSize(pageSize);
  }, [table, pageSize]);

  // Map column id -> mobile label once, so cells can stamp data-label without re-deriving per render.
  const labels = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of columns) {
      const id = (c as { id?: string; accessorKey?: string }).id ?? (c as { accessorKey?: string }).accessorKey ?? "";
      if (id) m[id] = mobileLabel(c, id);
    }
    return m;
  }, [columns]);

  const filterValue =
    (filterColumn ? (table.getColumn(filterColumn)?.getFilterValue() as string) : "") ?? "";

  return (
    <div className={cn("dt-root flex flex-col gap-3", className)}>
      {filterColumn && (
        <Input
          value={filterValue}
          onChange={(e) => table.getColumn(filterColumn)?.setFilterValue(e.target.value)}
          placeholder={filterPlaceholder}
          className="max-w-xs"
        />
      )}

      <div className="dt-wrap rounded-lg border">
        <Table className="dt-table">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className="h-9 bg-muted/50 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 -ml-1 rounded px-1 py-0.5 font-medium uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-50" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={
                    onRowClick
                      ? "cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      : undefined
                  }
                  onClick={
                    onRowClick
                      ? (e) => {
                          if (isInnerInteractive(e.target as Element)) return;
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          if (isInnerInteractive(e.target as Element)) return;
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} data-label={labels[cell.column.id] ?? cell.column.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

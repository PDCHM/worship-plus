import type { ReactNode } from "react";

/* Shared top-level page title + circular "+" used on Songs, Folders, Setlists
   and Teams, so all four screens have the same title size/weight/line-height
   and the same add control (size, colour, position immediately after the
   title). Change it here and every screen follows. */

export const PAGE_TITLE_CLASS = "text-2xl md:text-3xl font-bold tracking-tight";

export function TitleAddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="shrink-0 w-8 h-8 rounded-full bg-[#735fee] text-white flex items-center justify-center hover:bg-[#6650e6] transition-colors">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
  );
}

/** Title row: <h1> + circular "+" beside it; optional right-aligned extras. */
export function PageTitleRow({ title, addLabel, onAdd, as: Tag = "h1", right }: {
  title: ReactNode; addLabel: string; onAdd: () => void; as?: "h1" | "h2"; right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Tag className={PAGE_TITLE_CLASS + " min-w-0 truncate"}>{title}</Tag>
      <TitleAddButton onClick={onAdd} label={addLabel} />
      {/* -my-0.5: a 36px control here mustn't make this row taller than the 32px "+", so titles sit at the same height on every screen. */}
      {right && <div className="ml-auto shrink-0 -my-0.5">{right}</div>}
    </div>
  );
}

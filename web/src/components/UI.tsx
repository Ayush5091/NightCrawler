import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { TableCell } from "../lib";

const easing = [0.2, 0, 0, 1] as const;

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 18 }}
      whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.5, delay, ease: easing }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <article className={`card ${className}`}>
      {title || action ? (
        <div className="card-heading">
          {title ? <h3>{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </article>
  );
}

export function MetricCard({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warning" | "danger" }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={`metric-card metric-card--${tone}`}
      whileHover={reducedMotion ? undefined : { y: -4, scale: 1.012 }}
      transition={{ duration: 0.26, ease: easing }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </motion.div>
  );
}

export function Chip({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "warning" | "success" | "neutral"; title?: string }) {
  return <span className={`chip chip--${tone}`} title={title}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function StatList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="stat-list">
      {rows.map(([label, value], index) => (
        <div className="stat-row" key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  headers,
  rows,
  empty = "No observations in this scan.",
  label,
}: {
  headers: string[];
  rows: TableCell[][];
  empty?: string;
  label: string;
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${label}. Scroll horizontally to see all columns.`}>
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportLink({ id, format, children }: { id: string; format: "json" | "csv" | "pdf"; children: ReactNode }) {
  return (
    <a id={`${format}-link`} className="export-link" href={`/api/scans/${id}/${format}`}>
      {children}
      <ArrowUpRight size={15} aria-hidden="true" />
    </a>
  );
}

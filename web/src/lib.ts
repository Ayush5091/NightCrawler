import type { ReactNode } from "react";

export const truncate = (value: unknown, length = 65) => {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
};

export const formatBytes = (value: number | null | undefined) => {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
};

export const formatDate = (value: string) => new Date(value).toLocaleString();

export type TableCell = ReactNode;

export const apiJson = async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

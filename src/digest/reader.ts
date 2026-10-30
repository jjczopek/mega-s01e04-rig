import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

interface RunRecord {
  at: string;
  instant: number;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  // Require a calendar date and an explicit zone, never the host's local zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  if (!isCalendarDate(value.slice(0, 10))) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function parseRecord(line: string): RunRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const instant = timestamp(record.at);
  if (
    typeof record.at !== 'string' || instant === null ||
    typeof record.job !== 'string' || record.job.length === 0 ||
    (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') ||
    (typeof record.owner !== 'string' && record.owner !== null) ||
    ('error' in record && typeof record.error !== 'string')
  ) return null;
  return {
    at: record.at,
    instant,
    job: record.job,
    status: record.status,
    owner: record.owner,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!isCalendarDate(night)) return null;
  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  let badLines = 0;
  const records: RunRecord[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const record = parseRecord(line);
    if (record === null) badLines += 1;
    else records.push(record);
  }

  // Stable sorting preserves file order for records at the same instant.
  records.sort((a, b) => a.instant - b.instant);
  const jobs = new Map<string, DigestRow>();
  for (const record of records) {
    const row = jobs.get(record.job);
    if (row) {
      row.runs += 1;
      row.retries += Number(record.status === 'retry');
      row.owner = record.owner;
      row.lastStatus = record.status;
      if (record.error !== undefined) row.lastError = record.error;
      row.lastAt = record.at;
    } else {
      jobs.set(record.job, {
        job: record.job,
        owner: record.owner,
        runs: 1,
        retries: Number(record.status === 'retry'),
        lastStatus: record.status,
        lastError: record.error ?? null,
        firstAt: record.at,
        lastAt: record.at,
      });
    }
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines };
};

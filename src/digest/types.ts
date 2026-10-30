/** The statuses accepted at the JSONL boundary. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's valid records, ordered by timestamp instant, then file order on ties. */
export interface DigestRow {
  job: string;
  /** Owner on the last record; null stays null and is displayed as —. */
  owner: string | null;
  /** All valid records for this job, including retry and fail records. */
  runs: number;
  /** Number of records whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error, retained after success; null if none was supplied. */
  lastError: string | null;
  /** Original timestamp strings, including their offsets; never reformatted to UTC. */
  firstAt: string;
  lastAt: string;
}

/** An existing night's file, even when empty or containing only invalid lines. */
export interface NightDigest {
  night: string;
  /** One row per job, sorted ascending by job using string comparison, not locale. */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or invalid record fields. */
  badLines: number;
}

/**
 * Contract for readNight(runsDir, night), to be implemented in ./reader.ts.
 * Import ReadNight as a type; this module provides no callable runtime stub.
 *
 * Read runsDir/<night>.jsonl. A night must be a real calendar date in YYYY-MM-DD
 * form (no path components). Return null for an invalid night or a missing file
 * (ENOENT). Reject other filesystem errors rather than calling them missing.
 * An empty file returns { night, rows: [], badLines: 0 }; an all-invalid file also
 * has no rows, but retains its bad-line count. Ignore blank lines, including the
 * final newline. A bad line never prevents other records from being aggregated.
 *
 * A valid record is an object with a nonempty string job, an ISO 8601 timestamp
 * at with an explicit timezone (offset or Z), status in RunStatus, and owner as
 * a string or null. Optional error must be a string when present. Ignore extra
 * fields. Invalid required fields, timestamps, statuses, or errors count as one
 * bad line. Preserve accepted job, owner, error, and timestamp strings verbatim.
 *
 * Aggregate all valid records in the file, including timestamps after midnight;
 * the filename selects the night. Determine first/last by timestamp instant,
 * breaking ties by file order. The last record supplies owner and lastStatus;
 * the latest record carrying error supplies lastError (or null when absent).
 * Return rows in ascending job order for both HTML and JSON consumers.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest | null>;

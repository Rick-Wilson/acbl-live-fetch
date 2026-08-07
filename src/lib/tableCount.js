// Derive how many tables were in play for a session.
//
// Every table plays a given board exactly once, so the number of result rows
// for a board number — summed across sections, since a board number recurs once
// per section — is the table count. Taking the maximum across board numbers
// rather than the first tolerates boards that some tables sat out, which is
// normal in an incomplete movement or a board dropped from a round.
//
// Verified against BBO's own tournament summary: event 3132-1785344400 reports
// 54 tables across 4 sections, and its busiest board carries 54 result rows.
//
// Returns null rather than 0 when there's nothing to count, so "unknown" stays
// distinguishable from "no tables".
export function countTables(boards) {
  if (!Array.isArray(boards) || boards.length === 0) return null
  const byNumber = new Map()
  for (const board of boards) {
    const rows = board?.results?.length ?? 0
    if (rows === 0) continue
    const key = board?.number ?? null
    byNumber.set(key, (byNumber.get(key) ?? 0) + rows)
  }
  if (byNumber.size === 0) return null
  return Math.max(...byNumber.values())
}

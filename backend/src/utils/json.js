/**
 * Safely reads a value from a MySQL JSON column.
 *
 * mysql2's behavior here has changed across versions and depends on
 * connection config: sometimes a JSON column comes back already parsed
 * into a JS object/array, sometimes as a raw JSON string. Calling
 * `JSON.parse` unconditionally would crash on the former; using the raw
 * value unconditionally would break on the latter. This handles both,
 * so the rest of the codebase never has to think about it.
 */
function parseJsonColumn(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return JSON.parse(value);
  return value; // already an object/array
}

module.exports = { parseJsonColumn };

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function flattenRecord(value, prefix = "", output = {}, depth = 0) {
  if (depth > 12) {
    output[prefix] = "[Maximum depth]";
    return output;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      flattenRecord(child, prefix ? `${prefix}.${key}` : key, output, depth + 1);
    }
  } else if (Array.isArray(value)) {
    output[prefix] = value.every((item) => typeof item !== "object")
      ? value.join(", ")
      : JSON.stringify(value);
  } else if (prefix) {
    output[prefix] = value ?? "";
  }
  return output;
}

export function columnUnion(records, promptVariables = []) {
  const all = new Set();
  for (const record of records)
    Object.keys(flattenRecord(record.normalized ?? record)).forEach((key) => all.add(key));
  const prompt = [...new Set(promptVariables.filter((name) => all.has(name)))];
  const rest = [...all].filter((name) => !prompt.includes(name)).sort((a, b) => a.localeCompare(b));
  return [...prompt, ...rest].map((name) => ({ name, promptUsed: prompt.includes(name) }));
}

export function displayCell(value, max = 180) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return { short: text.length > max ? `${text.slice(0, max - 1)}…` : text, full: text };
}

export function sortAndFilterRecords(
  records,
  { search = "", filter = "all", sortKey = "displayName", direction = "asc" } = {}
) {
  const query = search.trim().toLocaleLowerCase();
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return records
    .filter((record) => filter === "all" || record.status === filter)
    .filter((record) => !query || JSON.stringify(record.normalized).toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const leftValue =
        sortKey.includes(".") || Object.hasOwn(left.normalized ?? {}, sortKey)
          ? flattenRecord(left.normalized)[sortKey]
          : left[sortKey];
      const rightValue =
        sortKey.includes(".") || Object.hasOwn(right.normalized ?? {}, sortKey)
          ? flattenRecord(right.normalized)[sortKey]
          : right[sortKey];
      const comparison = collator.compare(String(leftValue ?? ""), String(rightValue ?? ""));
      return direction === "desc" ? -comparison : comparison;
    });
}

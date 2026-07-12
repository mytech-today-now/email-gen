function cleanText(value) {
  return String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return cleanText(value)
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase() ? word : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function recordName(record) {
  return (
    record?.displayName ||
    record?.normalized?.name ||
    record?.normalized?.restaurant ||
    record?.normalized?.business ||
    record?.raw?.name ||
    record?.raw?.restaurant ||
    ""
  );
}

function dominantCity(records) {
  const counts = new Map();
  for (const record of records) {
    const city = cleanText(record?.normalized?.city || record?.raw?.city);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function promptLabel(templateName) {
  const text = cleanText(templateName || "email campaign").toLowerCase();
  if (text.includes("sms")) return "AI SMS";
  if (text.includes("email")) return "Email";
  return titleCase(text || "Campaign");
}

export function suggestProjectMetadata({ records = [], sourceName = "import", templateName = "" } = {}) {
  const firstName = cleanText(recordName(records[0]));
  const city = dominantCity(records);
  const label = promptLabel(templateName);
  const baseSource = titleCase(sourceName || "Imported data") || "Imported Data";
  const count = records.length;
  const datasetName = city ? `${baseSource} - ${city}` : baseSource;
  const nameParts = [label];

  if (firstName) {
    nameParts.push(count > 1 ? `${firstName} + ${count - 1} more` : firstName);
  } else if (city) {
    nameParts.push(`${city} prospects`);
  } else {
    nameParts.push(datasetName);
  }

  return {
    name: nameParts.join(": ").slice(0, 96),
    datasetName: datasetName.slice(0, 96),
    promptName: templateName || "restaurant-ai-sms.txt"
  };
}

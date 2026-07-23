import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  credentialDefinitionById,
  supportedTestCredentialProviderIds
} from "../src/security/credentialCatalog.js";
import { createOsTestCredentialStore } from "../src/security/testCredentialStore.js";

function parseProviders(argv) {
  const providers = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--provider" && argv[index + 1]) {
      providers.push(argv[index + 1].trim());
      index += 1;
    }
  }
  return [...new Set(providers.filter(Boolean))];
}

async function promptProviders() {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Providers to configure (${supportedTestCredentialProviderIds().join(", ")}): `
    );
    return [
      ...new Set(
        answer
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ];
  } finally {
    rl.close();
  }
}

async function promptHidden(label) {
  if (!input.isTTY) throw new Error("Interactive credential installation requires a TTY.");
  return await new Promise((resolve) => {
    let value = "";
    output.write(`${label}: `);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (chunk) => {
      const character = String(chunk);
      if (character === "\u0003") {
        output.write("^C\n");
        process.exitCode = 130;
        process.exit();
      }
      if (character === "\r" || character === "\n") {
        input.off("data", onData);
        input.setRawMode(false);
        output.write("\n");
        resolve(value.trim());
        return;
      }
      if (character === "\u0008" || character === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    };
    input.on("data", onData);
  });
}

async function install(argv) {
  const store = createOsTestCredentialStore();
  const providers = parseProviders(argv);
  const selected = providers.length ? providers : await promptProviders();
  if (!selected.length) {
    console.error("No providers selected.");
    process.exitCode = 1;
    return;
  }

  const installed = [];
  for (const providerId of selected) {
    const definition = credentialDefinitionById(providerId);
    if (!definition?.testCredentialId) {
      console.error(`Skipping unsupported provider '${providerId}'.`);
      continue;
    }
    const credential = await promptHidden(`${definition.label} rotated test credential`);
    if (!credential) {
      console.error(`Skipping ${providerId}; no credential entered.`);
      continue;
    }
    await store.set(providerId, credential);
    installed.push(providerId);
  }

  if (!installed.length) {
    console.error("No test credentials were installed.");
    process.exitCode = 1;
    return;
  }
  console.log(`Installed: ${installed.join(", ")}`);
}

async function list() {
  const store = createOsTestCredentialStore();
  const items = await store.list();
  for (const item of items) {
    console.log(`${item.providerId}: ${item.configured ? "configured" : "unconfigured"}`);
  }
}

async function remove(argv) {
  const store = createOsTestCredentialStore();
  const providers = parseProviders(argv);
  if (!providers.length) {
    console.error("Specify at least one provider with --provider.");
    process.exitCode = 1;
    return;
  }
  for (const providerId of providers) {
    await store.remove(providerId);
    console.log(`Removed: ${providerId}`);
  }
}

async function removeAll() {
  const store = createOsTestCredentialStore();
  await store.removeAll();
  console.log("Removed all stored test credentials.");
}

const command = process.argv[2];
const args = process.argv.slice(3);

try {
  if (command === "install") await install(args);
  else if (command === "list") await list();
  else if (command === "remove") await remove(args);
  else if (command === "remove-all") await removeAll();
  else {
    console.error("Usage: node scripts/test-credentials.js <install|list|remove|remove-all> [--provider id]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}

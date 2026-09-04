import { execFile } from "node:child_process";

function runJxa(source, { timeout = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", source], { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stderr, error.message, error.signal ? `signal=${error.signal}` : "", error.code !== undefined ? `code=${error.code}` : ""].filter(Boolean).join("; ");
        reject(new Error(String(detail || "JXA execution failed").trim()));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function snapshotScript(appName, maxDepth, maxNodes, maxElapsedMs) {
  return `
var appName = ${JSON.stringify(appName)};
var maxDepth = ${maxDepth};
var maxNodes = ${maxNodes};
var deadlineAt = Date.now() + ${maxElapsedMs};
var sys = Application("System Events");
var proc = sys.processes.byName(appName);
var visited = 0;
var truncated = false;

function readValue(getter) {
  try {
    var value = getter();
    return value === undefined || value === null ? "" : String(value);
  } catch (error) {
    return "";
  }
}

function readChildren(element) {
  try { return element.uiElements(); } catch (error) { return []; }
}

function walk(element, depth) {
  if (!element || depth > maxDepth || visited >= maxNodes || Date.now() >= deadlineAt) {
    if (Date.now() >= deadlineAt || visited >= maxNodes) truncated = true;
    return null;
  }
  visited += 1;
  var role = readValue(function () { return element.role(); });
  var name = readValue(function () { return element.name(); }).slice(0, 240);
  var value = readValue(function () { return element.value(); }).slice(0, 240);
  var description = readValue(function () { return element.description(); }).slice(0, 240);
  var children = [];
  var rawChildren = readChildren(element);
  for (var index = 0; index < Math.min(rawChildren.length, 80) && visited < maxNodes; index += 1) {
    var child = walk(rawChildren[index], depth + 1);
    if (child) children.push(child);
  }
  return { role: role, name: name, value: value, description: description, children: children };
}

function visibleText(node, values) {
  if (!node) return;
  if (["AXStaticText", "AXButton", "AXTextField", "AXTextArea", "AXMenuItem", "AXLink"].indexOf(node.role) >= 0) {
    if (node.name) values.push(node.name);
    if (node.value && node.value !== node.name) values.push(node.value);
  }
  (node.children || []).forEach(function (child) { visibleText(child, values); });
}

var processExists = false;
try { processExists = proc.exists(); } catch (error) { processExists = false; }
var windows = [];
if (processExists) {
  try { windows = proc.windows(); } catch (error) { windows = []; }
}
var elements = [];
for (var windowIndex = 0; windowIndex < Math.min(windows.length, 3) && visited < maxNodes && Date.now() < deadlineAt; windowIndex += 1) {
  var snapshot = walk(windows[windowIndex], 0);
  if (snapshot) elements.push(snapshot);
}
var values = [];
elements.forEach(function (element) { visibleText(element, values); });
var status = !processExists ? "not_running" : !windows.length ? "no_visible_window" : elements.length ? "ready" : "unreadable";
JSON.stringify({ application: appName, status: status, processExists: processExists, windowCount: windows.length, elements: elements, text: values.join(" ").replace(/\\s+/g, " ").trim().slice(0, 5000), elementCount: visited, truncated: truncated });
`;
}

function visibleApplicationsScript() {
  return `
var sys = Application("System Events");
var names = [];
var frontmostName = "";
try { names = sys.processes.whose({ backgroundOnly: false }).name(); } catch (error) { names = []; }
try { frontmostName = String(sys.processes.whose({ frontmost: true })[0].name()); } catch (error) {}
var seen = {};
var items = [];
if (frontmostName) { items.push({ name: frontmostName, frontmost: true }); seen[frontmostName] = true; }
for (var index = 0; index < names.length && items.length < 12; index += 1) {
  var name = String(names[index] || "");
  if (name && !seen[name]) { items.push({ name: name, frontmost: false }); seen[name] = true; }
}
JSON.stringify(items);
`;
}

export async function snapshotMacApplication({ appName, maxDepth = 5, maxNodes = 160, maxElapsedMs = 6500 } = {}) {
  if (process.platform !== "darwin") throw new Error("macOS accessibility is unavailable on this platform");
  const name = String(appName || "").trim();
  if (!name) throw new Error("appName is required");
  const cappedDepth = Math.min(Math.max(Number(maxDepth) || 5, 1), 12);
  const cappedNodes = Math.min(Math.max(Number(maxNodes) || 160, 20), 600);
  const cappedElapsedMs = Math.min(Math.max(Number(maxElapsedMs) || 6500, 1000), 8000);
  const raw = await runJxa(snapshotScript(name, cappedDepth, cappedNodes, cappedElapsedMs), { timeout: cappedElapsedMs + 1500 });
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`macOS accessibility returned invalid JSON: ${raw.slice(0, 500)}`);
  }
}

export async function discoverVisibleMacApplications() {
  if (process.platform !== "darwin") return [];
  const raw = await runJxa(visibleApplicationsScript(), { timeout: 5000 });
  try {
    const applications = JSON.parse(raw);
    return Array.isArray(applications) ? applications : [];
  } catch {
    throw new Error(`macOS visible-application discovery returned invalid JSON: ${raw.slice(0, 500)}`);
  }
}

export const macosAccessibilityInternals = Object.freeze({ snapshotScript, visibleApplicationsScript });

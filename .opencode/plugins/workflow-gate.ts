const DEFAULT_REQUIRED = ['skill', 'task', 'mcp'];
const KNOWN_REQUIREMENTS = new Set(DEFAULT_REQUIRED);
const MCP_HELPERS = new Set(['list_mcp_resources', 'read_mcp_resource']);
const GATED_TOOLS = new Set(['edit', 'write', 'apply_patch', 'patch']);
const WRITE_PATTERNS = [
  /(^|[^0-9&])>{1,2}\s*(?!\/dev\/null)[^\s&|]+/,
  /(^|[;&|(\n]\s*)(Set-Content|Add-Content|Clear-Content|Out-File|Tee-Object|Remove-Item)\b/i,
  /(^|[;&|(\n]\s*)(sed|perl)\s+(-[^\s]*i|--in-place)\b/i,
  /(^|[;&|(\n]\s*)git\s+(apply(?!\s+--check)|restore(?!\s+--staged)|checkout\s+--(?!\s*help)|clean|reset\s+--hard|stash)\b/i,
  /(^|[;&|(\n]\s*)(rm|del|erase|mv|move|cp|copy|ren|rename)\b/i,
  /(^|[;&|(\n]\s*)(npm|pnpm|yarn)\s+(install|i|ci|add|remove|uninstall)\b(?!.*--dry-run)/i,
  /(^|[;&|(\n]\s*)(prettier\s+--write|eslint\s+--fix|gofmt\s+-w|ruff\s+format|cargo\s+fmt)\b/i,
];

function envValue(name, fallback) {
  const value = typeof process !== 'undefined' ? process.env[name] : undefined;
  return value === undefined || value === '' ? fallback : value;
}

function envFlag(name, fallback) {
  const value = envValue(name, null);
  if (value === null) return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(envValue(name, fallback));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, 24 * 60);
}

function configuredRequirements() {
  const raw = envValue('WORKFLOW_GATE_REQUIRE', '');
  if (!raw) return DEFAULT_REQUIRED;
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isWriteCommand(command) {
  const text = String(command || '');
  if (!text) return false;
  return WRITE_PATTERNS.some((pattern) => pattern.test(text));
}

export default async ({ client }) => {
  const requested = configuredRequirements().filter((kind) => KNOWN_REQUIREMENTS.has(kind));
  const required = requested.length ? [...new Set(requested)] : DEFAULT_REQUIRED;
  const ttlMs = envNumber('WORKFLOW_GATE_TTL_MINUTES', 30) * 60 * 1000;
  const gateBashWrites = envFlag('WORKFLOW_GATE_BASH', true);
  const debug = envFlag('WORKFLOW_GATE_DEBUG', false);

  let mcpPrefixes = [];
  let mcpCheckedAt = 0;
  let mcpWarned = false;

  const evidence = new Map();
  const parentMap = new Map();

  async function refreshMcp(force = false) {
    if (!force && mcpCheckedAt && Date.now() - mcpCheckedAt < 60 * 1000) return mcpPrefixes;
    mcpCheckedAt = Date.now();
    try {
      const status = await Promise.race([
        client?.mcp?.status?.(),
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (status && typeof status === 'object') {
        mcpPrefixes = Object.keys(status)
          .filter((name) => status[name]?.status === 'connected')
          .map((name) => `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_`);
      }
    } catch {
      mcpPrefixes = [];
    }
    if (!mcpPrefixes.length && !mcpWarned) {
      mcpWarned = true;
      if (debug) {
        console.error('[workflow-gate] no connected MCP server; mcp requirement skipped');
      }
    }
    return mcpPrefixes;
  }

  function isMcpTool(name) {
    if (MCP_HELPERS.has(name)) return true;
    return mcpPrefixes.some((prefix) => name.startsWith(prefix));
  }

  async function parentOf(sessionID) {
    if (parentMap.has(sessionID)) return parentMap.get(sessionID);
    try {
      const result = await client?.session?.get?.({ path: { id: sessionID } });
      const info = result?.info || result?.data || result;
      const parentID = info?.parentID || null;
      parentMap.set(sessionID, parentID);
      return parentID;
    } catch {
      parentMap.set(sessionID, null);
      return null;
    }
  }

  function mark(sessionID, kind) {
    const now = Date.now();
    let entry = evidence.get(sessionID);
    if (!entry) {
      entry = { kinds: new Map(), lastAt: now };
      evidence.set(sessionID, entry);
    }
    entry.kinds.set(kind, now);
    entry.lastAt = now;
    for (const key of entry.kinds.keys()) entry.kinds.set(key, now);

    if (evidence.size > 200) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [key, value] of evidence) {
        if (key === sessionID) continue;
        if (now - value.lastAt > ttlMs) evidence.delete(key);
        else if (value.lastAt < oldestAt) {
          oldestAt = value.lastAt;
          oldestKey = key;
        }
      }
      if (evidence.size > 200 && oldestKey) evidence.delete(oldestKey);
    }
  }

  async function missingFor(sessionID) {
    const parentID = await parentOf(sessionID);
    const key = parentID || sessionID;
    const kinds = evidence.get(key)?.kinds;
    const cutoff = Date.now() - ttlMs;
    let active = required;
    if (active.includes('mcp')) {
      const prefixes = await refreshMcp();
      if (!prefixes.length) active = active.filter((kind) => kind !== 'mcp');
    }
    return active.filter((kind) => {
      const seenAt = kinds?.get(kind);
      return !seenAt || seenAt < cutoff;
    });
  }

  if (debug) {
    console.error(
      `[workflow-gate] active; require=${required.join(',')} ttl=${ttlMs / 60000}m ` +
        `bash=${gateBashWrites}`,
    );
  }

  return {
    'tool.execute.before': async (input, output) => {
      const { tool, sessionID } = input;

      if (!mcpCheckedAt) await refreshMcp();

      if (tool === 'skill') mark(sessionID, 'skill');
      else if (tool === 'task') mark(sessionID, 'task');
      else if (isMcpTool(tool)) mark(sessionID, 'mcp');

      const writesFile = GATED_TOOLS.has(tool);
      const writesWithBash =
        gateBashWrites && tool === 'bash' && isWriteCommand(output?.args?.command);
      if (!writesFile && !writesWithBash) return;

      const missing = await missingFor(sessionID);
      if (missing.length === 0) return;

      if (debug) {
        console.error(
          `[workflow-gate] blocked ${tool} in ${sessionID}; missing ${missing.join(',')}`,
        );
      }

      throw new Error(
        `Workflow gate: before ${writesWithBash ? 'running a write command' : 'editing code'}, ` +
          `this session must use ${missing.join(', ')}. ` +
          'Call the matching tools first — a skill, a task sub-agent, and an MCP tool — ' +
          `then retry ${tool}.`,
      );
    },

    'tool.execute.after': async (input, output) => {
      try {
        const { tool, sessionID } = input;
        if (tool === 'task') {
          const childID =
            output?.metadata?.sessionId ||
            output?.metadata?.sessionID ||
            output?.metadata?.session_id;
          if (childID) parentMap.set(childID, sessionID);
        } else if (tool === 'skill') {
          mark(sessionID, 'skill');
        } else if (isMcpTool(tool)) {
          mark(sessionID, 'mcp');
        }
      } catch {
        // Evidence bookkeeping must never fail a tool call.
      }
    },

    event: async ({ event }) => {
      if (event?.type !== 'session.created' && event?.type !== 'session.updated') return;
      const info = event.properties?.info;
      if (info?.id && info?.parentID) parentMap.set(info.id, info.parentID);
    },
  };
};

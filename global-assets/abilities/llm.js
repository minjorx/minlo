// llm.js — OpenAI-compatible chat completion capability (uses the
// `openai` npm SDK for the HTTP layer; we don't reimplement auth/streaming
// on top of fetch).
//
// Per main-loop turn (execute called once per turn):
//   1. Print prompt to stderr (so it doesn't pollute the reply stream)
//   2. Read one line of user input from stdin
//   3. Append user message to messages
//   4. Call openai.chat.completions.create({...})
//   5. Print the assistant reply
//   6. Append assistant reply to messages
//   7. return { action: 'continue' } — loop only stops via Ctrl-C or another
//      capability returning 'stop'
//
// State is kept in process.minlo.ctx.llm (key = ability name per
// CLAUDE.md §3.8).
//
// API key resolution: config.apiKey may be either
//   - a literal value, e.g. "sk-..." (kept verbatim)
//   - an env-var reference, e.g. "${OPENAI_API_KEY}" (read from process.env)
// Anything else is an init error.
import { createInterface } from 'node:readline';
import OpenAI from 'openai';

const CTX_KEY = 'llm';

// Readline interface — created once in init, used in every execute, closed
// in destroy. Bound to process.stdin / process.stderr (so prompts don't
// pollute the reply stream on stdout).
let rl = null;

// Holds the openai SDK client + state for the duration of the run.
let client = null;

function resolveApiKey(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'llm: config.apiKey is required.\n' +
        '       Either pass a literal key (e.g. "sk-...") or an env-var reference like "${OPENAI_API_KEY}".\n' +
        '       Then set the env var before running: export OPENAI_API_KEY=sk-...',
    );
  }
  const m = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(raw);
  if (m) {
    const v = process.env[m[1]];
    if (!v) {
      throw new Error(
        'llm: env var ' + m[1] + ' is not set (referenced in config.apiKey as "${' + m[1] + '}")\n' +
          '       Set it before running, e.g.:\n' +
          '         export ' + m[1] + '=sk-...\n' +
          '         minlo run',
      );
    }
    return v;
  }
  return raw; // literal key
}

function validateConfig(c) {
  if (!c || typeof c !== 'object') {
    throw new Error(
      'llm: config is required.\n' +
        '       In your agent JSON, the llm ability must be referenced as\n' +
        '         { "name": "llm", "config": { "url": "...", "model": "...", "apiKey": "${OPENAI_API_KEY}", ... } }\n' +
        '       See CLAUDE.md §3.11 for the full config schema.',
    );
  }
  const url = c.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('llm: config.url is required');
  }
  const apiType = c.apiType;
  if (apiType !== 'openai') {
    throw new Error('llm: config.apiType must be "openai" in v1 (got ' + JSON.stringify(apiType) + ')');
  }
  const model = c.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('llm: config.model is required');
  }
  const apiKey = resolveApiKey(c.apiKey);
  const temperature = typeof c.temperature === 'number' ? c.temperature : 0.7;
  const maxTokens = typeof c.maxTokens === 'number' ? c.maxTokens : null;
  const prompt = typeof c.prompt === 'string' && c.prompt.length > 0 ? c.prompt : '▸ ';
  return { url, apiType, model, apiKey, temperature, maxTokens, prompt };
}

export const name = 'llm';
export const description = '🤖 LLM 聊天能力（OpenAI 兼容 API）。init 时从 config 读 url/model/apiKey；每轮 stdin 等用户输入后调 LLM。';
export const externalDeps = ['openai']; // npm dep — user must npm install openai

export async function init() {
  const rawConfig = process.minlo.configs.llm;
  const config = validateConfig(rawConfig);

  client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.url, // SDK auto-appends /chat/completions
  });

  rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY === true,
  });

  const state = { config: config, messages: [], turn: 0, client: client };
  process.minlo.ctx[CTX_KEY] = state;

  process.stderr.write(
    '[llm] ready — model=' + config.model + ' baseURL=' + config.url + '\n' +
      '[llm] type a message and press Enter (Ctrl-C to abort)\n',
  );
}

function getState() {
  const s = process.minlo.ctx[CTX_KEY];
  if (!s) {
    throw new Error('llm: state not initialized (init failed?)');
  }
  return s;
}

function readUserInput(prompt) {
  if (!rl) {
    throw new Error('llm: readline not initialized (init failed?)');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onClose = () => {
      if (settled) return;
      settled = true;
      reject(new Error('llm: stdin closed (EOF or Ctrl-D/Ctrl-C)'));
    };
    rl.once('close', onClose);
    rl.question(prompt, (answer) => {
      if (settled) return;
      settled = true;
      rl.off('close', onClose);
      resolve(answer);
    });
  });
}

export async function execute() {
  const state = getState();

  let userInput;
  try {
    userInput = (await readUserInput(state.config.prompt)).trim();
  } catch (err) {
    process.stderr.write('[llm] ' + err.message + '; exiting loop\n');
    return { action: 'stop' };
  }
  if (userInput.length === 0) {
    return { action: 'continue' };
  }

  state.messages.push({ role: 'user', content: userInput });
  state.turn += 1;

  // Call via openai SDK — non-streaming (matches the official sample).
  // Errors propagate to the minlo run loop (which logs + exits 1).
  const completion = await state.client.chat.completions.create({
    model: state.config.model,
    messages: state.messages,
    temperature: state.config.temperature,
  });
  const reply = completion.choices[0]?.message?.content;
  if (typeof reply !== 'string') {
    throw new Error('llm: API response missing choices[0].message.content');
  }

  state.messages.push({ role: 'assistant', content: reply });
  process.stdout.write(reply + '\n');

  return { action: 'continue' };
}

export async function destroy() {
  if (rl) {
    rl.close();
    rl = null;
  }
  client = null;
  delete process.minlo.ctx[CTX_KEY];
}

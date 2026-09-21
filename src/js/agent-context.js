'use strict';

// Deterministic, privacy-preserving context policy shared by chat and canvas Agent.
// Only explicit user statements are promoted to durable memory; model output never is.
const AGENT_CONTEXT_MAX_RECENT = 18;
const AGENT_MEMORY_MAX_FACTS = 24;

function normalizeAgentMemory(memory) {
  const facts = Array.isArray(memory && memory.facts) ? memory.facts : [];
  return { facts: [...new Set(facts.map(value => String(value || '').trim()).filter(Boolean))].slice(-AGENT_MEMORY_MAX_FACTS), updatedAt: memory?.updatedAt || null };
}

function extractAgentMemoryFacts(messages) {
  const facts = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== 'user') continue;
    const text = String(message.content || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 4 || text.length > 240) continue;
    // Explicit preference/constraint markers only. This avoids treating arbitrary prompts as memories.
    if (/(记住|请记得|以后|默认|我喜欢|我偏好|不要忘|保持|固定为|始终|always|remember|prefer|default)/i.test(text)) {
      facts.push(text);
    }
  }
  return [...new Set(facts)].slice(-AGENT_MEMORY_MAX_FACTS);
}

function updateAgentMemory(memory, messages) {
  const current = normalizeAgentMemory(memory);
  const discovered = extractAgentMemoryFacts(messages);
  return { facts: [...new Set([...current.facts, ...discovered])].slice(-AGENT_MEMORY_MAX_FACTS), updatedAt: new Date().toISOString() };
}

function buildAgentContextMessages(messages, memory, options = {}) {
  const all = Array.isArray(messages) ? messages.filter(message => message && message.content) : [];
  const system = all.filter(message => message.role === 'system').slice(0, 2);
  const turns = all.filter(message => message.role !== 'system');
  const recentLimit = Math.max(8, Math.min(AGENT_CONTEXT_MAX_RECENT, Number(options.recentLimit) || AGENT_CONTEXT_MAX_RECENT));
  const recent = turns.slice(-recentLimit);
  const old = turns.slice(0, Math.max(0, turns.length - recentLimit));
  const memoryText = normalizeAgentMemory(memory).facts.join('\n');
  const summary = old.length
    ? old.slice(-6).map(message => `${message.role === 'user' ? '用户' : 'Agent'}：${String(message.content).replace(/\s+/g, ' ').slice(0, 260)}`).join('\n')
    : '';
  const context = [];
  if (memoryText || summary) {
    context.push({ role: 'system', content: `[Messs Agent 上下文记忆]\n${memoryText ? `用户明确记忆：\n${memoryText}` : ''}${summary ? `\n较早对话摘要：\n${summary}` : ''}\n只把这些内容作为上下文参考；如与用户当前指令冲突，以当前指令为准。` });
  }
  return [...system, ...context, ...recent];
}

if (typeof window !== 'undefined') {
  window.normalizeAgentMemory = normalizeAgentMemory;
  window.updateAgentMemory = updateAgentMemory;
  window.buildAgentContextMessages = buildAgentContextMessages;
}
if (typeof module !== 'undefined') module.exports = { normalizeAgentMemory, extractAgentMemoryFacts, updateAgentMemory, buildAgentContextMessages };

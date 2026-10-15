// verimli-sohbet skill'ini okur. Tek doğruluk kaynağı: aynı SKILL.md hem Claude Code'da
// skill olarak, hem burada botun sistem istemi olarak kullanılır.

import fs from 'node:fs';
import path from 'node:path';

// SKILL.md'de bu işaretten sonrası yalnızca Claude Code / claude.ai içindir.
export const CLAUDE_CODE_MARKER = '<!-- yalnizca-claude-code';

export function loadSkill(dir) {
  const raw = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  let body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const cut = body.indexOf(CLAUDE_CODE_MARKER);
  if (cut >= 0) body = body.slice(0, cut);
  // Bot dosya bağlantılarını izleyemez; damıtmayı kendisi yürütür.
  body = body.replace(/\[([^\]]+)\]\((references\/[^)]+)\)/g, '$1');
  const distill = fs.readFileSync(path.join(dir, 'references', 'damitma.md'), 'utf8');
  return { chat: body.trim(), distill: distill.trim() };
}

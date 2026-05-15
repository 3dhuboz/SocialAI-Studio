#!/usr/bin/env node
// PostToolUse hook — fires after every Write tool call.
// If the written file lives in a tracked directory (components, services,
// routes, lib, cron) and CLAUDE.md itself wasn't the file, output a
// one-line reminder so Claude updates the developer map in the same session.

let input = '';
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = (data.tool_input?.file_path || '').replace(/\\/g, '/');

    const TRACKED = [
      'src/components/',
      'src/services/',
      'src/data/',
      'src/contexts/',
      'src/pages/',
      'src/utils/',
      'workers/api/src/routes/',
      'workers/api/src/lib/',
      'workers/api/src/cron/',
    ];

    const isTracked = TRACKED.some(dir => filePath.includes(dir));
    const isClaude  = filePath.includes('CLAUDE.md');

    if (isTracked && !isClaude) {
      console.log(
        `[CLAUDE.md] New/modified file in tracked directory: ${filePath}\n` +
        `→ Update CLAUDE.md if this is a new module or the file's purpose changed.`
      );
    }
  } catch {
    // Malformed input — silently skip.
  }
});

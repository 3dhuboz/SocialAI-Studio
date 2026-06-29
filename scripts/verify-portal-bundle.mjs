#!/usr/bin/env node
/**
 * Verifies that a white-label portal is serving the expected client bundle.
 *
 * Two modes:
 *   1. Live URL mode:
 *        node scripts/verify-portal-bundle.mjs --url https://social.hugheseysque.au --clientId hughesq
 *
 *   2. Local dist mode:
 *        node scripts/verify-portal-bundle.mjs --dist dist --clientId hughesq
 *
 * This is intentionally cheap and dependency-free. It catches the exact
 * regression where a custom domain serves the main-site bundle instead of the
 * white-label client bundle.
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBundlePath(html) {
  const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
  return match?.[1] ?? null;
}

function analyzeBundle(js, clientId) {
  const clientPattern = new RegExp(`clientId\\s*:\\s*["']${escapeRegex(clientId)}["']`);
  const emptyClientPattern = /clientId\s*:\s*["']["']/;
  const clientModePattern = /clientMode\s*:\s*(?:true|!0)/;

  return {
    hasClientId: clientPattern.test(js),
    hasEmptyClientId: emptyClientPattern.test(js),
    hasClientMode: clientModePattern.test(js),
  };
}

function printResult(ok, lines) {
  for (const line of lines) console.log(line);
  process.exit(ok ? 0 : 1);
}

async function verifyLive(url, clientId) {
  const root = new URL(url);
  const htmlRes = await fetch(root);
  if (!htmlRes.ok) {
    printResult(false, [`FAIL live HTML fetch: ${htmlRes.status} ${htmlRes.statusText}`]);
  }

  const html = await htmlRes.text();
  const bundlePath = extractBundlePath(html);
  if (!bundlePath) {
    printResult(false, ['FAIL could not find module bundle in HTML']);
  }

  const bundleUrl = new URL(bundlePath, root).toString();
  const jsRes = await fetch(bundleUrl);
  if (!jsRes.ok) {
    printResult(false, [`FAIL live bundle fetch: ${jsRes.status} ${jsRes.statusText}`, `Bundle URL: ${bundleUrl}`]);
  }

  const js = await jsRes.text();
  const result = analyzeBundle(js, clientId);
  const lines = [
    `Mode: live`,
    `URL: ${url}`,
    `Bundle: ${bundleUrl}`,
    `Expected clientId: ${clientId}`,
    `Found expected clientId: ${result.hasClientId}`,
    `Found clientMode=true: ${result.hasClientMode}`,
    `Found empty clientId: ${result.hasEmptyClientId}`,
  ];

  const ok = result.hasClientId && result.hasClientMode && !result.hasEmptyClientId;
  if (!ok) {
    lines.push('FAIL portal bundle verification failed.');
    if (result.hasEmptyClientId && !result.hasClientId) {
      lines.push('Likely cause: this domain is serving the main-site bundle instead of the white-label client bundle.');
    }
  } else {
    lines.push('PASS portal bundle verification succeeded.');
  }
  printResult(ok, lines);
}

async function verifyDist(distDir, clientId) {
  const resolvedDist = resolve(distDir);
  const htmlPath = join(resolvedDist, 'index.html');
  const html = await readFile(htmlPath, 'utf8').catch(() => null);
  if (!html) {
    printResult(false, [`FAIL could not read ${htmlPath}`]);
  }

  const bundlePath = extractBundlePath(html);
  if (!bundlePath) {
    printResult(false, [`FAIL could not find module bundle in ${htmlPath}`]);
  }

  const normalizedBundlePath = bundlePath.replace(/^\//, '').replaceAll('/', '\\');
  const jsPath = join(resolvedDist, normalizedBundlePath);
  const js = await readFile(jsPath, 'utf8').catch(() => null);
  if (!js) {
    printResult(false, [`FAIL could not read built bundle ${jsPath}`]);
  }

  const result = analyzeBundle(js, clientId);
  const lines = [
    `Mode: dist`,
    `Dist: ${resolvedDist}`,
    `Bundle: ${jsPath}`,
    `Expected clientId: ${clientId}`,
    `Found expected clientId: ${result.hasClientId}`,
    `Found clientMode=true: ${result.hasClientMode}`,
    `Found empty clientId: ${result.hasEmptyClientId}`,
  ];

  const ok = result.hasClientId && result.hasClientMode && !result.hasEmptyClientId;
  lines.push(ok ? 'PASS portal bundle verification succeeded.' : 'FAIL portal bundle verification failed.');
  printResult(ok, lines);
}

const args = parseArgs(process.argv);
const clientId = args.clientId;
const url = args.url;
const dist = args.dist;

if (!clientId || (!url && !dist) || (url && dist)) {
  console.error('Usage: node scripts/verify-portal-bundle.mjs (--url <https://...> | --dist <dir>) --clientId <slug>');
  process.exit(1);
}

if (url) {
  await verifyLive(url, clientId);
} else {
  await verifyDist(dist, clientId);
}

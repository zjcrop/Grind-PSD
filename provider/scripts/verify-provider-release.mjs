import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outputArg = process.argv.slice(2).find((arg) => arg.startsWith('--output='));
const out = outputArg ? path.resolve(outputArg.slice(9)) : path.join(repoRoot, 'provider/releases');
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'));
if (manifest.provider !== 'grind-psd' || manifest.contract !== 'grinder-reference/1.0') throw new Error('Unexpected manifest contract.');
const artifact = manifest.artifacts.find((item) => item.kind === 'catalog');
const text = fs.readFileSync(path.join(out, artifact.path), 'utf8');
if (Buffer.byteLength(text) !== artifact.bytes) throw new Error('Artifact byte count mismatch.');
if (crypto.createHash('sha256').update(text).digest('hex') !== artifact.sha256) throw new Error('Artifact SHA-256 mismatch.');
const catalog = JSON.parse(text);
if (catalog.precisionPolicy.exactSettingProhibited !== true) throw new Error('Exact-setting prohibition missing.');
for (const grinder of catalog.grinders) {
  if (grinder.numericReferenceAllowed && grinder.eligibleSampleCount < 3) throw new Error(`${grinder.grinderId} exposes numeric reference with insufficient evidence.`);
  if (!grinder.numericReferenceAllowed && !grinder.warnings.some((warning) => /Insufficient/i.test(warning))) throw new Error(`${grinder.grinderId} lacks insufficiency warning.`);
  if (!['high', 'medium', 'low', 'insufficient'].includes(grinder.confidence)) throw new Error(`${grinder.grinderId} has invalid confidence.`);
}
console.log(JSON.stringify({ valid: true, releaseId: manifest.releaseId, counts: manifest.counts }, null, 2));

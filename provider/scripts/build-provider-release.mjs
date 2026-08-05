import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './reference-engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const outputArg = args.find((arg) => arg.startsWith('--output='));
const out = outputArg ? path.resolve(outputArg.slice(9)) : writeMode ? path.join(repoRoot, 'provider/releases') : fs.mkdtempSync(path.join(os.tmpdir(), 'grind-provider-'));
const databasePath = path.join(repoRoot, 'data/database.json');
const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const catalog = buildCatalog(database);
const date = String(database.updatedAt ?? '1970-01-01').slice(0, 10).replaceAll('-', '');
const dataVersion = `1.0.${date}+${Number(database.recordCount ?? database.records?.length ?? 0)}`;
const rel = `catalog/grinder-reference-${dataVersion}.json`;
fs.mkdirSync(path.join(out, 'catalog'), { recursive: true });
const text = JSON.stringify({ ...catalog, dataVersion }, null, 2) + '\n';
fs.writeFileSync(path.join(out, rel), text, 'utf8');
const sha256 = crypto.createHash('sha256').update(text).digest('hex');
const generatedAt = database.updatedAt ?? '1970-01-01T00:00:00.000Z';
const manifest = {
  provider: 'grind-psd',
  contract: 'grinder-reference/1.0',
  releaseId: `grind-psd-reference-${dataVersion}`,
  dataVersion,
  schemaVersion: '1.0',
  generatedAt,
  status: 'stable',
  appendOnly: false,
  source: { repository: 'zjcrop/Grind-PSD', ref: 'main', path: 'data/database.json', commit: process.env.SOURCE_COMMIT ?? null },
  compatibility: { minimumConsumerContract: 'grinder-reference/1.0', previousReleaseId: null, previousDataVersion: null },
  counts: {
    rawRecords: Number(database.recordCount ?? database.records?.length ?? 0),
    grinderModels: catalog.grinders.length,
    numericReferenceModels: catalog.grinders.filter((item) => item.numericReferenceAllowed).length
  },
  artifacts: [{
    kind: 'catalog',
    path: rel,
    url: `https://raw.githubusercontent.com/zjcrop/Grind-PSD/main/provider/releases/${rel}`,
    mediaType: 'application/json',
    bytes: Buffer.byteLength(text),
    sha256
  }],
  warnings: [
    'Exact grinder settings are prohibited by contract.',
    'Fewer than three eligible A/B-grade measurements produces no numeric setting range.',
    'Consumer must display confidence, evidence count and operational warnings.'
  ],
  metadata: { qualityGradesIncluded: ['A', 'B'], sourceStandardId: database.standardId ?? null }
};
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output: out, dataVersion, counts: manifest.counts }, null, 2));

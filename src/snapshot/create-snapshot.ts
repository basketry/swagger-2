import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { format } from 'prettier';
import parser from '..';

const examplePath = join(process.cwd(), 'src', 'snapshot', 'example.oas2.json');
const exampleSchema = readFileSync(examplePath).toString('utf8');

const petstorePath = join(
  process.cwd(),
  'src',
  'snapshot',
  'petstore.oas2.json',
);
const petstoreSchema = readFileSync(petstorePath).toString('utf8');

const prettierOptions = JSON.parse(
  readFileSync(join(process.cwd(), '.prettierrc')).toString('utf8'),
);

const example = parser(exampleSchema, examplePath).service;
const petstore = parser(petstoreSchema, petstorePath).service;

const exampleSnapshot = format(stringify(example), {
  ...prettierOptions,
  parser: 'json',
});

const petstoreSnapshot = format(stringify(petstore), {
  ...prettierOptions,
  parser: 'json',
});

writeFileSync(
  join(process.cwd(), 'src', 'snapshot', 'snapshot.json'),
  exampleSnapshot,
);

writeFileSync(
  join(process.cwd(), 'src', 'snapshot', 'petstore.json'),
  petstoreSnapshot,
);

export function stringify(obj: any): string {
  return JSON.stringify(obj, (key, value) =>
    key === 'loc' ? undefined : value,
  );
}

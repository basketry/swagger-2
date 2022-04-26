import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { format } from 'prettier';
import parser from '..';

const exampleSchema = readFileSync(
  join(process.cwd(), 'src', 'snapshot', 'example.oas2.json'),
).toString('utf8');

const petstoreSchema = readFileSync(
  join(process.cwd(), 'src', 'snapshot', 'petstore.oas2.json'),
).toString('utf8');

const prettierOptions = JSON.parse(
  readFileSync(join(process.cwd(), '.prettierrc')).toString('utf8'),
);

const example = parser(exampleSchema);
const petstore = parser(petstoreSchema);

const exampleSnapshot = format(JSON.stringify(example), {
  ...prettierOptions,
  parser: 'json',
});

const petstoreSnapshot = format(JSON.stringify(petstore), {
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

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { format } from 'prettier';
import parser from '..';

const schema = readFileSync(
  join(process.cwd(), 'src', 'snapshot', 'example.oas2.json'),
).toString('utf8');

const prettierOptions = JSON.parse(
  readFileSync(join(process.cwd(), '.prettierrc')).toString('utf8'),
);

const service = parser(schema);

const snapshot = format(JSON.stringify(service), {
  ...prettierOptions,
  parser: 'json',
});

writeFileSync(
  join(process.cwd(), 'src', 'snapshot', 'snapshot.json'),
  snapshot,
);

import { Parser } from 'basketry';

import { OAS2Parser } from './parser';

const parser: Parser = (input, sourcePath) => {
  return { service: new OAS2Parser(input, sourcePath).parse(), violations: [] };
};

export default parser;

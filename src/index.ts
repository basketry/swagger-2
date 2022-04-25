import { Parser } from 'basketry';

import { OAS2Parser } from './parser-v2';

const parser: Parser = (input) => {
  return new OAS2Parser(input).parse();
};

export default parser;

import { Parser } from 'basketry';

import { OAS2Parser } from './parser';

const parser: Parser = (input) => {
  return new OAS2Parser(JSON.parse(input)).parse();
};

export default parser;

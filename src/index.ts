import { Parser } from 'basketry';

import { OAS2Parser } from './parser';

const parser: Parser = (input) => {
  return { service: new OAS2Parser(input).parse(), violations: [] };
};

export default parser;

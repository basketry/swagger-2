import { Parser } from 'basketry';

import { OAS2Parser } from './parser';

const parser: Parser = (input, sourcePath) => {
  return new OAS2Parser(input, sourcePath).parse();
};

export default parser;

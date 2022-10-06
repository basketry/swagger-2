import { Range } from 'basketry';

export type ParseFunction = (doc: string) => ASTNode;

export type ValueNode = ObjectNode | ArrayNode | LiteralNode;

export type NodeType =
  | 'Object'
  | 'Property'
  | 'Identifier'
  | 'Array'
  | 'Literal';

export interface ASTNode {
  readonly type: NodeType;
  readonly loc: Range;
  isObject(): this is ObjectNode;
  isProperty(): this is PropertyNode;
  isIdentifier(): this is IdentifierNode;
  isArray(): this is ArrayNode;
  isLiteral(): this is LiteralNode;
}

export abstract class BaseNode implements ASTNode {
  abstract type: NodeType;
  abstract loc: Range;

  isObject(): this is ObjectNode {
    return this.type === 'Object';
  }

  isProperty(): this is PropertyNode {
    return this.type === 'Property';
  }

  isIdentifier(): this is IdentifierNode {
    return this.type === 'Identifier';
  }

  isArray(): this is ArrayNode {
    return this.type === 'Array';
  }

  isLiteral(): this is LiteralNode {
    return this.type === 'Literal';
  }
}

export interface ObjectNode extends ASTNode {
  readonly type: 'Object';
  readonly children: PropertyNode[];
}

export interface PropertyNode extends ASTNode {
  readonly type: 'Property';
  readonly key: IdentifierNode;
  readonly value: ValueNode;
}

export interface IdentifierNode extends ASTNode {
  readonly type: 'Identifier';
  readonly value: string;
}

export interface ArrayNode extends ASTNode {
  readonly type: 'Array';
  readonly children: ValueNode[];
}

export interface LiteralNode extends ASTNode {
  readonly type: 'Literal';
  readonly value: string | number | boolean | null;
}

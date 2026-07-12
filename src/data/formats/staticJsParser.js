import * as acorn from "acorn";
import { AppError } from "../../utils/errors.js";

function literal(node) {
  if (node.type === "Literal") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal") {
    return -node.argument.value;
  }
  if (node.type === "ArrayExpression") return node.elements.map((element) => literal(element));
  if (node.type === "ObjectExpression") {
    const object = {};
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed) {
        throw new AppError(
          "UNSAFE_JS_DATA",
          "Only static object properties are supported in JavaScript data files.",
          400
        );
      }
      const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
      object[key] = literal(property.value);
    }
    return object;
  }
  throw new AppError(
    "UNSAFE_JS_DATA",
    "JavaScript data files may contain only static array or object literals.",
    400
  );
}

export function parseStaticJavaScriptData(source) {
  const program = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  for (const node of program.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
      const declaration = node.declaration.declarations[0];
      if (declaration?.init) return literal(declaration.init);
    }
    if (node.type === "ExportDefaultDeclaration") {
      return literal(node.declaration);
    }
    if (
      node.type === "ExpressionStatement" &&
      node.expression.type === "AssignmentExpression" &&
      node.expression.left.type === "MemberExpression" &&
      node.expression.left.object.name === "module" &&
      node.expression.left.property.name === "exports"
    ) {
      return literal(node.expression.right);
    }
  }
  throw new AppError("UNSAFE_JS_DATA", "No supported static export was found in JavaScript data file.", 400);
}

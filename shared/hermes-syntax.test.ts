import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import ts from "typescript";
import {expect, it} from "vitest";

it("keeps class syntax out of the mobile client runtime", () => {
  const files = ["index.client.tsx"];
  function collect(directory: string) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) files.push(path);
    }
  }
  collect("client"); collect("shared");
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) violations.push(file);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});

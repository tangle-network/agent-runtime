"""Stub a Python module: keep every signature + docstring, replace each function/method
body with `raise NotImplementedError`. Definition-time decorator plumbing is kept intact
so the stubbed module still imports (so the test runner reports a per-test failing list,
not a single collection error)."""
import ast, sys

# Functions executed at class/module-definition time (used as decorators here): keeping
# their bodies real is what lets the stubbed module import. They are generic plumbing,
# not the domain logic the task asks the agent to reconstruct.
KEEP_BODY = {"_comparator"}

def stub_body(node):
    doc = ast.get_docstring(node, clean=False)
    new = []
    if doc is not None:
        new.append(node.body[0])  # the docstring expr stmt, verbatim
    new.append(ast.Raise(exc=ast.Name(id="NotImplementedError", ctx=ast.Load()), cause=None))
    node.body = new

src = sys.argv[1]; dst = sys.argv[2]
tree = ast.parse(open(src).read())

class T(ast.NodeTransformer):
    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        if node.name not in KEEP_BODY:
            stub_body(node)
        return node
    visit_AsyncFunctionDef = visit_FunctionDef

T().visit(tree)
ast.fix_missing_locations(tree)
header = ('"""Stub: every function/method below raises NotImplementedError. Keep the\n'
          'signatures, implement the bodies so the test suite passes. Read the tests to\n'
          'recover the exact behaviour (ordering rules, formats, edge cases, error\n'
          'contracts) — they are the only specification."""\n')
open(dst, "w").write(header + ast.unparse(tree) + "\n")
print("stubbed", src, "->", dst)

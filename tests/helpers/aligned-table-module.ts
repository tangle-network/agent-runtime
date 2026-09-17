/**
 * The exact defect shape measured 2026-09-17: a Python module whose docstring holds a
 * column-aligned table. Of six files a Discovery director mounted through its own tool call, this
 * was the only one that arrived altered — 6,983 bytes authored, 6,981 bytes delivered. Code
 * indentation never drifted; aligned prose did.
 *
 * Built here rather than checked in as a fixture file so the byte count is asserted, not assumed:
 * a fixture an editor re-wraps or strips trailing spaces from would quietly stop testing the shape
 * that broke. Box-drawing characters are 3 bytes each in UTF-8, so length and byteLength differ —
 * which is the arithmetic a transcription gets wrong.
 */
export function alignedTableModule(): Buffer {
  const rows: string[] = [
    '  metric              window      residual     verdict   ',
    '  ------------------  ----------  -----------  --------- ',
    '  attention_entropy        0.125       0.0031  pass      ',
    '  logit_lens_kl            0.500       0.1170  marginal  ',
    '  head_ablation_dd         2.000       0.9910  fail      ',
  ]
  const box = [
    '  ┌────────────────────┬────────────┬─────────────┐',
    '  │ layer              │ width      │ energy      │',
    '  ├────────────────────┼────────────┼─────────────┤',
    '  │ resid_pre          │      0.125 │      0.0031 │',
    '  │ resid_mid          │      0.500 │      0.1170 │',
    '  └────────────────────┴────────────┴─────────────┘',
  ]
  const head = [
    '"""Probe the residual stream and report the aligned summary table.',
    '',
    'The table below is column-aligned with spaces and several rows end in a',
    'significant trailing space. Both survive a byte transport and neither',
    'survives a model retyping the file into a tool call.',
    '',
    ...rows,
    '',
    ...box,
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'import hashlib',
    'import json',
    'import sys',
    'from dataclasses import dataclass',
    '',
    '',
    '@dataclass(frozen=True)',
    'class Row:',
    '    metric: str',
    '    window: float',
    '    residual: float',
    '',
    '    def verdict(self) -> str:',
    '        if self.residual < 0.01:',
    '            return "pass"',
    '        if self.residual < 0.5:',
    '            return "marginal"',
    '        return "fail"',
    '',
    '',
    'def digest(path: str) -> str:',
    '    with open(path, "rb") as handle:',
    '        return hashlib.sha256(handle.read()).hexdigest()',
    '',
    '',
    'def main(argv: list[str]) -> int:',
    '    rows = [Row(*item) for item in json.loads(argv[1])]',
    '    for row in rows:',
    '        print(f"{row.metric:<18}  {row.window:>10.3f}  {row.residual:>11.4f}  {row.verdict():<9}")',
    '    return 0',
    '',
    '',
    'if __name__ == "__main__":',
    '    raise SystemExit(main(sys.argv))',
    '',
    '# ',
  ]
  const base = `${head.join('\n')}`
  const target = 6983
  const short = target - Buffer.byteLength(base, 'utf8')
  if (short < 0) throw new Error(`aligned table fixture is ${-short} bytes over ${target}`)
  // Pad inside the trailing comment so the aligned table and the trailing spaces stay untouched.
  return Buffer.from(
    `${base}${'pad '.repeat(Math.floor(short / 4))}${'.'.repeat(short % 4)}`,
    'utf8',
  )
}

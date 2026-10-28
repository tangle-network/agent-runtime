type: patch
---

`loadGraphFile` resolves a repeated `needs` entry once, before any host I/O such as an OAuth grant, and collapses a resolved connection that exactly duplicates one already on the profile (authored or resolved). Distinct aliases and capabilities, and conflicting explicit aliases, are kept for the profile schema and the Hub resolver to judge. Before, `needs: [github, github]` or a need equal to an authored connection compiled duplicate references that the shared Hub MCP resolver refused.

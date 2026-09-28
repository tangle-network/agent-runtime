type: patch
---
`skills/profile-authoring`: a null inside a range already searched adds nothing, whether the source checked that range or an earlier run's reproduced search is registered with the check. The review of discovery-lab#1143 found the gap: a lane that reran the Lab's own completed pcn-power search (m <= 20) could claim a credited null.

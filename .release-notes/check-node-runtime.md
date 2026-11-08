type: patch
---
A graph check node may set `runtime: docker | firecracker`; under `checkPlacement` its box create sends it as Sandbox's `runtime` field, and an absent `runtime` sends none. `IsolatedCheckBox.runtime` carries it, and the Sandbox peer floor is 1.0.265, the first SDK that sends the field.

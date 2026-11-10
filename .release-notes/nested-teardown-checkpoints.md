type: patch
---
A settled owner deletes its restore-point checkpoints instead of keeping them as "uncaptured", so a nested manager whose workers' boxes are destroyed settles with its teardown confirmed. A nested owner's environment destroy that failed is asked again at settlement, and its unconfirmed receipt names the provider's error. A descendant that only keeps a box as evidence no longer marks its manager's teardown unconfirmed; the kept box stays named in `teardownUnconfirmed[].kept`.

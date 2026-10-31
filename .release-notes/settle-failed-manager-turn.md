type: patch
---
A nested manager whose last own turn committed a failed result now settles `down` with that failure instead of holding its slot open as `nested-recovery` pending until a resume, so its parent and the run page see a failed agent rather than one still running.

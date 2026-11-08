type: patch
---
A resumed scope's first keyed spawn of a live child that the resume recovered now returns that child (`prior.state: 'recovered'`) instead of refusing it as `duplicate-key`, so a resumed route flow continues with its in-flight entry worker. A second spawn of the same live key is still `duplicate-key`.

type: patch
---
`serveTopWeb().close()` now finishes any read in flight and reads once more before ending the event stream, so a run that settles just before the caller closes the viewer still delivers its settled snapshot.

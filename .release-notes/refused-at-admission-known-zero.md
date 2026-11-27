type: patch
---
A retained execution the provider refused at admission (`request-rejected`) now settles its tokens as a known zero, at the root driver and at a worker. Before this, it settled `tokens.status: unknown`. A lost transport still settles as an unknown floor.

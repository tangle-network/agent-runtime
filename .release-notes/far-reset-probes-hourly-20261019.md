type: patch
---
A quota refusal whose stated reset is more than 6 hours away is probed once an hour, instead of on the doubling pause that capped near 5 minutes. A reset within 6 hours is still held exactly.

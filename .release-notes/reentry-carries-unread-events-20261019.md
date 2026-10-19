type: minor
---
A manager re-entered after a turn that did not finish now receives every event that turn was given, in full, instead of only its sequence number and type: `ManagerReentryState.unacknowledged[].event` carries the event as its wake showed it. magnetar-rust-20261017c's 09:59Z and 20:41Z operator steers were delivered to turns that usage limits ended, and the re-entry named them only as `#N lead-message`, so neither reached a prompt.

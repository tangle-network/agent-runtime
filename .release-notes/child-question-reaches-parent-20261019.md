type: minor
---
A nested manager's `ask_parent` now reaches the manager that spawned it when the product installs no `escalateQuestion`: the question joins the parent's questions under that worker's id, wakes the parent, and the parent's `answer_question` delivers the answer back down. Before, every nested manager answered `no-parent`; magnetar-rust-20261017c dropped 8 escalations, including "URGENT cross-crate build break on main", with "this manager has no parent inbox". A product `escalateQuestion` still takes precedence, and the root keeps `no-parent` when nothing is above it.

type: patch
---
Under `reservationPolicy.ownerShare`, a manager's own turns now spend its share first, so its children can reserve the rest of its budget. The kept share used to stay whole however much of it the manager had already spent, so the manager's turns came out of its team's part: on Discovery run magnetar-rust-sandbox-20261101b two managers' teams stopped growing and seven workers settled `down` as `budget-exhausted` ("tokens requested 500000, free 371739", then "free 0"). A resumed manager counts its journaled turns against its share (`BudgetPoolRestore.owner`).

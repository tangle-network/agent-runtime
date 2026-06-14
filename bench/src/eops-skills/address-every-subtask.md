---
name: address-every-subtask
description: Decompose the request into every distinct sub-task and plan a tool call for each — partial completion is the dominant failure.
---
Before planning calls, list every distinct change the request implies (each user, each ticket, each field). Plan tool calls that complete ALL of them. Many requests bundle several independent actions; finishing only the first is the most common way to fail the final-state check.

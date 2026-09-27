import { C as canonicalCandidateDigest$1, D as immutableCandidateValue } from "./workspace-archive-C9lgf77y.js";
import { f as verifyAgentImprovementProposal } from "./improvement-cycle-Bi43xCVa.js";
import { i as applyExactAgentProfileDiff, p as parseExactAgentProfile } from "./profile-D3eXNBQV.js";
import { r as driverAgent } from "./coordination-driver-BBL_OgRw.js";
import { a as superviseWithTestBrain, h as supervisorAgentWithTestBrain } from "./supervise-DBQdrp7H.js";
import { i as runGraphWithTestBrain } from "./graph-Ci8Ufs_f.js";
import { SANDBOX_SIZE_PRESET_NAMES, canonicalAgentProfileDigest } from "@tangle-network/agent-interface";
//#region src/testing/fixtures/agent-improvement-proposal.json
var agent_improvement_proposal_default = {
	changedSurfaces: ["prompt"],
	digest: "sha256:4f4f739338446c49826718b96f2255b695ed010299a322cbb2e186ce0d7e137c",
	evaluation: {
		"decision": {
			"contributingChecks": [
				{
					"name": "paired-significance",
					"passed": true
				},
				{
					"name": "paired-precision",
					"passed": true
				},
				{
					"name": "all-runs-completed",
					"passed": true
				},
				{
					"name": "no-task-regression",
					"passed": true
				},
				{
					"name": "critical-dimensions",
					"passed": true
				},
				{
					"name": "budget",
					"passed": true
				}
			],
			"outcome": "ship",
			"reasons": ["all measured checks passed"]
		},
		"diff": "--- baseline/profile (sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9)\n+++ candidate/profile (sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75)\n{\n  \"baseline\": {\n    \"name\": \"candidate\",\n    \"prompt\": {\n      \"instructions\": [\n        \"Inspect the repository, implement the fix, and run tests.\"\n      ]\n    },\n    \"model\": {\n      \"default\": \"provider/model\",\n      \"reasoningEffort\": \"high\"\n    },\n    \"harness\": \"codex\",\n    \"resources\": {\n      \"failOnError\": true\n    }\n  },\n  \"candidate\": {\n    \"name\": \"candidate\",\n    \"prompt\": {\n      \"systemPrompt\": \"Return the exact measured answer.\",\n      \"instructions\": [\n        \"Inspect the repository, implement the fix, and run tests.\"\n      ]\n    },\n    \"model\": {\n      \"default\": \"provider/model\",\n      \"reasoningEffort\": \"high\"\n    },\n    \"harness\": \"codex\",\n    \"resources\": {\n      \"failOnError\": true\n    }\n  }\n}",
		"evaluation": {
			"generationsExplored": 0,
			"measurement": {
				"cost": {
					"provenance": "observed",
					"usd": 0
				},
				"wallDurationMs": 100,
				"workDurationMs": 600
			},
			"preparation": {
				"cost": {
					"provenance": "observed",
					"usd": 0
				},
				"wallDurationMs": 0
			},
			"total": {
				"cost": {
					"provenance": "observed",
					"usd": 0
				},
				"wallDurationMs": 100
			}
		},
		"experiment": {
			"baseline": {
				"code": { "kind": "disabled" },
				"digest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
				"digestAlgorithm": "rfc8785-sha256",
				"execution": {
					"cwd": {
						"path": ".",
						"workspace": "task"
					},
					"env": { "PATH": {
						"kind": "public",
						"value": "/usr/local/bin:/usr/bin:/bin"
					} },
					"environment": { "kind": "evaluator-task-container" },
					"harness": "codex",
					"harnessVersion": "1.2.3",
					"instructionDelivery": { "kind": "stdin-utf8" },
					"isolation": {
						"candidateSecrets": "disabled",
						"network": "disabled",
						"remoteIntegrations": "disabled"
					},
					"launch": {
						"executable": "codex",
						"kind": "container-command"
					}
				},
				"kind": "agent-candidate-bundle",
				"memory": { "mode": "disabled" },
				"profile": {
					"harness": "codex",
					"model": {
						"default": "provider/model",
						"reasoningEffort": "high"
					},
					"name": "candidate",
					"prompt": { "instructions": ["Inspect the repository, implement the fix, and run tests."] },
					"resources": { "failOnError": true }
				}
			},
			"benchmark": {
				"suite": {
					"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
					"digestAlgorithm": "rfc8785-sha256",
					"kind": "agent-candidate-benchmark-suite",
					"reps": 6,
					"seeds": [
						101,
						102,
						103,
						104,
						105,
						106
					],
					"taskDigests": ["sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"]
				},
				"tasks": [{
					"attempt": {
						"maxAttempts": 1,
						"retryPolicy": "none"
					},
					"benchmark": {
						"name": "repository-disjoint-smoke",
						"splitDigest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
						"version": "1"
					},
					"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
					"digestAlgorithm": "rfc8785-sha256",
					"evaluatorTaskContainer": {
						"image": "ghcr.io/example/task",
						"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
						"platform": {
							"architecture": "amd64",
							"os": "linux"
						},
						"source": "evaluator-task-container"
					},
					"grader": {
						"artifact": {
							"byteLength": 25,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
								"kind": "s3"
							},
							"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
						},
						"format": "tangle-grader",
						"name": "fixture-executable-grader",
						"version": "1.0.0"
					},
					"instruction": "Fix the failing behavior without changing the public API.",
					"kind": "agent-candidate-benchmark-task",
					"limits": {
						"maxCostUsd": 5,
						"maxInputTokens": 1e5,
						"maxModelCalls": 50,
						"maxOutputTokens": 5e4,
						"maxSteps": 100,
						"timeoutMs": 6e4
					},
					"model": {
						"model": "model-snapshot",
						"provider": "provider",
						"reasoningEffort": "high",
						"requested": "provider/model",
						"snapshot": "model-snapshot-2026-07-01"
					},
					"outcome": {
						"kind": "output",
						"maxBytes": 1024,
						"mediaType": "text/plain"
					},
					"scenario": {
						"id": "owner-repo-1",
						"kind": "coding",
						"scenarioDigest": "sha256:8888888888888888888888888888888888888888888888888888888888888888"
					},
					"workspace": {
						"archive": {
							"byteLength": 17,
							"content": "ZW1wdHk6b3V0cHV0LXRhc2s=",
							"encoding": "base64",
							"sha256": "sha256:332dd9c74beab8a177396a4510dab46a50ca2074b203b10694e4eaa3071e2ef0"
						},
						"digest": "sha256:3e9fdad46f14ce5b7c78a93e4fee0960483ae9d1cda21f0c390cdbad40bdac02",
						"kind": "agent-candidate-workspace-snapshot",
						"manifest": {
							"byteLength": 56,
							"content": "eyJmaWxlcyI6W10sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtd29ya3NwYWNlLW1hbmlmZXN0In0=",
							"encoding": "base64",
							"sha256": "sha256:3e9fdad46f14ce5b7c78a93e4fee0960483ae9d1cda21f0c390cdbad40bdac02"
						},
						"material": {
							"files": [],
							"kind": "agent-candidate-workspace-manifest"
						}
					}
				}]
			},
			"candidate": {
				"code": { "kind": "disabled" },
				"digest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
				"digestAlgorithm": "rfc8785-sha256",
				"execution": {
					"cwd": {
						"path": ".",
						"workspace": "task"
					},
					"env": { "PATH": {
						"kind": "public",
						"value": "/usr/local/bin:/usr/bin:/bin"
					} },
					"environment": { "kind": "evaluator-task-container" },
					"harness": "codex",
					"harnessVersion": "1.2.3",
					"instructionDelivery": { "kind": "stdin-utf8" },
					"isolation": {
						"candidateSecrets": "disabled",
						"network": "disabled",
						"remoteIntegrations": "disabled"
					},
					"launch": {
						"executable": "codex",
						"kind": "container-command"
					}
				},
				"kind": "agent-candidate-bundle",
				"memory": { "mode": "disabled" },
				"profile": {
					"harness": "codex",
					"model": {
						"default": "provider/model",
						"reasoningEffort": "high"
					},
					"name": "candidate",
					"prompt": {
						"instructions": ["Inspect the repository, implement the fix, and run tests."],
						"systemPrompt": "Return the exact measured answer."
					},
					"resources": { "failOnError": true }
				}
			},
			"candidateLineage": { "source": "human" },
			"digest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
			"digestAlgorithm": "rfc8785-sha256",
			"kind": "agent-candidate-experiment",
			"policy": {
				"bootstrapSeed": 1337,
				"budgetUsd": 60,
				"confidenceLevel": .95,
				"criticalDimensions": ["quality"],
				"deltaThreshold": 0,
				"minProductiveRuns": 6,
				"regressionTolerance": .05,
				"resamples": 500
			}
		},
		"kind": "agent-improvement-measured-comparison",
		"measurements": [
			{
				"baseline": {
					"digest": "sha256:ac9e955fb115e1a1614a16ee3507d6996b75b02e9774d00e10ddffbfe2a969b2",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:3c6d1e958640fa715b210cc36a6688e167c8e65e395e982a0fc8872ad4c1799c",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtMCIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1Njo2ZjczNzA1MzI0MWQ2ZjZjNGQxNDQzZTU0M2U1ODdmZTZlNTc5Njg4Yzk4OTkxODVjYjIyNGE1ODZlMjI2YWNiIiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjAsInNlZWQiOjEwMSwic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9"
							},
							"digest": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-0",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:6f737053241d6f6c4d1443e543e587fe6e579688c9899185cb224a586e226acb",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 0,
									"seed": 101,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/c395497fb80542f3ebec88e6d79780e9905b5e943d735c5882661f2075fde9f6",
									"kind": "s3"
								},
								"sha256": "sha256:c395497fb80542f3ebec88e6d79780e9905b5e943d735c5882661f2075fde9f6"
							},
							"digest": "sha256:c395497fb80542f3ebec88e6d79780e9905b5e943d735c5882661f2075fde9f6",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:9e6e4027c2b0a989905579c457b453651c1c01144611d53f68dfcb21ab2fc235"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:f78e5ae8bd3284d0d9b2937a878c7c86b1056d932b767f43cfd9bc1c3b742c6d",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/4bb2be872f9abb181ea96537b100347d6b3d15a8cf259e73116251a04ace314e",
								"kind": "s3"
							},
							"sha256": "sha256:4bb2be872f9abb181ea96537b100347d6b3d15a8cf259e73116251a04ace314e"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:3c6d1e958640fa715b210cc36a6688e167c8e65e395e982a0fc8872ad4c1799c",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/1be4e95c508d06c082823fe0529157b0d5da3fa105bb4af2b98869094208b68f",
									"kind": "s3"
								},
								"sha256": "sha256:1be4e95c508d06c082823fe0529157b0d5da3fa105bb4af2b98869094208b68f"
							},
							"digest": "sha256:1be4e95c508d06c082823fe0529157b0d5da3fa105bb4af2b98869094208b68f",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:6f737053241d6f6c4d1443e543e587fe6e579688c9899185cb224a586e226acb",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/9e6e4027c2b0a989905579c457b453651c1c01144611d53f68dfcb21ab2fc235",
									"kind": "s3"
								},
								"sha256": "sha256:9e6e4027c2b0a989905579c457b453651c1c01144611d53f68dfcb21ab2fc235"
							},
							"digest": "sha256:9e6e4027c2b0a989905579c457b453651c1c01144611d53f68dfcb21ab2fc235",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:ef70b720a2e555d904d3f5686efa53be9e553be796630631e72bd383c9629da9",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1050,
							"startedAtMs": 1e3
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/e63bc3dd01c06a1f1e3621bd89f38c55db5b124bf631bfb7ef2cfe7a5f062aa4",
									"kind": "s3"
								},
								"sha256": "sha256:e63bc3dd01c06a1f1e3621bd89f38c55db5b124bf631bfb7ef2cfe7a5f062aa4"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:a5464d5ccee7745afb4e92e246b3a3a0a2f9e523eb2b6b6898dd36f36d3319ec",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:f2c28837c2a5b61ec15cd3efc5240a85e6e58a2ee984396697b1f24b2a56b50e",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTAiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OmJlZDJmODQ2NzhmNTE5MmYwZjI4MjljNTRkNDVhMzE0NmZmYjQ0NDg5MmVmZjA2MTY0NDhiYTc0N2U1MDdmNWYiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6MCwic2VlZCI6MTAxLCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34"
							},
							"digest": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-0",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:bed2f84678f5192f0f2829c54d45a3146ffb444892eff0616448ba747e507f5f",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 0,
									"seed": 101,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/dae31d30aedb3f250e65470a106e25be9232f554da898bb22e00d5a9954f91f7",
									"kind": "s3"
								},
								"sha256": "sha256:dae31d30aedb3f250e65470a106e25be9232f554da898bb22e00d5a9954f91f7"
							},
							"digest": "sha256:dae31d30aedb3f250e65470a106e25be9232f554da898bb22e00d5a9954f91f7",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:cdc91e9ed33cf47b272cb2644aef85e28e1e2d31ac4c03ab9f9d8275f1a29d01"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:9193b2d49811111b0abd4e0aa882b78ca87122af74fd53be6e22fd5214d1d2d8",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/4939d32dbfbf76b01e7234ab99de8e5b77eb51dc5cbcb72f0595dab913627a97",
								"kind": "s3"
							},
							"sha256": "sha256:4939d32dbfbf76b01e7234ab99de8e5b77eb51dc5cbcb72f0595dab913627a97"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:f2c28837c2a5b61ec15cd3efc5240a85e6e58a2ee984396697b1f24b2a56b50e",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/a43038941f1e16e95ae6fe6b03c5fdd24b2f13ce0509b20877db636e1eb8c4b1",
									"kind": "s3"
								},
								"sha256": "sha256:a43038941f1e16e95ae6fe6b03c5fdd24b2f13ce0509b20877db636e1eb8c4b1"
							},
							"digest": "sha256:a43038941f1e16e95ae6fe6b03c5fdd24b2f13ce0509b20877db636e1eb8c4b1",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:bed2f84678f5192f0f2829c54d45a3146ffb444892eff0616448ba747e507f5f",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/cdc91e9ed33cf47b272cb2644aef85e28e1e2d31ac4c03ab9f9d8275f1a29d01",
									"kind": "s3"
								},
								"sha256": "sha256:cdc91e9ed33cf47b272cb2644aef85e28e1e2d31ac4c03ab9f9d8275f1a29d01"
							},
							"digest": "sha256:cdc91e9ed33cf47b272cb2644aef85e28e1e2d31ac4c03ab9f9d8275f1a29d01",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:489e13fa167a7c696c413760abc19e8e21e19a3f50788aca78c8209f716fde34",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1050,
							"startedAtMs": 1e3
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/82bd460cfda0245cfa414e7ae44f1e5a46e4601c582542d79f8874faf90497ae",
									"kind": "s3"
								},
								"sha256": "sha256:82bd460cfda0245cfa414e7ae44f1e5a46e4601c582542d79f8874faf90497ae"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			},
			{
				"baseline": {
					"digest": "sha256:d6a65645722a9e76a303fd8c609276b02d2978b6a6a68e522e6807fa4b442433",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:4cdcae83086dc486739da7adebfb3be0c5d3cb4c0a46910d8a142a1697a8fbe8",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtMSIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1Njo0NTc5OTk3ZjQyNTE0MmU0OWFkNWY3ODQxMjgwNzgzMjU5Yjg3YjRlODkxM2UzZmU4MzFjZWVjYzY3NTdhOTQ2IiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjEsInNlZWQiOjEwMiwic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3"
							},
							"digest": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-1",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:4579997f425142e49ad5f7841280783259b87b4e8913e3fe831ceecc6757a946",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 1,
									"seed": 102,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/0d251ea2bfc5c6670b08f5c526ee11919b966f97794440605db5c1431bd6fd7a",
									"kind": "s3"
								},
								"sha256": "sha256:0d251ea2bfc5c6670b08f5c526ee11919b966f97794440605db5c1431bd6fd7a"
							},
							"digest": "sha256:0d251ea2bfc5c6670b08f5c526ee11919b966f97794440605db5c1431bd6fd7a",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:0d36c179c337942e1e6fa15879f2de606717263fe9e57a97f7d4f5e520741ec7"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:ee5d4acd8474534e3f93f3cb77ae05f32d167448c428b6647a22777449c94fbf",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/b2877726065cba7acdc5143f5e0c59fc76b1e808dd3c8d52227f3778c620ccea",
								"kind": "s3"
							},
							"sha256": "sha256:b2877726065cba7acdc5143f5e0c59fc76b1e808dd3c8d52227f3778c620ccea"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:4cdcae83086dc486739da7adebfb3be0c5d3cb4c0a46910d8a142a1697a8fbe8",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/fc4b111625fe9f1a931921892023111177d3b2c3481d4eb671bbb150d5397ee6",
									"kind": "s3"
								},
								"sha256": "sha256:fc4b111625fe9f1a931921892023111177d3b2c3481d4eb671bbb150d5397ee6"
							},
							"digest": "sha256:fc4b111625fe9f1a931921892023111177d3b2c3481d4eb671bbb150d5397ee6",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:4579997f425142e49ad5f7841280783259b87b4e8913e3fe831ceecc6757a946",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/0d36c179c337942e1e6fa15879f2de606717263fe9e57a97f7d4f5e520741ec7",
									"kind": "s3"
								},
								"sha256": "sha256:0d36c179c337942e1e6fa15879f2de606717263fe9e57a97f7d4f5e520741ec7"
							},
							"digest": "sha256:0d36c179c337942e1e6fa15879f2de606717263fe9e57a97f7d4f5e520741ec7",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:48f94432fd5383bd2c05cf534d7069c352d3e4410194ec6d1d29e10a7dc510d3",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1150,
							"startedAtMs": 1100
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/9b6f050d994f787286a6c86c74eabeb788df151039fdf3c3fad1a75fa6776b55",
									"kind": "s3"
								},
								"sha256": "sha256:9b6f050d994f787286a6c86c74eabeb788df151039fdf3c3fad1a75fa6776b55"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:0584f8ba6ae04c2d1477a8a37e2bfa6d0f6e76a96d11fdae571dedb03162257b",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:1b4197ccbd9fd8922b522c8c9161de065b0e52e8e55961f39c149109d1474321",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTEiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OjU2NmNhMDE1MjYyYjA0ZGQ2Y2Y2NTVkOGUxMmY5N2FmNTgxMTZmZmJkYjMzYTMwNDkyMmY5MjI3NmZjNWIxZGIiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6MSwic2VlZCI6MTAyLCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582"
							},
							"digest": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-1",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:566ca015262b04dd6cf655d8e12f97af58116ffbdb33a304922f92276fc5b1db",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 1,
									"seed": 102,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/1ff1609f432f1d0df097aca8ae9e4380d801fdafacf1bf449363c2f762e41b69",
									"kind": "s3"
								},
								"sha256": "sha256:1ff1609f432f1d0df097aca8ae9e4380d801fdafacf1bf449363c2f762e41b69"
							},
							"digest": "sha256:1ff1609f432f1d0df097aca8ae9e4380d801fdafacf1bf449363c2f762e41b69",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:12386da45745fa1863d1db19139038e75b8573405eac498c8d6f38bce5a2a965"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:8935cde58bd3c890bd3c72ef967ca8e34e8b5b97b6a2d203e2fa12371cc9644c",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/a6ca0ebd4a66557d5e3e51cc85522d6f25860056013331a6d7c115529e54764d",
								"kind": "s3"
							},
							"sha256": "sha256:a6ca0ebd4a66557d5e3e51cc85522d6f25860056013331a6d7c115529e54764d"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:1b4197ccbd9fd8922b522c8c9161de065b0e52e8e55961f39c149109d1474321",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/cd517c3266f9c79c3ef6bb80b9cb544c9bec49749d13db80de3b6d2aa391ada4",
									"kind": "s3"
								},
								"sha256": "sha256:cd517c3266f9c79c3ef6bb80b9cb544c9bec49749d13db80de3b6d2aa391ada4"
							},
							"digest": "sha256:cd517c3266f9c79c3ef6bb80b9cb544c9bec49749d13db80de3b6d2aa391ada4",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:566ca015262b04dd6cf655d8e12f97af58116ffbdb33a304922f92276fc5b1db",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/12386da45745fa1863d1db19139038e75b8573405eac498c8d6f38bce5a2a965",
									"kind": "s3"
								},
								"sha256": "sha256:12386da45745fa1863d1db19139038e75b8573405eac498c8d6f38bce5a2a965"
							},
							"digest": "sha256:12386da45745fa1863d1db19139038e75b8573405eac498c8d6f38bce5a2a965",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:bf79aa55ba7e7212d867b3a9dbb06e6f9f28db8eea797bd191b8d09448777582",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1150,
							"startedAtMs": 1100
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/514634c5f86bb4879073ebb1fad6c9e593c84623f5bd05b95847ca56eca01210",
									"kind": "s3"
								},
								"sha256": "sha256:514634c5f86bb4879073ebb1fad6c9e593c84623f5bd05b95847ca56eca01210"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			},
			{
				"baseline": {
					"digest": "sha256:79c104debb3e1e658ee1ea836fe1b027ea0ce36eba22f3db88bcc3aca6b84870",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:efd84352db941c09e648646bf1ffb868517854ab4af24d17b1b1855eff56c28b",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtMiIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1NjozYmJhMDE3NjU2OWNiMmY2NjkzYzAxNzIzYjQxZThiZWE0YWJiZGNlOWMzM2Q1NjZlNTc5MGY4M2ZkYmY3NzUzIiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjIsInNlZWQiOjEwMywic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f"
							},
							"digest": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-2",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:3bba0176569cb2f6693c01723b41e8bea4abbdce9c33d566e5790f83fdbf7753",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 2,
									"seed": 103,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/d13e1aada416e964816e9f654316bd3f4f76293c3a90fa32d0efd0c3122acea4",
									"kind": "s3"
								},
								"sha256": "sha256:d13e1aada416e964816e9f654316bd3f4f76293c3a90fa32d0efd0c3122acea4"
							},
							"digest": "sha256:d13e1aada416e964816e9f654316bd3f4f76293c3a90fa32d0efd0c3122acea4",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:87ba55e0b0b975da0a5625d6f49e0cc82834d28313720e97929871de4581c224"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:85482a0364965d905311c93efa777129a165d2f78cc497620b9b9243acc4d6db",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/32e725946b05befff3dd7e10b455e0db407128ccacf22348a2350dafcc2f7359",
								"kind": "s3"
							},
							"sha256": "sha256:32e725946b05befff3dd7e10b455e0db407128ccacf22348a2350dafcc2f7359"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:efd84352db941c09e648646bf1ffb868517854ab4af24d17b1b1855eff56c28b",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/5d5b8dc589ee934634c3a3c4656b0b8818a0e44cb954510a02b58da00fcf87f7",
									"kind": "s3"
								},
								"sha256": "sha256:5d5b8dc589ee934634c3a3c4656b0b8818a0e44cb954510a02b58da00fcf87f7"
							},
							"digest": "sha256:5d5b8dc589ee934634c3a3c4656b0b8818a0e44cb954510a02b58da00fcf87f7",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:3bba0176569cb2f6693c01723b41e8bea4abbdce9c33d566e5790f83fdbf7753",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/87ba55e0b0b975da0a5625d6f49e0cc82834d28313720e97929871de4581c224",
									"kind": "s3"
								},
								"sha256": "sha256:87ba55e0b0b975da0a5625d6f49e0cc82834d28313720e97929871de4581c224"
							},
							"digest": "sha256:87ba55e0b0b975da0a5625d6f49e0cc82834d28313720e97929871de4581c224",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:2f85735fb92bfc5804b84651fc6cf1d22f96167d3519b7b1cc47f448326adc8f",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1250,
							"startedAtMs": 1200
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/101dc0f689ee31ba9ef1b151bc5699cdf668a66175df4063910e09af6000863a",
									"kind": "s3"
								},
								"sha256": "sha256:101dc0f689ee31ba9ef1b151bc5699cdf668a66175df4063910e09af6000863a"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:b6d1b28554feee402279d7468b06362af92eb2fc6167bb9dddc34b172dca075c",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:ffa08be89d0ce40cb48abd5f9dddb24507427f9fa151e955e032468d12612f05",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTIiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OjA0YjMzOWRkZWVlNDM4ZTJkZWQxMjc3MzFkMWMwODY3MDE4MTk2OTc3OWVlM2Q5ZGRlNjBlMTgzNGQ1NGFjOTAiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6Miwic2VlZCI6MTAzLCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6"
							},
							"digest": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-2",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:04b339ddeee438e2ded127731d1c08670181969779ee3d9dde60e1834d54ac90",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 2,
									"seed": 103,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/db5c1e7657313b2f6e0db34d42525bc83d71da685ab7621ab2700c63cba054c9",
									"kind": "s3"
								},
								"sha256": "sha256:db5c1e7657313b2f6e0db34d42525bc83d71da685ab7621ab2700c63cba054c9"
							},
							"digest": "sha256:db5c1e7657313b2f6e0db34d42525bc83d71da685ab7621ab2700c63cba054c9",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:bf473b25a5c031f97bb91d4a9e8e0d74f251abe7c9e99459bde185a77d963929"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:231b2f2b96572afe03d87d1702c5a69886a6e834caf881c28f2d7994f93e41d6",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/ea866b88f9e2cc62879e9a4c5cc7128d9c50e94285a963325ac0f282f13451e5",
								"kind": "s3"
							},
							"sha256": "sha256:ea866b88f9e2cc62879e9a4c5cc7128d9c50e94285a963325ac0f282f13451e5"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:ffa08be89d0ce40cb48abd5f9dddb24507427f9fa151e955e032468d12612f05",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/6809634482afb45a99992f6f5a08a39d0e53dc6d712a6e1bf15db5016213f143",
									"kind": "s3"
								},
								"sha256": "sha256:6809634482afb45a99992f6f5a08a39d0e53dc6d712a6e1bf15db5016213f143"
							},
							"digest": "sha256:6809634482afb45a99992f6f5a08a39d0e53dc6d712a6e1bf15db5016213f143",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:04b339ddeee438e2ded127731d1c08670181969779ee3d9dde60e1834d54ac90",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/bf473b25a5c031f97bb91d4a9e8e0d74f251abe7c9e99459bde185a77d963929",
									"kind": "s3"
								},
								"sha256": "sha256:bf473b25a5c031f97bb91d4a9e8e0d74f251abe7c9e99459bde185a77d963929"
							},
							"digest": "sha256:bf473b25a5c031f97bb91d4a9e8e0d74f251abe7c9e99459bde185a77d963929",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:008935e8b1c07669bb7791bde0a4037751a29f7af0dd1e0346da0ca23b36e0c6",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1250,
							"startedAtMs": 1200
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/0e754e10d045e5c12e2f15957170743bbbaaf339338b507db702f06905565217",
									"kind": "s3"
								},
								"sha256": "sha256:0e754e10d045e5c12e2f15957170743bbbaaf339338b507db702f06905565217"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			},
			{
				"baseline": {
					"digest": "sha256:8f1eac055606da15c3f8e3b6b2de992eedcb969389b92a5bd6d824f6292a8f16",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:35bd77fa271c8c28fc90e37e815f7bbf14126c185b081eaff5abf8aff37b8ce2",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtMyIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1NjpjYjM5Mzc4MzM2MDAxZGQ5ZGQxYWYxNmNiOTc4NGVlZjdjZjE1MjI2YTNmZjM4ZDliNWU5ZWY5ZGMxZmQyYmRjIiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjMsInNlZWQiOjEwNCwic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4"
							},
							"digest": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-3",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:cb39378336001dd9dd1af16cb9784eef7cf15226a3ff38d9b5e9ef9dc1fd2bdc",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 3,
									"seed": 104,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/4a0e91d11a6b5f720c8601a02610db4f310a0168905da514c2583d4800860063",
									"kind": "s3"
								},
								"sha256": "sha256:4a0e91d11a6b5f720c8601a02610db4f310a0168905da514c2583d4800860063"
							},
							"digest": "sha256:4a0e91d11a6b5f720c8601a02610db4f310a0168905da514c2583d4800860063",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:6e9d18f2079b2ffa031cc9aaa8d2b1362d4a3461af74c2fbf635162a9f1c3920"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:c62dce3b3993245cc42296474116a90386ad614f78d2ded7b6699ded7ae08668",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/cf12023644504035327783400aafb8be4b421368705d1218527c43311c9ab71f",
								"kind": "s3"
							},
							"sha256": "sha256:cf12023644504035327783400aafb8be4b421368705d1218527c43311c9ab71f"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:35bd77fa271c8c28fc90e37e815f7bbf14126c185b081eaff5abf8aff37b8ce2",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/89d95b37ade541de9fb9792e5053d4a8373ff28b31d5d04d1c3bf46fad2c8804",
									"kind": "s3"
								},
								"sha256": "sha256:89d95b37ade541de9fb9792e5053d4a8373ff28b31d5d04d1c3bf46fad2c8804"
							},
							"digest": "sha256:89d95b37ade541de9fb9792e5053d4a8373ff28b31d5d04d1c3bf46fad2c8804",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:cb39378336001dd9dd1af16cb9784eef7cf15226a3ff38d9b5e9ef9dc1fd2bdc",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/6e9d18f2079b2ffa031cc9aaa8d2b1362d4a3461af74c2fbf635162a9f1c3920",
									"kind": "s3"
								},
								"sha256": "sha256:6e9d18f2079b2ffa031cc9aaa8d2b1362d4a3461af74c2fbf635162a9f1c3920"
							},
							"digest": "sha256:6e9d18f2079b2ffa031cc9aaa8d2b1362d4a3461af74c2fbf635162a9f1c3920",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:a25e4c57b90cc470f75794d91d545977003bf298c89916af598befa868cbccf4",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1350,
							"startedAtMs": 1300
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/f65575d0db197f56e6039aae6a31739f32cc776bec2ee975518a8d8b3dbf7c80",
									"kind": "s3"
								},
								"sha256": "sha256:f65575d0db197f56e6039aae6a31739f32cc776bec2ee975518a8d8b3dbf7c80"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:fef37c6846bb3bf9c46b31e9a311353c2c90244280bddc10a2cd7db7d5a6ead9",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:5109d92261231935ad8fb7cdb1fdd4651e60ba3f562b1256ac6ffa2511611de0",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTMiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OmQ5NjhmMTk2ODY3NTA1MjQ2NTE1NDI5NmNkZTI0YjllNjY1YjRlMDdlM2RiZjU4MGJjZmZkOGM2MTg2YjA3ZjAiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6Mywic2VlZCI6MTA0LCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f"
							},
							"digest": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-3",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:d968f1968675052465154296cde24b9e665b4e07e3dbf580bcffd8c6186b07f0",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 3,
									"seed": 104,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/fa5d3f83a2098919044eeb301cdaf253fd47e95a7180cbb79ff8285466a34543",
									"kind": "s3"
								},
								"sha256": "sha256:fa5d3f83a2098919044eeb301cdaf253fd47e95a7180cbb79ff8285466a34543"
							},
							"digest": "sha256:fa5d3f83a2098919044eeb301cdaf253fd47e95a7180cbb79ff8285466a34543",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:4996ae0d39eea614e5fa0bce21656d53504548d7baed63ffa886d78863dc5bce"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:7716086f60d91c5f4817a2019fa459d144b98420007f5cd568543218815cc852",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/045eef58f1b5114f9b6e8e9e969648057fd276f638541ffd6fec9f654a53cea8",
								"kind": "s3"
							},
							"sha256": "sha256:045eef58f1b5114f9b6e8e9e969648057fd276f638541ffd6fec9f654a53cea8"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:5109d92261231935ad8fb7cdb1fdd4651e60ba3f562b1256ac6ffa2511611de0",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/6bb50f5d3cdce3ccda0910fef5cc39d3553605a7c0d3cf0374b93432f9a9297b",
									"kind": "s3"
								},
								"sha256": "sha256:6bb50f5d3cdce3ccda0910fef5cc39d3553605a7c0d3cf0374b93432f9a9297b"
							},
							"digest": "sha256:6bb50f5d3cdce3ccda0910fef5cc39d3553605a7c0d3cf0374b93432f9a9297b",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:d968f1968675052465154296cde24b9e665b4e07e3dbf580bcffd8c6186b07f0",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/4996ae0d39eea614e5fa0bce21656d53504548d7baed63ffa886d78863dc5bce",
									"kind": "s3"
								},
								"sha256": "sha256:4996ae0d39eea614e5fa0bce21656d53504548d7baed63ffa886d78863dc5bce"
							},
							"digest": "sha256:4996ae0d39eea614e5fa0bce21656d53504548d7baed63ffa886d78863dc5bce",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:d1b0950aecb0ee8b297a28bbda937eb1c3bbec4ef2fdee996d6b5a1aefc2296f",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1350,
							"startedAtMs": 1300
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/bf0cd695f29ddcf420645f78972eaf96a716b3be1287be21f578b1d05d9ded1f",
									"kind": "s3"
								},
								"sha256": "sha256:bf0cd695f29ddcf420645f78972eaf96a716b3be1287be21f578b1d05d9ded1f"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			},
			{
				"baseline": {
					"digest": "sha256:763a387d0f3f9fa4a1a36e6a609e1c5beeb0c782d07ab50f7d5fab9da6887cbe",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:e2d65cf4642bf9a300e2ef5d5f91d381c528e3c5253ca13048661bcc0aed7816",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtNCIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1NjozOTdkMDk4NDZhMGQ3N2YyMjEwMjhlZjZkMGI3YzI2MzM0Nzk3YzI5ZmM4YmVhNjQwODBmYWMwNDg2N2VhMzk4IiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjQsInNlZWQiOjEwNSwic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d"
							},
							"digest": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-4",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:397d09846a0d77f221028ef6d0b7c26334797c29fc8bea64080fac04867ea398",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 4,
									"seed": 105,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/ca1405fd366c1cd6bbbad5256048586522af6e2eba5a2968b0365385c0f83fef",
									"kind": "s3"
								},
								"sha256": "sha256:ca1405fd366c1cd6bbbad5256048586522af6e2eba5a2968b0365385c0f83fef"
							},
							"digest": "sha256:ca1405fd366c1cd6bbbad5256048586522af6e2eba5a2968b0365385c0f83fef",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:4a54d32dc9cef807c5ba21a96e740148a72daaeaee53fbc31fc669cb483ba674"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:b8719642c6599ef6f8db4be2818c791689d20e523bd4c27d38aec79c12a8e6e9",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/382580e0e2362db6cedd96c659d82a539a00dc8974718de52ae7c158c08f05ae",
								"kind": "s3"
							},
							"sha256": "sha256:382580e0e2362db6cedd96c659d82a539a00dc8974718de52ae7c158c08f05ae"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:e2d65cf4642bf9a300e2ef5d5f91d381c528e3c5253ca13048661bcc0aed7816",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/77ed0778cc7b997d2d9c11728207683aeceba79d7678333326e2ed1950f0acf8",
									"kind": "s3"
								},
								"sha256": "sha256:77ed0778cc7b997d2d9c11728207683aeceba79d7678333326e2ed1950f0acf8"
							},
							"digest": "sha256:77ed0778cc7b997d2d9c11728207683aeceba79d7678333326e2ed1950f0acf8",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:397d09846a0d77f221028ef6d0b7c26334797c29fc8bea64080fac04867ea398",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/4a54d32dc9cef807c5ba21a96e740148a72daaeaee53fbc31fc669cb483ba674",
									"kind": "s3"
								},
								"sha256": "sha256:4a54d32dc9cef807c5ba21a96e740148a72daaeaee53fbc31fc669cb483ba674"
							},
							"digest": "sha256:4a54d32dc9cef807c5ba21a96e740148a72daaeaee53fbc31fc669cb483ba674",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:77184474b3a762f797d232866f84234a0c132da1bf432ca923a6e0c9de0cee8d",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1450,
							"startedAtMs": 1400
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/60a03fa34a1c30d810cf919a06d7bdffda94a4926659484fd613502ea4fc19d2",
									"kind": "s3"
								},
								"sha256": "sha256:60a03fa34a1c30d810cf919a06d7bdffda94a4926659484fd613502ea4fc19d2"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:89324812d52f3cb828e59fd91fb2b26550da7e5bcf0aa84f51b3405f9d04c8ac",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:3746fbb29c5125a1fd87e6871195eb4470f34e7bbaa3cffe67f746c99de273f4",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTQiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OjI1MGQzOTg5ZTRkNzdkNWFiMzEyYThhMWZhZjUzMzQyMjQyMDgzNWM1ZGRmYjQ0YTMzM2I2YTA4NjM3Nzk5MDMiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6NCwic2VlZCI6MTA1LCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26"
							},
							"digest": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-4",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:250d3989e4d77d5ab312a8a1faf533422420835c5ddfb44a333b6a0863779903",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 4,
									"seed": 105,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/d208534584094bf4b6cfb0f5ab3f941a2bcd14e07ebfce1d66c4f13e38bfcfdc",
									"kind": "s3"
								},
								"sha256": "sha256:d208534584094bf4b6cfb0f5ab3f941a2bcd14e07ebfce1d66c4f13e38bfcfdc"
							},
							"digest": "sha256:d208534584094bf4b6cfb0f5ab3f941a2bcd14e07ebfce1d66c4f13e38bfcfdc",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:7c06f43b89a67d85f437a3bf50d8077881ab90a6119d0c1ed4bd3581d9a2eec4"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:d87059c1868bd5757379e89d92cadfec299e67619c9fba126ce5d106ee780712",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/b259aa1926f6a7ec157df6bb193fac1e90b5c18c6d3efd3042bb00231843c4a2",
								"kind": "s3"
							},
							"sha256": "sha256:b259aa1926f6a7ec157df6bb193fac1e90b5c18c6d3efd3042bb00231843c4a2"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:3746fbb29c5125a1fd87e6871195eb4470f34e7bbaa3cffe67f746c99de273f4",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/acaea574c3dbbd58c1496e094f00f6e716e6b17c7d03ec0a1b70c1015f232a6b",
									"kind": "s3"
								},
								"sha256": "sha256:acaea574c3dbbd58c1496e094f00f6e716e6b17c7d03ec0a1b70c1015f232a6b"
							},
							"digest": "sha256:acaea574c3dbbd58c1496e094f00f6e716e6b17c7d03ec0a1b70c1015f232a6b",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:250d3989e4d77d5ab312a8a1faf533422420835c5ddfb44a333b6a0863779903",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/7c06f43b89a67d85f437a3bf50d8077881ab90a6119d0c1ed4bd3581d9a2eec4",
									"kind": "s3"
								},
								"sha256": "sha256:7c06f43b89a67d85f437a3bf50d8077881ab90a6119d0c1ed4bd3581d9a2eec4"
							},
							"digest": "sha256:7c06f43b89a67d85f437a3bf50d8077881ab90a6119d0c1ed4bd3581d9a2eec4",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:52941d27e3ea167aa1e56dd2ed99000648032752132535a90ca0d0cfb1a36f26",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1450,
							"startedAtMs": 1400
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/efd2f77b5bce3d5f37cb8b17b0af672b0e8444fe7c7ad7168893e91794d78c4f",
									"kind": "s3"
								},
								"sha256": "sha256:efd2f77b5bce3d5f37cb8b17b0af672b0e8444fe7c7ad7168893e91794d78c4f"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			},
			{
				"baseline": {
					"digest": "sha256:fe7ae1537377a567b7eda2171b5f0b8c8479f29c20a3c59e2e864a7baf4297fc",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:23d89a41280755051f23d7bcd1028997f07492f746e232638f9e969f50b301b5",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2030,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWJhc2VsaW5lLTAtNSIsImhhcm5lc3MiOiJjb2RleCIsImhhcm5lc3NWZXJzaW9uIjoiMS4yLjMiLCJpbnN0cnVjdGlvbkRlbGl2ZXJ5Ijp7ImtpbmQiOiJzdGRpbi11dGY4In0sImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtZXhlY3V0aW9uLXBsYW4tbWF0ZXJpYWwiLCJsYXVuY2giOnsiYXJncyI6W10sImN3ZCI6eyJwYXRoIjoiLiIsIndvcmtzcGFjZSI6InRhc2sifSwiZW52Ijp7IlBBVEgiOnsia2luZCI6InB1YmxpYyIsInZhbHVlIjoiL3Vzci9sb2NhbC9iaW46L3Vzci9iaW46L2JpbiJ9fSwiZXhlY3V0YWJsZSI6ImNvZGV4In0sImxpbWl0cyI6eyJtYXhDb3N0VXNkIjo1LCJtYXhJbnB1dFRva2VucyI6MTAwMDAwLCJtYXhNb2RlbENhbGxzIjo1MCwibWF4T3V0cHV0VG9rZW5zIjo1MDAwMCwibWF4U3RlcHMiOjEwMCwidGltZW91dE1zIjo2MDAwMH0sIm1lbW9yeSI6eyJtb2RlIjoiZGlzYWJsZWQifSwibW9kZWwiOnsiYWNjZXNzIjp7ImdyYW50RGlnZXN0Ijoic2hhMjU2OmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJraW5kIjoiZXZhbHVhdG9yLW1lZGlhdGVkIiwibmV0d29yayI6eyJkb21haW5zIjpbInJvdXRlci50YW5nbGUudG9vbHMiXSwibW9kZSI6ImdhdGV3YXktb25seSJ9fSwicG9saWN5Ijoic2luZ2xlIiwicmVzb2x2ZWQiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwicm91dGVzIjpbeyJraW5kIjoicHJpbWFyeSIsInJlcXVlc3RlZCI6InByb3ZpZGVyL21vZGVsIn1dfSwibmV0d29yayI6eyJtb2RlIjoiZGlzYWJsZWQifSwicHJvZmlsZSI6eyJtb3VudFBhdGhzIjpbIkFHRU5UUy5tZCJdLCJwbGFuRGlnZXN0Ijoic2hhMjU2OmZlOTE5MzllZjFkOTQyYTM4ZGU3ZTBmYTlkODEzOWQ1MWU1ZDNjOTQ5NjgzNTA1ZjBmOGY5MjQ2NGUxMzJlZjgiLCJ0YXJnZXRXb3Jrc3BhY2UiOiJ0YXNrIn0sInJ1bkNlbGwiOnsiYXJtIjoiYmFzZWxpbmUiLCJhdHRlbXB0IjoxLCJidW5kbGVEaWdlc3QiOiJzaGEyNTY6NWMyMWVlNTNlNTEzZmM2MDRjYjA5NzU0ZTIxYzM5MmIyNGE0MjRkYTBlZjM3ZGJmOGYxZWU0YThhMGIwOGYwOSIsImRpZ2VzdCI6InNoYTI1NjowNmQ1Y2IzYzk0Mzk3NTdlY2EzZDJkOTFkMjM2YmE5NmJkMWYzYjFkODk2OTdlM2U2N2JlYzRhNDZlNzYyNTQxIiwiZXhwZXJpbWVudERpZ2VzdCI6InNoYTI1Njo3OWQ2ZTc5ZDJjYjBhZjU1NDU3MzFmN2M4ZWZkNTJhNjhiY2M3NDM0OWFhNTU3YzJlYzBmYjFjY2E5NTAxNzQ1Iiwia2luZCI6ImFnZW50LWNhbmRpZGF0ZS1ydW4tY2VsbCIsInJlcGV0aXRpb24iOjUsInNlZWQiOjEwNiwic3VpdGVEaWdlc3QiOiJzaGEyNTY6NjUzMzZhZmQ4NTI1OGNjZjdkOWIyOGU5ZTIxMmY4Y2M1MWRkMDlhM2U3YjMyYzQ2NTE4YWU3Y2M3MGQ0NjcwOCIsInRhc2tEaWdlc3QiOiJzaGEyNTY6NmFhNzE4MzMxYjZkYTMxMGRjYWI2ZGYyZTMzOTdjYjc3MDg0MGU1NTVhODJlMDY4OTU3NzE1N2I4OWI0ZTI3NyIsInRhc2tJbmRleCI6MH0sIndvcmtzcGFjZXMiOnsidGFza1Jvb3QiOiIvd29ya3NwYWNlL3Rhc2sifX0=",
								"encoding": "base64",
								"sha256": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1"
							},
							"digest": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-baseline-0-5",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": ["AGENTS.md"],
									"planDigest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "baseline",
									"attempt": 1,
									"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
									"digest": "sha256:06d5cb3c9439757eca3d2d91d236ba96bd1f3b1d89697e3e67bec4a46e762541",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 5,
									"seed": 106,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:fb3b8ce890ec866fa165cb2c75331b188cf5cf5faa5c9f0107345dd3d0acb70f",
							"files": [{
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 287,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3NTY2NDcyMjE3NjBkM2ZhNTM0ZDkwNWRjZjkyYzYwNGNlM2VkMmVjOWNmMDljZWVmYjhhMjc0OGEyODQ5YTI4IiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiQUdFTlRTLm1kIn1dLCJmbGFncyI6W10sImhhcm5lc3MiOiJjb2RleCIsInNvdXJjZVByb2ZpbGVEaWdlc3QiOiJzaGEyNTY6ZTUzZTFjOGY5NjMyYmNiNWRiOTAzM2UzMmYzM2E5MGI5YmQ5OWFiZWNlZjBiYjUyZmY5MDY5ZjA3NTA5ZTJmOSIsInVuc3VwcG9ydGVkIjpbXX0=",
									"encoding": "base64",
									"sha256": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8"
								},
								"digest": "sha256:fe91939ef1d942a38de7e0fa9d8139d51e5d3c949683505f0f8f92464e132ef8",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [],
									"harness": "codex",
									"sourceProfileDigest": "sha256:e53e1c8f9632bcb5db9033e32f33a90b9bd99abecef0bb52ff9069f07509e2f9",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1150,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/a140a6c939d651578dc04e1737d309f5939bd62ccf14b971ad01abe3fc8da79b",
									"kind": "s3"
								},
								"sha256": "sha256:a140a6c939d651578dc04e1737d309f5939bd62ccf14b971ad01abe3fc8da79b"
							},
							"digest": "sha256:a140a6c939d651578dc04e1737d309f5939bd62ccf14b971ad01abe3fc8da79b",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 0
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b",
										"kind": "s3"
									},
									"sha256": "sha256:628cb4ead38e34e34a34f78fa4481f2a0ccf8e9139acfae69d79dc997e90e36b"
								},
								"executionPlanDigest": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": false,
								"score": 0,
								"taskOutcomeDigest": "sha256:a790059208542561f66e539b3d7fac43355c3b3d1499400ce093827f6039205a"
							}
						},
						"bundleDigest": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
						"digest": "sha256:b9d19b19dde68c405b04b37e78cb551351e4f5b194ef58ae47232077506953e5",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/2dd209df2f14ccbfff85fc0c5026a654853337790f08a11bb1e9c1b4c177b6ec",
								"kind": "s3"
							},
							"sha256": "sha256:2dd209df2f14ccbfff85fc0c5026a654853337790f08a11bb1e9c1b4c177b6ec"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:23d89a41280755051f23d7bcd1028997f07492f746e232638f9e969f50b301b5",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/e866ae47841492f03c937f37f38c8afa36bd1d118fd85106763ababfde93ad78",
									"kind": "s3"
								},
								"sha256": "sha256:e866ae47841492f03c937f37f38c8afa36bd1d118fd85106763ababfde93ad78"
							},
							"digest": "sha256:e866ae47841492f03c937f37f38c8afa36bd1d118fd85106763ababfde93ad78",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:06d5cb3c9439757eca3d2d91d236ba96bd1f3b1d89697e3e67bec4a46e762541",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/a790059208542561f66e539b3d7fac43355c3b3d1499400ce093827f6039205a",
									"kind": "s3"
								},
								"sha256": "sha256:a790059208542561f66e539b3d7fac43355c3b3d1499400ce093827f6039205a"
							},
							"digest": "sha256:a790059208542561f66e539b3d7fac43355c3b3d1499400ce093827f6039205a",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:7ddfacb9cc7a5cec624f442e224490304a8003f16165947df2a5728c4acb67f1",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 4,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d",
											"kind": "s3"
										},
										"sha256": "sha256:481ba4019c9d2710c3386537382592c093ef02bf5b056c30237b3d92b0e19a1d"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1550,
							"startedAtMs": 1500
						},
						"trace": {
							"artifact": {
								"byteLength": 748,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/e87a7dc8b1d7d349afe5ea682070358ea6e6daebc0c645eb77c297b2d0d0f702",
									"kind": "s3"
								},
								"sha256": "sha256:e87a7dc8b1d7d349afe5ea682070358ea6e6daebc0c645eb77c297b2d0d0f702"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				},
				"candidate": {
					"digest": "sha256:1cd097a50aa3dc3d707e21b4a3461fb4f5097204f010c8e358e5293870121019",
					"kind": "agent-candidate-execution-evidence",
					"materializationReceipt": {
						"benchmark": {
							"suite": {
								"digest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
								"material": {
									"byteLength": 210,
									"content": "eyJkaWdlc3RBbGdvcml0aG0iOiJyZmM4Nzg1LXNoYTI1NiIsImtpbmQiOiJhZ2VudC1jYW5kaWRhdGUtYmVuY2htYXJrLXN1aXRlIiwicmVwcyI6Niwic2VlZHMiOlsxMDEsMTAyLDEwMywxMDQsMTA1LDEwNl0sInRhc2tEaWdlc3RzIjpbInNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3Il19",
									"encoding": "base64",
									"sha256": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708"
								}
							},
							"task": {
								"digest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
								"material": {
									"byteLength": 2096,
									"content": "eyJhdHRlbXB0Ijp7Im1heEF0dGVtcHRzIjoxLCJyZXRyeVBvbGljeSI6Im5vbmUifSwiYmVuY2htYXJrIjp7Im5hbWUiOiJyZXBvc2l0b3J5LWRpc2pvaW50LXNtb2tlIiwic3BsaXREaWdlc3QiOiJzaGEyNTY6ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsInZlcnNpb24iOiIxIn0sImRpZ2VzdEFsZ29yaXRobSI6InJmYzg3ODUtc2hhMjU2IiwiZXZhbHVhdG9yVGFza0NvbnRhaW5lciI6eyJpbWFnZSI6ImdoY3IuaW8vZXhhbXBsZS90YXNrIiwiaW5kZXhEaWdlc3QiOiJzaGEyNTY6YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsIm1hbmlmZXN0RGlnZXN0Ijoic2hhMjU2OmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJwbGF0Zm9ybSI6eyJhcmNoaXRlY3R1cmUiOiJhbWQ2NCIsIm9zIjoibGludXgifSwic291cmNlIjoiZXZhbHVhdG9yLXRhc2stY29udGFpbmVyIn0sImdyYWRlciI6eyJhcnRpZmFjdCI6eyJieXRlTGVuZ3RoIjoyNSwibG9jYXRvciI6eyJidWNrZXQiOiJjYW5kaWRhdGUtdGVzdC1hcnRpZmFjdHMiLCJrZXkiOiJncmFkZXIvOWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCIsImtpbmQiOiJzMyJ9LCJzaGEyNTYiOiJzaGEyNTY6OWEzNTQ0OTUxODU1ODdiMjVlOGM5ODEwNDA2MDA2ODg3MWE0NGM3MTllNGY1N2QzNDVhOTA1ZmMyZDcyYTZhZCJ9LCJmb3JtYXQiOiJ0YW5nbGUtZ3JhZGVyIiwibmFtZSI6ImZpeHR1cmUtZXhlY3V0YWJsZS1ncmFkZXIiLCJ2ZXJzaW9uIjoiMS4wLjAifSwiaW5zdHJ1Y3Rpb24iOiJGaXggdGhlIGZhaWxpbmcgYmVoYXZpb3Igd2l0aG91dCBjaGFuZ2luZyB0aGUgcHVibGljIEFQSS4iLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWJlbmNobWFyay10YXNrIiwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibW9kZWwiOnsibW9kZWwiOiJtb2RlbC1zbmFwc2hvdCIsInByb3ZpZGVyIjoicHJvdmlkZXIiLCJyZWFzb25pbmdFZmZvcnQiOiJoaWdoIiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwiLCJzbmFwc2hvdCI6Im1vZGVsLXNuYXBzaG90LTIwMjYtMDctMDEifSwib3V0Y29tZSI6eyJraW5kIjoib3V0cHV0IiwibWF4Qnl0ZXMiOjEwMjQsIm1lZGlhVHlwZSI6InRleHQvcGxhaW4ifSwic2NlbmFyaW8iOnsiaWQiOiJvd25lci1yZXBvLTEiLCJraW5kIjoiY29kaW5nIiwic2NlbmFyaW9EaWdlc3QiOiJzaGEyNTY6ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4OCJ9LCJ3b3Jrc3BhY2UiOnsiYXJjaGl2ZSI6eyJieXRlTGVuZ3RoIjoxNywiY29udGVudCI6IlpXMXdkSGs2YjNWMGNIVjBMWFJoYzJzPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjMzMmRkOWM3NGJlYWI4YTE3NzM5NmE0NTEwZGFiNDZhNTBjYTIwNzRiMjAzYjEwNjk0ZTRlYWEzMDcxZTJlZjAifSwiZGlnZXN0Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1zbmFwc2hvdCIsIm1hbmlmZXN0Ijp7ImJ5dGVMZW5ndGgiOjU2LCJjb250ZW50IjoiZXlKbWFXeGxjeUk2VzEwc0ltdHBibVFpT2lKaFoyVnVkQzFqWVc1a2FXUmhkR1V0ZDI5eWEzTndZV05sTFcxaGJtbG1aWE4wSW4wPSIsImVuY29kaW5nIjoiYmFzZTY0Iiwic2hhMjU2Ijoic2hhMjU2OjNlOWZkYWQ0NmYxNGNlNWI3Yzc4YTkzZTRmZWUwOTYwNDgzYWU5ZDFjZGEyMWYwYzM5MGNkYmFkNDBiZGFjMDIifSwibWF0ZXJpYWwiOnsiZmlsZXMiOltdLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXdvcmtzcGFjZS1tYW5pZmVzdCJ9fX0=",
									"encoding": "base64",
									"sha256": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277"
								}
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"codeKind": "disabled",
						"container": {
							"image": "ghcr.io/example/task",
							"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
							"platform": {
								"architecture": "amd64",
								"os": "linux"
							},
							"source": "evaluator-task-container"
						},
						"digest": "sha256:063596c5f2da9e36fd5e56eb7d91c287ffba623e48d6469238fe27aebcde5787",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlan": {
							"artifact": {
								"byteLength": 2164,
								"content": "eyJjb2RlS2luZCI6ImRpc2FibGVkIiwiY29udGFpbmVyIjp7ImltYWdlIjoiZ2hjci5pby9leGFtcGxlL3Rhc2siLCJpbmRleERpZ2VzdCI6InNoYTI1NjphYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwibWFuaWZlc3REaWdlc3QiOiJzaGEyNTY6YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInBsYXRmb3JtIjp7ImFyY2hpdGVjdHVyZSI6ImFtZDY0Iiwib3MiOiJsaW51eCJ9LCJzb3VyY2UiOiJldmFsdWF0b3ItdGFzay1jb250YWluZXIifSwiZXhlY3V0aW9uSWQiOiJleHBlcmltZW50LWNhbmRpZGF0ZS0wLTUiLCJoYXJuZXNzIjoiY29kZXgiLCJoYXJuZXNzVmVyc2lvbiI6IjEuMi4zIiwiaW5zdHJ1Y3Rpb25EZWxpdmVyeSI6eyJraW5kIjoic3RkaW4tdXRmOCJ9LCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLWV4ZWN1dGlvbi1wbGFuLW1hdGVyaWFsIiwibGF1bmNoIjp7ImFyZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiY3dkIjp7InBhdGgiOiIuIiwid29ya3NwYWNlIjoidGFzayJ9LCJlbnYiOnsiUEFUSCI6eyJraW5kIjoicHVibGljIiwidmFsdWUiOiIvdXNyL2xvY2FsL2JpbjovdXNyL2JpbjovYmluIn19LCJleGVjdXRhYmxlIjoiY29kZXgifSwibGltaXRzIjp7Im1heENvc3RVc2QiOjUsIm1heElucHV0VG9rZW5zIjoxMDAwMDAsIm1heE1vZGVsQ2FsbHMiOjUwLCJtYXhPdXRwdXRUb2tlbnMiOjUwMDAwLCJtYXhTdGVwcyI6MTAwLCJ0aW1lb3V0TXMiOjYwMDAwfSwibWVtb3J5Ijp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJtb2RlbCI6eyJhY2Nlc3MiOnsiZ3JhbnREaWdlc3QiOiJzaGEyNTY6Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjYyIsImtpbmQiOiJldmFsdWF0b3ItbWVkaWF0ZWQiLCJuZXR3b3JrIjp7ImRvbWFpbnMiOlsicm91dGVyLnRhbmdsZS50b29scyJdLCJtb2RlIjoiZ2F0ZXdheS1vbmx5In19LCJwb2xpY3kiOiJzaW5nbGUiLCJyZXNvbHZlZCI6eyJtb2RlbCI6Im1vZGVsLXNuYXBzaG90IiwicHJvdmlkZXIiOiJwcm92aWRlciIsInJlYXNvbmluZ0VmZm9ydCI6ImhpZ2giLCJyZXF1ZXN0ZWQiOiJwcm92aWRlci9tb2RlbCIsInNuYXBzaG90IjoibW9kZWwtc25hcHNob3QtMjAyNi0wNy0wMSJ9LCJyb3V0ZXMiOlt7ImtpbmQiOiJwcmltYXJ5IiwicmVxdWVzdGVkIjoicHJvdmlkZXIvbW9kZWwifV19LCJuZXR3b3JrIjp7Im1vZGUiOiJkaXNhYmxlZCJ9LCJwcm9maWxlIjp7Im1vdW50UGF0aHMiOlsiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQiLCJBR0VOVFMubWQiXSwicGxhbkRpZ2VzdCI6InNoYTI1Njo1NTczYTg1MTFjNTkxZDdjNWZjNTNlMTNjOGZkYWM3Y2ZlOWJmN2ZlZmVlYjI3YzMwZDQ4OTRmNWMxMzg0YTJhIiwidGFyZ2V0V29ya3NwYWNlIjoidGFzayJ9LCJydW5DZWxsIjp7ImFybSI6ImNhbmRpZGF0ZSIsImF0dGVtcHQiOjEsImJ1bmRsZURpZ2VzdCI6InNoYTI1Njo2MGZjYmIxYzcyODE5NGJkNTFkN2QxOWNiNzMyZDFjM2YxODgxZGNlN2UwYTYyNjZiNDFjOGI5OGNmZDY1NjkzIiwiZGlnZXN0Ijoic2hhMjU2OmRkMWM5ZDU1MTRmMTg3NzZlODIyMjJmZjFhNmY1N2Q1YmQyNzQxZWJmOGQzYjkwNTM1ZDcwMTQ2OTUwNGY1MTQiLCJleHBlcmltZW50RGlnZXN0Ijoic2hhMjU2Ojc5ZDZlNzlkMmNiMGFmNTU0NTczMWY3YzhlZmQ1MmE2OGJjYzc0MzQ5YWE1NTdjMmVjMGZiMWNjYTk1MDE3NDUiLCJraW5kIjoiYWdlbnQtY2FuZGlkYXRlLXJ1bi1jZWxsIiwicmVwZXRpdGlvbiI6NSwic2VlZCI6MTA2LCJzdWl0ZURpZ2VzdCI6InNoYTI1Njo2NTMzNmFmZDg1MjU4Y2NmN2Q5YjI4ZTllMjEyZjhjYzUxZGQwOWEzZTdiMzJjNDY1MThhZTdjYzcwZDQ2NzA4IiwidGFza0RpZ2VzdCI6InNoYTI1Njo2YWE3MTgzMzFiNmRhMzEwZGNhYjZkZjJlMzM5N2NiNzcwODQwZTU1NWE4MmUwNjg5NTc3MTU3Yjg5YjRlMjc3IiwidGFza0luZGV4IjowfSwid29ya3NwYWNlcyI6eyJ0YXNrUm9vdCI6Ii93b3Jrc3BhY2UvdGFzayJ9fQ==",
								"encoding": "base64",
								"sha256": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d"
							},
							"digest": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d",
							"kind": "agent-candidate-execution-plan",
							"material": {
								"codeKind": "disabled",
								"container": {
									"image": "ghcr.io/example/task",
									"indexDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
									"manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
									"platform": {
										"architecture": "amd64",
										"os": "linux"
									},
									"source": "evaluator-task-container"
								},
								"executionId": "experiment-candidate-0-5",
								"harness": "codex",
								"harnessVersion": "1.2.3",
								"instructionDelivery": { "kind": "stdin-utf8" },
								"kind": "agent-candidate-execution-plan-material",
								"launch": {
									"args": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"cwd": {
										"path": ".",
										"workspace": "task"
									},
									"env": { "PATH": {
										"kind": "public",
										"value": "/usr/local/bin:/usr/bin:/bin"
									} },
									"executable": "codex"
								},
								"limits": {
									"maxCostUsd": 5,
									"maxInputTokens": 1e5,
									"maxModelCalls": 50,
									"maxOutputTokens": 5e4,
									"maxSteps": 100,
									"timeoutMs": 6e4
								},
								"memory": { "mode": "disabled" },
								"model": {
									"access": {
										"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
										"kind": "evaluator-mediated",
										"network": {
											"domains": ["router.tangle.tools"],
											"mode": "gateway-only"
										}
									},
									"policy": "single",
									"resolved": {
										"model": "model-snapshot",
										"provider": "provider",
										"reasoningEffort": "high",
										"requested": "provider/model",
										"snapshot": "model-snapshot-2026-07-01"
									},
									"routes": [{
										"kind": "primary",
										"requested": "provider/model"
									}]
								},
								"network": { "mode": "disabled" },
								"profile": {
									"mountPaths": [".codex/system-prompt.md", "AGENTS.md"],
									"planDigest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
									"targetWorkspace": "task"
								},
								"runCell": {
									"arm": "candidate",
									"attempt": 1,
									"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
									"digest": "sha256:dd1c9d5514f18776e82222ff1a6f57d5bd2741ebf8d3b90535d701469504f514",
									"experimentDigest": "sha256:79d6e79d2cb0af5545731f7c8efd52a68bcc74349aa557c2ec0fb1cca9501745",
									"kind": "agent-candidate-run-cell",
									"repetition": 5,
									"seed": 106,
									"suiteDigest": "sha256:65336afd85258ccf7d9b28e9e212f8cc51dd09a3e7b32c46518ae7cc70d46708",
									"taskDigest": "sha256:6aa718331b6da310dcab6df2e3397cb770840e555a82e0689577157b89b4e277",
									"taskIndex": 0
								},
								"workspaces": { "taskRoot": "/workspace/task" }
							}
						},
						"harness": "codex",
						"harnessVersion": "1.2.3",
						"kind": "agent-candidate-materialization",
						"profileActivation": {
							"digest": "sha256:82498ed11469715e80be7f5b4fabae0a7fc6e0bb3e011df86b9ad2743a541b3b",
							"files": [{
								"content": "Return the exact measured answer.",
								"mode": 420,
								"path": ".codex/system-prompt.md"
							}, {
								"content": "<!-- tangle-agent-profile-materialize: generated sha256:39adbb9b7f571f0fd586e7795023d25909adbe9586bb21ee134d3d7248bf1599; do not edit; the next profile materialization replaces this file -->\nInspect the repository, implement the fix, and run tests.\n",
								"mode": 420,
								"path": "AGENTS.md"
							}],
							"kind": "agent-candidate-profile-activation",
							"profilePlan": {
								"artifact": {
									"byteLength": 532,
									"content": "eyJlbnYiOnt9LCJmaWxlcyI6W3siY29udGVudFNoYTI1NiI6InNoYTI1Njo3Y2Q5YzExN2QzMzc3NzA4Mjc1ZmFhNmE1NjRhZjk1MmYzZjBjNzEzNTJhZTU1ODMzYmY0MTYzNzc5NjJkNWIwIiwibW9kZSI6NDIwLCJyZWxQYXRoIjoiLmNvZGV4L3N5c3RlbS1wcm9tcHQubWQifSx7ImNvbnRlbnRTaGEyNTYiOiJzaGEyNTY6NzU2NjQ3MjIxNzYwZDNmYTUzNGQ5MDVkY2Y5MmM2MDRjZTNlZDJlYzljZjA5Y2VlZmI4YTI3NDhhMjg0OWEyOCIsIm1vZGUiOjQyMCwicmVsUGF0aCI6IkFHRU5UUy5tZCJ9XSwiZmxhZ3MiOlt7ImtpbmQiOiJwdWJsaWMiLCJ2YWx1ZSI6Ii1jIn0seyJraW5kIjoicHVibGljIiwidmFsdWUiOiJtb2RlbF9pbnN0cnVjdGlvbnNfZmlsZT0uY29kZXgvc3lzdGVtLXByb21wdC5tZCJ9XSwiaGFybmVzcyI6ImNvZGV4Iiwic291cmNlUHJvZmlsZURpZ2VzdCI6InNoYTI1Njo4YjFlMmYwZjdiODMyOTU4MzgxYzI5YmFlYmU0YTk2MWIxNTFhZjk3YTBjZTlkNjExYTE1YWQwNzQxYWVhYTc1IiwidW5zdXBwb3J0ZWQiOltdfQ==",
									"encoding": "base64",
									"sha256": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a"
								},
								"digest": "sha256:5573a8511c591d7c5fc53e13c8fdac7cfe9bf7fefeeb27c30d4894f5c1384a2a",
								"kind": "agent-profile-workspace-plan",
								"material": {
									"env": {},
									"files": [{
										"contentSha256": "sha256:7cd9c117d3377708275faa6a564af952f3f0c71352ae55833bf416377962d5b0",
										"mode": 420,
										"relPath": ".codex/system-prompt.md"
									}, {
										"contentSha256": "sha256:756647221760d3fa534d905dcf92c604ce3ed2ec9cf09ceefb8a2748a2849a28",
										"mode": 420,
										"relPath": "AGENTS.md"
									}],
									"flags": [{
										"kind": "public",
										"value": "-c"
									}, {
										"kind": "public",
										"value": "model_instructions_file=.codex/system-prompt.md"
									}],
									"harness": "codex",
									"sourceProfileDigest": "sha256:8b1e2f0f7b832958381c29baebe4a961b151af97a0ce9d611a15ad0741aeaa75",
									"unsupported": []
								}
							}
						},
						"resolvedModel": {
							"model": "model-snapshot",
							"provider": "provider",
							"reasoningEffort": "high",
							"requested": "provider/model",
							"snapshot": "model-snapshot-2026-07-01"
						}
					},
					"receipt": {
						"benchmarkResult": {
							"artifact": {
								"byteLength": 1149,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "benchmark-result/8b0ad1e36091723b0ea40cbf815dae6f5a3fb7f6185ba58ae1efb4494ef279af",
									"kind": "s3"
								},
								"sha256": "sha256:8b0ad1e36091723b0ea40cbf815dae6f5a3fb7f6185ba58ae1efb4494ef279af"
							},
							"digest": "sha256:8b0ad1e36091723b0ea40cbf815dae6f5a3fb7f6185ba58ae1efb4494ef279af",
							"kind": "agent-candidate-benchmark-result",
							"material": {
								"dimensions": [{
									"name": "quality",
									"score": 1
								}],
								"evidence": {
									"byteLength": 11,
									"locator": {
										"bucket": "candidate-test-artifacts",
										"key": "grader-evidence/9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d",
										"kind": "s3"
									},
									"sha256": "sha256:9b9b3a1471309177261cfe65ea9c298e0dd372e4b5d087f8d35d7b732485373d"
								},
								"executionPlanDigest": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d",
								"grader": {
									"artifact": {
										"byteLength": 25,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "grader/9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad",
											"kind": "s3"
										},
										"sha256": "sha256:9a354495185587b25e8c98104060068871a44c719e4f57d345a905fc2d72a6ad"
									},
									"format": "tangle-grader",
									"name": "fixture-executable-grader",
									"version": "1.0.0"
								},
								"grading": {
									"timing": {
										"durationMs": 0,
										"endedAtMs": 17836416e5,
										"startedAtMs": 17836416e5
									},
									"usage": {
										"cachedInputTokens": 0,
										"costProvenance": "observed",
										"costUsdNanos": 0,
										"inputTokens": 0,
										"modelCalls": 0,
										"outputTokens": 0,
										"reasoningTokens": 0
									}
								},
								"kind": "agent-candidate-benchmark-result-material",
								"passed": true,
								"score": 1,
								"taskOutcomeDigest": "sha256:fe22e6d8a4e54f734784819728f573d1908df2aef91024059836ee93c962febc"
							}
						},
						"bundleDigest": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
						"digest": "sha256:bed31738f8fddc5b82f1dce05e83951caa12d6769fd307b687ec86a303b35727",
						"digestAlgorithm": "rfc8785-sha256",
						"executionPlanDigest": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d",
						"executorCapture": {
							"byteLength": 477,
							"locator": {
								"bucket": "candidate-test-artifacts",
								"key": "executor-capture/5bdda894fe4e0a532dd63e79e131814889b0b858dd53a448fed1ea9d4395d98b",
								"kind": "s3"
							},
							"sha256": "sha256:5bdda894fe4e0a532dd63e79e131814889b0b858dd53a448fed1ea9d4395d98b"
						},
						"kind": "agent-candidate-run",
						"materializationReceiptDigest": "sha256:063596c5f2da9e36fd5e56eb7d91c287ffba623e48d6469238fe27aebcde5787",
						"memory": { "mode": "disabled" },
						"modelSettlement": {
							"artifact": {
								"byteLength": 668,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "model-settlement/65fb226804aeb8175a346d9a52b2b87ece9334a1623c10a0de7575fe596ded44",
									"kind": "s3"
								},
								"sha256": "sha256:65fb226804aeb8175a346d9a52b2b87ece9334a1623c10a0de7575fe596ded44"
							},
							"digest": "sha256:65fb226804aeb8175a346d9a52b2b87ece9334a1623c10a0de7575fe596ded44",
							"kind": "agent-candidate-model-settlement",
							"material": {
								"calls": [],
								"closed": true,
								"executionPlanDigest": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d",
								"grantDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
								"kind": "agent-candidate-model-settlement-material",
								"preparationId": "candidate-preparation.nBqsDbKYlsiY4Tto5XaxkR3RCTop9PA9_kX-kOSzR8U",
								"resolved": {
									"model": "model-snapshot",
									"provider": "provider",
									"reasoningEffort": "high",
									"requested": "provider/model",
									"snapshot": "model-snapshot-2026-07-01"
								},
								"usage": {
									"cachedInputTokens": 0,
									"costProvenance": "observed",
									"costUsdNanos": 0,
									"inputTokens": 0,
									"modelCalls": 0,
									"outputTokens": 0,
									"reasoningTokens": 0
								},
								"usageWithinLimits": true
							}
						},
						"runCellDigest": "sha256:dd1c9d5514f18776e82222ff1a6f57d5bd2741ebf8d3b90535d701469504f514",
						"steps": 0,
						"taskOutcome": {
							"artifact": {
								"byteLength": 478,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "task-outcome/fe22e6d8a4e54f734784819728f573d1908df2aef91024059836ee93c962febc",
									"kind": "s3"
								},
								"sha256": "sha256:fe22e6d8a4e54f734784819728f573d1908df2aef91024059836ee93c962febc"
							},
							"digest": "sha256:fe22e6d8a4e54f734784819728f573d1908df2aef91024059836ee93c962febc",
							"kind": "agent-candidate-task-outcome",
							"material": {
								"executionPlanDigest": "sha256:6f55ca46fec25104581965551a60cd5014c26cd24909c0475b03eb078652418d",
								"kind": "agent-candidate-task-outcome-material",
								"outcome": {
									"artifact": {
										"byteLength": 6,
										"locator": {
											"bucket": "candidate-test-artifacts",
											"key": "task-output/eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5",
											"kind": "s3"
										},
										"sha256": "sha256:eda15ce4834ac303532bc6973df5ff8a5deb75d7dfceb9fc2cdf1bb450a01cf5"
									},
									"kind": "output",
									"spec": {
										"maxBytes": 1024,
										"mediaType": "text/plain"
									}
								}
							}
						},
						"termination": {
							"exitCode": 0,
							"kind": "exit"
						},
						"timing": {
							"durationMs": 50,
							"endedAtMs": 1550,
							"startedAtMs": 1500
						},
						"trace": {
							"artifact": {
								"byteLength": 750,
								"locator": {
									"bucket": "candidate-test-artifacts",
									"key": "trace/c7e89ef4e82a013106148486f338bd64f6f81371aa639633bdad555ba18d59fc",
									"kind": "s3"
								},
								"sha256": "sha256:c7e89ef4e82a013106148486f338bd64f6f81371aa639633bdad555ba18d59fc"
							},
							"eventCount": 1,
							"modelCallCount": 0
						}
					}
				}
			}
		],
		"metadata": {
			"fixture": "agent-improvement-proposal",
			"runtimeVersion": "0.278.1"
		},
		"objectives": [
			{
				"availability": "measured",
				"baseline": 0,
				"candidate": 1,
				"confidenceInterval": {
					"level": .95,
					"lower": 1,
					"method": "paired-bootstrap",
					"resamples": 500,
					"statistic": "mean",
					"upper": 1
				},
				"delta": 1,
				"direction": "higher-is-better",
				"kind": "objective",
				"n": 6,
				"name": "benchmark-score",
				"unit": "score"
			},
			{
				"availability": "measured",
				"baseline": 0,
				"candidate": 1,
				"confidenceInterval": {
					"level": .95,
					"lower": 1,
					"method": "paired-bootstrap",
					"resamples": 500,
					"statistic": "mean",
					"upper": 1
				},
				"delta": 1,
				"direction": "higher-is-better",
				"kind": "dimension",
				"n": 6,
				"name": "quality",
				"objective": "benchmark-score",
				"unit": "score"
			},
			{
				"availability": "measured",
				"baseline": 0,
				"candidate": 0,
				"confidenceInterval": {
					"level": .95,
					"lower": 0,
					"method": "paired-bootstrap",
					"resamples": 500,
					"statistic": "mean",
					"upper": 0
				},
				"delta": 0,
				"direction": "lower-is-better",
				"kind": "cost",
				"n": 6,
				"name": "cost",
				"unit": "usd"
			},
			{
				"availability": "measured",
				"baseline": 50,
				"candidate": 50,
				"confidenceInterval": {
					"level": .95,
					"lower": 0,
					"method": "paired-bootstrap",
					"resamples": 500,
					"statistic": "mean",
					"upper": 0
				},
				"delta": 0,
				"direction": "lower-is-better",
				"kind": "latency",
				"n": 6,
				"name": "latency",
				"unit": "milliseconds"
			}
		],
		"overall": {
			"baseline": 0,
			"candidate": 1,
			"confidenceInterval": {
				"level": .95,
				"lower": 1,
				"method": "paired-bootstrap",
				"resamples": 500,
				"statistic": "mean",
				"upper": 1
			},
			"delta": 1,
			"direction": "higher-is-better",
			"n": 6,
			"name": "composite",
			"unit": "score"
		},
		"power": {
			"confidenceLevel": .95,
			"minimumDetectableDelta": 0,
			"n": 6,
			"reason": "observed paired uncertainty gives a minimum detectable delta of 0.000 at 0.95 confidence from 6 runs. The same scorer evaluated both arms, so scorer bias is not measured.",
			"scaleAssumed": true,
			"sharedScorerChannel": true,
			"sufficient": true
		},
		"provenance": {
			"baselineContentHash": "sha256:5c21ee53e513fc604cb09754e21c392b24a424da0ef37dbf8f1ee4a8a0b08f09",
			"candidateContentHash": "sha256:60fcbb1c728194bd51d7d19cb732d1c3f1881dce7e0a6266b41c8b98cfd65693",
			"kind": "agent-eval-loop",
			"recordDigest": "sha256:6ca6acdfda4d50f6cf00dce395f2380841eb9d20b0a1396c18c9bb0b61cbb34f",
			"runId": "agent-runtime-0.278.1-proposal-fixture",
			"schema": "agent-candidate-experiment"
		}
	},
	findings: [{
		"analyst_id": "runtime-testing-fixture",
		"area": "prompt",
		"claim": "The baseline omits the exact measured answer.",
		"confidence": .9,
		"evidence_refs": [{
			"kind": "span",
			"uri": "runtime-testing-fixture-span"
		}],
		"finding_id": "runtime-testing-fixture-finding",
		"produced_at": "2026-07-10T00:30:00.000Z",
		"proposal_origin": "production",
		"recommended_action": "Return the exact measured answer.",
		"schema_version": "1.0.0",
		"severity": "high",
		"subject": "agent-profile:prompt.systemPrompt"
	}],
	kind: "agent-improvement-proposal",
	proposedAt: "2026-07-10T01:00:00.000Z",
	runId: "agent-runtime-0.278.1-proposal-fixture"
};
//#endregion
//#region src/testing/fixtures/agent-profile-improvement-proposal.json
var agent_profile_improvement_proposal_default = {
	changedSurfaces: ["prompt", "skills"],
	digest: "sha256:ab9e78bee0473005ffeec70f83559f99f4004a07c3621b46d199fd8f345272bb",
	evaluation: {
		"decision": {
			"contributingChecks": [
				{
					"name": "paired-significance",
					"passed": true
				},
				{
					"name": "paired-precision",
					"passed": true
				},
				{
					"name": "all-runs-completed",
					"passed": true
				},
				{
					"name": "no-task-regression",
					"passed": true
				},
				{
					"name": "critical-dimensions",
					"passed": true
				},
				{
					"name": "budget",
					"passed": true
				}
			],
			"outcome": "ship",
			"reasons": ["all measured checks passed"]
		},
		"diff": "[{\"id\":\"add-source-and-uncertainty\",\"kind\":\"agent-profile-diff\",\"set\":{\"prompt\":{\"systemPrompt\":\"Answer directly, cite the source, and state uncertainty.\"},\"resources\":{\"skills\":[{\"content\":\"Cite the evidence you use.\",\"kind\":\"inline\",\"name\":\"sources.SKILL.md\"}]}},\"source\":{\"artifacts\":[\"traces://run/profile-improvement-1\"],\"kind\":\"optimizer\"}}]",
		"evaluation": {
			"generationsExplored": 1,
			"measurement": {
				"cost": {
					"provenance": "observed",
					"usd": 132e-8
				},
				"wallDurationMs": 0,
				"workDurationMs": 1320
			},
			"preparation": {
				"cost": {
					"provenance": "observed",
					"usd": 0
				},
				"wallDurationMs": 0
			},
			"total": {
				"cost": {
					"provenance": "observed",
					"usd": 132e-8
				},
				"wallDurationMs": 0
			}
		},
		"experiment": {
			"baseline": { "stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704" },
			"benchmark": {
				"suite": {
					"digest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
					"digestAlgorithm": "rfc8785-sha256",
					"kind": "agent-profile-improvement-suite",
					"reps": 6,
					"seeds": [
						11,
						12,
						13,
						14,
						15,
						16
					],
					"splitDigest": "sha256:a8f4bdc4df6d527e21bcfeedf9fcbc007723329c25da5da8c9ad3e6887623e22",
					"taskDigests": ["sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e"]
				},
				"tasks": [{
					"digest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
					"digestAlgorithm": "rfc8785-sha256",
					"grader": {
						"artifact": {
							"byteLength": 1,
							"locator": {
								"bucket": "agent-eval",
								"key": "graders/profile-quality.json",
								"kind": "s3",
								"region": "us-east-1"
							},
							"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
						},
						"format": "tangle-grader",
						"name": "profile-quality",
						"version": "1"
					},
					"kind": "agent-profile-improvement-task",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"model": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"scenario": {
						"digest": "sha256:b50dec7031d699e2e0cfca8b4fd1eb958b687030a1af7a5339090dc9ca0892bf",
						"id": "support-case-1",
						"kind": "support-case"
					}
				}]
			},
			"candidate": { "stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9" },
			"candidateLineage": {
				"developmentSplitDigest": "sha256:02da010d5b66a91bc293d928ed8297f05950f56f3127f058f94b8766bc6a2b76",
				"parentDigests": ["sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704"],
				"runIds": ["profile-improvement-1"],
				"source": "optimizer"
			},
			"change": [{
				"id": "add-source-and-uncertainty",
				"kind": "agent-profile-diff",
				"set": {
					"prompt": { "systemPrompt": "Answer directly, cite the source, and state uncertainty." },
					"resources": { "skills": [{
						"content": "Cite the evidence you use.",
						"kind": "inline",
						"name": "sources.SKILL.md"
					}] }
				},
				"source": {
					"artifacts": ["traces://run/profile-improvement-1"],
					"kind": "optimizer"
				}
			}],
			"digest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
			"digestAlgorithm": "rfc8785-sha256",
			"executionRef": {
				"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
				"identity": "profile-improvement-fixture-runner",
				"kind": "agent-profile-improvement-execution-ref"
			},
			"kind": "agent-profile-improvement-experiment",
			"policy": {
				"bootstrapSeed": 17,
				"confidenceLevel": .95,
				"criticalDimensions": [],
				"deltaThreshold": 0,
				"minProductiveRuns": 6,
				"regressionTolerance": 0,
				"resamples": 100
			},
			"source": {
				"kind": "platform-agent-profile",
				"sourceDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
				"sourceIdentity": "profile-support",
				"sourceRevision": 7
			}
		},
		"kind": "agent-profile-improvement-measured-comparison",
		"measurements": [
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:f8df8abb545f964e51ae5dfbe371db8812ffc67e1ac620467004d1d14622aebb",
						"identity": "bill-baseline-0",
						"kind": "platform-billing"
					}],
					"digest": "sha256:9fb7c227fa5da24956b7ea5b59dfe7cd33e4cd3aa21c81e1506191da9dc23843",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-0",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:d4df39e172d3701cceb170a3b4f809aebc61c050acc6f0ded51cd178bd8bad79",
							"identity": "grade-baseline-0",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 110,
							"startedAtMs": 100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:45115d63436a7d83e2f45b791804f24047db2f69377b9796c41b39337110de18",
						"identity": "output-baseline-0",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:745c5a3301ab1efb555d3b42246fa4cfcaaf3439e4767b03d698ee2225125991",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 0,
						"seed": 11,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:7e8cdb47c8f1c5200bd55f6ecbb05f060d13e93c542978a0cb67eef1f7ea7cd9",
						"identity": "baseline-0",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 100,
						"startedAtMs": 0
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:7bbb44eebc7f286a293da7309af86cb966ab31a37dc30e9d993523cddfb0a65c",
							"identity": "trace-baseline-0",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:fc4aebe4eb99e761a95279dcfe7478596a505fd5c5611cfa62d2f1dbe5d98c2f",
						"identity": "bill-candidate-0",
						"kind": "platform-billing"
					}],
					"digest": "sha256:6caab48474a18ccb40129f298bc498434937ffd5274f98c4f82f5b615087a13c",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-0",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:d1c4971c7a415aaa1e2a1101611a18aa7c3870411c058cadba35b21fd2faf27a",
							"identity": "grade-candidate-0",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 110,
							"startedAtMs": 100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:3d57f4f4f14a76c3b7a5a9edc47e8e5d8033896d474a454da74125362456639f",
						"identity": "output-candidate-0",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:2f3d62d5445c7465c2c00a5d01b9c63fb78fb5010db53a29f1f874f063d4a6f1",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 0,
						"seed": 11,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:9ea29e94240319216941b87edcc391aed43d45d8081f8b43849591748606e78f",
						"identity": "candidate-0",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 100,
						"startedAtMs": 0
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:63806d09543cd4337accb01f4806e6825e2fa40b219d0d90ffbcaf369b4cbb5f",
							"identity": "trace-candidate-0",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			},
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:0ec2f0978881d5717c3b7bf9ea888b73580693ee5b8e232cb40cb7e57503f263",
						"identity": "bill-baseline-1",
						"kind": "platform-billing"
					}],
					"digest": "sha256:9b56aeae4c91105ad4b8b2c9f0ae0255292f3d62d4d30c7f067c22ed30823024",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-1",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:26079c88be9d35bb6505546daaaae5263a5a86ce7a2958656e95ce77f42d57db",
							"identity": "grade-baseline-1",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 1110,
							"startedAtMs": 1100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:c3a0a3eab137f6c1e232721d2c7db1237ecb9ec1625447ee1d8d90de0bf2bd33",
						"identity": "output-baseline-1",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:e9160f85a2f4260e664edea9eb2331bd082cc7831a339422e59fb29cdd2f2165",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 1,
						"seed": 12,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:581e68267991f493474b1f35fc07a95efd9781b55ded5fde4080df55e4ee724b",
						"identity": "baseline-1",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 1100,
						"startedAtMs": 1e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:0be44b67b6482a4d6238a50f98edfd3b406b9a15ca39bc7002fba7fdefaf3a72",
							"identity": "trace-baseline-1",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:f35d12be88a231cdfaf25ef346a075a2866f93d9fba24dfe6a33948d7d819ef7",
						"identity": "bill-candidate-1",
						"kind": "platform-billing"
					}],
					"digest": "sha256:ec0a2eea90dbccc5b45a49a8108f785da8e7113ac582576d96ec76e5a47b4b22",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-1",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:7ed258fae411110158ff573735ad08e4c0ca32b1e5edf8705a475b8f91aae055",
							"identity": "grade-candidate-1",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 1110,
							"startedAtMs": 1100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:abe4d04fa6375d75469aa41839eb34758c4a5cdf17b204a2294b1d1a9faa8ffb",
						"identity": "output-candidate-1",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:cf228d0b37c328ff8db272fd19471309b5a7702c8f0daa7e7f90ea0fa045e1a1",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 1,
						"seed": 12,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:dafe5fbae73dab4b49b3411fc26cc436ddc463dfd0ef86ee23c8b0a91c81be67",
						"identity": "candidate-1",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 1100,
						"startedAtMs": 1e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:6a33d6b9699ebf78e92845bdae506a3b37e9598a3ead4b5f01676d9573c2fc1a",
							"identity": "trace-candidate-1",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			},
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:6365caecc9b3f4a7d7fa3b3a7efea8a76fc50d93129b02f7ba448ceee6b806a1",
						"identity": "bill-baseline-2",
						"kind": "platform-billing"
					}],
					"digest": "sha256:81179ac7f44a5fb2d7235090b42d0f4a3323a559e8e223a3455a8351a85376d5",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-2",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:2e6344b8ab46798df75c6c8bd2e9c1c4ba5371cfdb84ef12916226a06ee0bffc",
							"identity": "grade-baseline-2",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 2110,
							"startedAtMs": 2100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:7ecb1cb5e93f0154d39393745ca59c763725073a528396dacc06703ff6559a72",
						"identity": "output-baseline-2",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:939650c27cbe81bc0c4cff1fc7a82de336f7320055c747263ae8f48956eb553b",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 2,
						"seed": 13,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:136ff81d5b2a688db3fbe00bbfabb593e6179d9e71142d687ef38208b2301cd3",
						"identity": "baseline-2",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 2100,
						"startedAtMs": 2e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:a9c52e32611334aa710c0930b36aa3a2faf45dfdb77f083e9e4c02ab67b2812e",
							"identity": "trace-baseline-2",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:f5f6023645c3d531f29eb0b331787117a1c87d1cd5d53f434ab4a5ab8eb1caba",
						"identity": "bill-candidate-2",
						"kind": "platform-billing"
					}],
					"digest": "sha256:e9435761e04ad9b55f189c4193da92db86d95dbd50c4070b6c39d08d6199f1a6",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-2",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:9046047f8a5ad8cda1e059047b3bac42abb438a8d9f9a60c0a139af5375dc313",
							"identity": "grade-candidate-2",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 2110,
							"startedAtMs": 2100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:58439d73500b422267dfc9d873a9132aa384ebbf706b75fdfa69793b70f65d65",
						"identity": "output-candidate-2",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:592b772b5b6f4173326d63dfc26385dec1afd341a02652d1ab3e2565db00618d",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 2,
						"seed": 13,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:e3c9377d8fc6c3f427f8ba79a2e2cfec2319d2cf2e923f1344db26195780bc0f",
						"identity": "candidate-2",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 2100,
						"startedAtMs": 2e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:7b862fccf82622a8c3a5b0816f5a543ba61454972e8799219948df150fd0a7fa",
							"identity": "trace-candidate-2",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			},
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:892c93e38d998923d0b8554e263697d3464d5c72fb65c906d2670c96ed2772d9",
						"identity": "bill-baseline-3",
						"kind": "platform-billing"
					}],
					"digest": "sha256:9814d56f62fe89eb2117c0d601277942dc3b39d1180ca2c4d99ce5eeb993855c",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-3",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:07788322298c858cafa5bb76dd6157c829c62aca6a4704ac79f22c6b4b21336f",
							"identity": "grade-baseline-3",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 3110,
							"startedAtMs": 3100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:81727faee4350b38ca7595dba4285c789e10593a0f6aea2b9ce76d4f86cea599",
						"identity": "output-baseline-3",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:342f37fe2e308da563441ce55032c5ddb0c6346ce164be8fdac8ccb721363d4b",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 3,
						"seed": 14,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:fb00c3123bf7fcccac400841d61016c16887862d31a550e5d23257bc668896ba",
						"identity": "baseline-3",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 3100,
						"startedAtMs": 3e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:e717d226e3e2ce07ba3e3c4414e2a2a4f6d6cac74ec0150a6b801e77c4b39316",
							"identity": "trace-baseline-3",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:30531e299ca8bb791ec3d5ab7c971e4936b6684618edff82e8e1a2d4dd290b3f",
						"identity": "bill-candidate-3",
						"kind": "platform-billing"
					}],
					"digest": "sha256:779310f3803ac4b11af3953f5ef0e4ed78a28b8623f296890d7bedfc2291241f",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-3",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:71a58edd2c20b7fea3b0d3a7bdf5c74d07202fafe2e732095bae9278eac5b116",
							"identity": "grade-candidate-3",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 3110,
							"startedAtMs": 3100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:c16851a93cdefe33b8b45cb867778311fd4dd9558a8f8a07e01e0f85cf1b185d",
						"identity": "output-candidate-3",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:6881c9a48aff99ff04cf6cd093ed4874b738d5caafe037ec092ef01a14952e91",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 3,
						"seed": 14,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:484098e5361aebc2a329b1e1bc6115eb25e875b70c6d5304ba3ed60061342f04",
						"identity": "candidate-3",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 3100,
						"startedAtMs": 3e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:a28cba5e9ec92bdd10f9f40e0b1c03afb5fe3b02ff0336eac99e90fa13d8e90a",
							"identity": "trace-candidate-3",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			},
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:a92691643d523f9b2c65a07bad3ebb7cab1208d9e6f8b89e02a03dff94118e50",
						"identity": "bill-baseline-4",
						"kind": "platform-billing"
					}],
					"digest": "sha256:cacfbed32553c79cf82eaecb785ca862c08fe3574fb94c8959991deb441e6fef",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-4",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:6c58123a53b460008177098be12a383f0b5374f316a7140174ac82be0db3adaa",
							"identity": "grade-baseline-4",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 4110,
							"startedAtMs": 4100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:615106eb847006697d4620d05c187a94823889a4473badd0a07303a9032b2284",
						"identity": "output-baseline-4",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:dee290df063907e15670b5698b2e63e3e864ecc00488996542653ed9044af0cf",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 4,
						"seed": 15,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:69fb92a630f39d09af62d90c6804776f323fe9f77296dc9fe108a0fd3158b900",
						"identity": "baseline-4",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 4100,
						"startedAtMs": 4e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:083c3243eb09de3156aa11368682870650e5200b5b2fd22db455713a06ce9a8a",
							"identity": "trace-baseline-4",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:fab7b18e8e7d41e1505389c8705777e9e2aec69282001a0add7daee20e24c336",
						"identity": "bill-candidate-4",
						"kind": "platform-billing"
					}],
					"digest": "sha256:51730613cefb40c07f29ce0fe8c540ed05e7ace01425d0bd2ed5454329265f63",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-4",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:6ead9603dd9ea15cfc402a0f950dd9e8205a6465aa7acac314160336d2aba0e4",
							"identity": "grade-candidate-4",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 4110,
							"startedAtMs": 4100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:aca68029442903352a2805700cf9ea9186496527c6bf39f838a12390187f4682",
						"identity": "output-candidate-4",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:773c46a77bfdfa531ace1366f89ecb828af2b2aea0a0672ea1b98ea454caf851",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 4,
						"seed": 15,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:0f08a0e6efa47853f0a659c773e9123a895df05d40880652a2179c3c9c2d961b",
						"identity": "candidate-4",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 4100,
						"startedAtMs": 4e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:efe9b7967f778cfec64888cda8a1f453046570908f76968fb590dd431b4f6548",
							"identity": "trace-candidate-4",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			},
			{
				"baseline": {
					"billing": [{
						"digest": "sha256:5183f6e4e7e365b20ce28c8eea515dc92f2216e68bf23bdf9992246f654e61f8",
						"identity": "bill-baseline-5",
						"kind": "platform-billing"
					}],
					"digest": "sha256:8ccb242c4ea5f495acae43066d834c1e8727e8dd26e87e55a347fc7cfbbce92b",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "baseline-5",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 0
						}],
						"evidence": {
							"digest": "sha256:32fdacdb9349ddc2ca221951feef7560ca9f3979d303ac67bd8fc3ff04093a03",
							"identity": "grade-baseline-5",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 0,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 5110,
							"startedAtMs": 5100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:1fa52a28ead42ebc954be9366f6bec527b94bb5544814aa1e7e1587d6d899dbc",
						"identity": "output-baseline-5",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "baseline",
						"attempt": 1,
						"digest": "sha256:0c5c88a7c96db14b417d02647f9c279945359a4b0fc6d00e553db98516edbe0b",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 5,
						"seed": 16,
						"stateDigest": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:6a8b89a9be3f5aaf16483e2e8f2a0cf431257a2a5b35d360725e91ddb8e18c3f",
						"identity": "baseline-5",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 5100,
						"startedAtMs": 5e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:3eaea5954686eb541298a788423c3fed03650cf4f812d8f965f10f64f0e05407",
							"identity": "trace-baseline-5",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				},
				"candidate": {
					"billing": [{
						"digest": "sha256:85584f14379aaef9fce4de620491db34c5398138d2a27ab4993beaafd7fb2ded",
						"identity": "bill-candidate-5",
						"kind": "platform-billing"
					}],
					"digest": "sha256:a310c0e890411558f35d66d9b7b6c8adfce8c9c8f9faa6b8b043de53acbb5f6e",
					"digestAlgorithm": "rfc8785-sha256",
					"executionId": "candidate-5",
					"executionRef": {
						"digest": "sha256:42c6816336a75799acbb6db06649ebac5ec2802924f5173f7df692a46f5b9356",
						"identity": "profile-improvement-fixture-runner",
						"kind": "agent-profile-improvement-execution-ref"
					},
					"grading": {
						"dimensions": [{
							"name": "quality",
							"score": 1
						}],
						"evidence": {
							"digest": "sha256:f4aa4f3e1f909ab5fcca1c12bd80787c184472092abfdac52dc8ec1588c3b144",
							"identity": "grade-candidate-5",
							"kind": "agent-eval-grading"
						},
						"grader": {
							"artifact": {
								"byteLength": 1,
								"locator": {
									"bucket": "agent-eval",
									"key": "graders/profile-quality.json",
									"kind": "s3",
									"region": "us-east-1"
								},
								"sha256": "sha256:1f576a8a9d7f4af7bf070698b2be73904847d6f28efec0c2366d1f2bc6117e0f"
							},
							"format": "tangle-grader",
							"name": "profile-quality",
							"version": "1"
						},
						"passed": true,
						"score": 1,
						"timing": {
							"durationMs": 10,
							"endedAtMs": 5110,
							"startedAtMs": 5100
						},
						"usage": {
							"cachedInputTokens": 0,
							"costProvenance": "observed",
							"costUsdNanos": 10,
							"inputTokens": 2,
							"modelCalls": 1,
							"outputTokens": 1,
							"reasoningTokens": 0
						}
					},
					"kind": "agent-profile-improvement-run",
					"limits": {
						"maxCostUsd": 1,
						"maxInputTokens": 1e3,
						"maxModelCalls": 2,
						"maxOutputTokens": 1e3,
						"maxSteps": 10,
						"timeoutMs": 3e4
					},
					"outcome": { "status": "succeeded" },
					"output": {
						"digest": "sha256:3eb6e825ca334f34f765d10168e669ffcfe85738e727ddafc333e4f201b76661",
						"identity": "output-candidate-5",
						"kind": "platform-output"
					},
					"resolvedModel": {
						"model": "claude-sonnet-4-6",
						"provider": "anthropic",
						"reasoningEffort": "medium",
						"requested": "anthropic/claude-sonnet-4-6",
						"snapshot": "2026-06-01"
					},
					"runCell": {
						"arm": "candidate",
						"attempt": 1,
						"digest": "sha256:f75ad3abf708448d6f305ff5a489e55aa8555056ac7a2898af711a032cd0962c",
						"experimentDigest": "sha256:736f9dfed636de4b3f0a24526c6fa8e1265700d3b506753e943e507d665148c9",
						"kind": "agent-profile-improvement-run-cell",
						"repetition": 5,
						"seed": 16,
						"stateDigest": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
						"suiteDigest": "sha256:ae6a128ac345faa69b7628f6a6257e37c1e41c75613309a4fd5f1c263ea29ad8",
						"taskDigest": "sha256:7e5db980d166e67bc366f2f08e25cab5a2f8558530744f6755ee5997ef345c1e",
						"taskIndex": 0
					},
					"runRecord": {
						"digest": "sha256:ab58376b10681039d0472ab1c1bf5e76a8e1967b9158a956e9ca78aa81526277",
						"identity": "candidate-5",
						"kind": "agent-eval-run-record"
					},
					"steps": 1,
					"timing": {
						"durationMs": 100,
						"endedAtMs": 5100,
						"startedAtMs": 5e3
					},
					"trace": {
						"eventCount": 4,
						"evidence": {
							"digest": "sha256:297f74e8c102a1049b4d30a8cc359bcce03e5b4367c15b051676662b768114c3",
							"identity": "trace-candidate-5",
							"kind": "platform-trace"
						},
						"modelCallCount": 1
					},
					"usage": {
						"cachedInputTokens": 0,
						"costProvenance": "observed",
						"costUsdNanos": 100,
						"inputTokens": 10,
						"modelCalls": 1,
						"outputTokens": 5,
						"reasoningTokens": 0
					}
				}
			}
		],
		"metadata": {
			"fixture": "agent-profile-improvement-proposal",
			"runtimeVersion": "0.278.1"
		},
		"objectives": [
			{
				"availability": "measured",
				"baseline": 0,
				"candidate": 1,
				"confidenceInterval": {
					"level": .95,
					"lower": 1,
					"method": "paired-bootstrap",
					"resamples": 100,
					"statistic": "mean",
					"upper": 1
				},
				"delta": 1,
				"direction": "higher-is-better",
				"kind": "objective",
				"n": 6,
				"name": "benchmark-score",
				"unit": "score"
			},
			{
				"availability": "measured",
				"baseline": 0,
				"candidate": 1,
				"confidenceInterval": {
					"level": .95,
					"lower": 1,
					"method": "paired-bootstrap",
					"resamples": 100,
					"statistic": "mean",
					"upper": 1
				},
				"delta": 1,
				"direction": "higher-is-better",
				"kind": "dimension",
				"n": 6,
				"name": "quality",
				"objective": "benchmark-score",
				"unit": "score"
			},
			{
				"availability": "measured",
				"baseline": 11e-8,
				"candidate": 11e-8,
				"confidenceInterval": {
					"level": .95,
					"lower": 0,
					"method": "paired-bootstrap",
					"resamples": 100,
					"statistic": "mean",
					"upper": 0
				},
				"delta": 0,
				"direction": "lower-is-better",
				"kind": "cost",
				"n": 6,
				"name": "cost",
				"unit": "usd"
			},
			{
				"availability": "measured",
				"baseline": 110,
				"candidate": 110,
				"confidenceInterval": {
					"level": .95,
					"lower": 0,
					"method": "paired-bootstrap",
					"resamples": 100,
					"statistic": "mean",
					"upper": 0
				},
				"delta": 0,
				"direction": "lower-is-better",
				"kind": "latency",
				"n": 6,
				"name": "latency",
				"unit": "milliseconds"
			}
		],
		"overall": {
			"baseline": 0,
			"candidate": 1,
			"confidenceInterval": {
				"level": .95,
				"lower": 1,
				"method": "paired-bootstrap",
				"resamples": 100,
				"statistic": "mean",
				"upper": 1
			},
			"delta": 1,
			"direction": "higher-is-better",
			"n": 6,
			"name": "composite",
			"unit": "score"
		},
		"power": {
			"confidenceLevel": .95,
			"minimumDetectableDelta": 0,
			"n": 6,
			"reason": "observed paired uncertainty gives a minimum detectable delta of 0.000 at 0.95 confidence from 6 runs. The same scorer evaluated both arms, so scorer bias is not measured.",
			"scaleAssumed": true,
			"sharedScorerChannel": true,
			"sufficient": true
		},
		"provenance": {
			"baselineContentHash": "sha256:21c495a37c418c10bde64fbaa188beddeed31f1f051ea60a6a6582a9ee0db704",
			"candidateContentHash": "sha256:103f77bc8481601eef1ad5fe6ba84a40dffabc3a44f421f8c8559121edab84e9",
			"kind": "agent-eval-loop",
			"recordDigest": "sha256:54f23fe57dff974f76397335dda44cf496a349b41963fa1bc08976e08c38d779",
			"runId": "profile-improvement-1",
			"schema": "agent-profile-improvement-experiment"
		}
	},
	findings: [],
	kind: "agent-improvement-proposal",
	proposedAt: "2026-07-10T01:30:00.000Z",
	runId: "profile-improvement-1"
};
//#endregion
//#region src/testing/fixtures/agent-profile-improvement-state.json
var agent_profile_improvement_state_default = {
	baselineProfile: {
		"name": "support-agent",
		"prompt": { "systemPrompt": "Answer directly." },
		"tools": { "Read": true },
		"resources": { "skills": [{
			"kind": "inline",
			"name": "support.SKILL.md",
			"content": "Use the support case context."
		}] }
	},
	candidateProfile: {
		"name": "support-agent",
		"prompt": { "systemPrompt": "Answer directly, cite the source, and state uncertainty." },
		"tools": { "Read": true },
		"resources": { "skills": [{
			"kind": "inline",
			"name": "support.SKILL.md",
			"content": "Use the support case context."
		}, {
			"kind": "inline",
			"name": "sources.SKILL.md",
			"content": "Cite the evidence you use."
		}] }
	},
	recommendedSize: "small"
};
//#endregion
//#region src/testing/index.ts
const serializedAgentImprovementProposalFixture = JSON.stringify(agent_improvement_proposal_default);
const serializedAgentProfileImprovementProposalFixture = JSON.stringify(agent_profile_improvement_proposal_default);
const serializedAgentProfileImprovementStateFixture = JSON.stringify(agent_profile_improvement_state_default);
/** Load an isolated, production-validated Runtime proposal for consumer tests. */
function loadAgentImprovementProposalFixture() {
	return verifyAgentImprovementProposal(JSON.parse(serializedAgentImprovementProposalFixture));
}
/** Load an isolated profile proposal and its private activation state for consumer tests. */
function loadAgentProfileImprovementFixture() {
	const proposal = loadAgentProfileImprovementProposal();
	const state = parseAgentProfileImprovementState(JSON.parse(serializedAgentProfileImprovementStateFixture));
	const experiment = proposal.evaluation.experiment;
	const baselineStateDigest = profileStateDigest(state.baselineProfile, state.recommendedSize);
	const candidateStateDigest = profileStateDigest(state.candidateProfile, state.recommendedSize);
	if (baselineStateDigest !== experiment.baseline.stateDigest || candidateStateDigest !== experiment.candidate.stateDigest) throw new Error("profile improvement fixture state does not match its proposal");
	if (canonicalAgentProfileDigest(experiment.change.reduce((profile, change, index) => applyExactAgentProfileDiff(profile, change, `profile improvement fixture change ${index}`), state.baselineProfile)) !== canonicalAgentProfileDigest(state.candidateProfile)) throw new Error("profile improvement fixture candidate does not match its proposal changes");
	return immutableCandidateValue({
		proposal,
		...state
	});
}
function loadAgentProfileImprovementProposal() {
	const proposal = verifyAgentImprovementProposal(JSON.parse(serializedAgentProfileImprovementProposalFixture));
	if (proposal.evaluation.kind !== "agent-profile-improvement-measured-comparison") throw new Error("profile improvement fixture contains a sealed candidate comparison");
	return {
		...proposal,
		evaluation: proposal.evaluation
	};
}
function parseAgentProfileImprovementState(input) {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("profile improvement fixture state must be an object");
	const record = input;
	const fields = Object.keys(record).sort();
	const expectedFields = [
		"baselineProfile",
		"candidateProfile",
		"recommendedSize"
	];
	if (fields.length !== expectedFields.length || fields.some((field, i) => field !== expectedFields[i])) throw new Error("profile improvement fixture state contains unsupported fields");
	const recommendedSize = SANDBOX_SIZE_PRESET_NAMES.find((size) => size === record.recommendedSize);
	if (!recommendedSize) throw new Error("profile improvement fixture has an invalid recommended size");
	return {
		baselineProfile: parseExactAgentProfile(record.baselineProfile, "profile improvement fixture baseline"),
		candidateProfile: parseExactAgentProfile(record.candidateProfile, "profile improvement fixture candidate"),
		recommendedSize
	};
}
function profileStateDigest(profile, recommendedSize) {
	return canonicalCandidateDigest$1({
		definition: profile,
		recommendedSize
	});
}
//#endregion
export { driverAgent, loadAgentImprovementProposalFixture, loadAgentProfileImprovementFixture, runGraphWithTestBrain, superviseWithTestBrain, supervisorAgentWithTestBrain };

//# sourceMappingURL=testing.js.map
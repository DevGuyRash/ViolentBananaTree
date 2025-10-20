## Open Questions Log

| ID | Question | Current Stance | Owner | Next Step |
| --- | --- | --- | --- | --- |
| OQ-1 | What telemetry (if any) is acceptable post-MVP for selector miss analytics while preserving privacy? | Telemetry remains out-of-scope for MVP; post-MVP needs opt-in client-only analytics aligned with privacy constraints. | Release Manager | Draft privacy-focused telemetry proposal referencing steering non-goals and circulate for approval in post-MVP planning. |
| OQ-2 | How should selector map versioning and migration be handled when recorder evolves schema fields (e.g., scoring metadata)? | Need defined schema versioning strategy tied to recorder exports to avoid breaking existing scripts. | Selector System Lead | Produce schema versioning RFC mapping recorder export fields to runtime expectations and schedule review. |
| OQ-3 | What criteria trigger investment in auto-healing selectors versus manual JSON updates? | Monitoring needed to justify automation; thresholds yet to be defined. | Product Owner | Collect selector miss data once MVP telemetry decision lands; define threshold and mitigation playbook. |

## Resolved Questions

- **Additional step kinds (drag-and-drop, file upload):** Deferred to post-MVP backlog (Decision D-1 in requirements). Owner: Product Owner. Next step: Re-evaluate after recorder and DSL parity goals complete.
- **Grants and CSP exceptions documentation:** Documentation stream will host MV3 deployment guidance (Decision D-2 in requirements). Owner: Docs Lead. Next step: Align with build/tooling CI updates during MVP delivery.

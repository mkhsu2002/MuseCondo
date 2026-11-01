# Tower Lord console — v1.15

The first Tower Lord console provides a protected, read-only view of a Tower's residents, applications, Manager execution history and recorded token/cost usage.

- Human access is scoped through Cloudflare Access and independently verified by the application.
- Resident, application and review states remain distinct.
- History supports filtering and cursor pagination across recorded execution stages.
- Usage distinguishes known calculated costs, unknown measurements and reserved exposure.
- Formal Handover remains disabled; notifications and guarded management controls are planned.

Read the [console guide](TOWER-LORD-CONSOLE.md) for configuration and behavior, or the [roadmap](plans/TOWER-LORD.md) for future development. This release preserves the existing resident admission order.

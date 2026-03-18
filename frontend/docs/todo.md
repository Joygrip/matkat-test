Work only on Phase 1: Microsoft Entra login and backend token validation.

Context:
- This repo is a resource planning / actuals / approvals app.
- Current backend auth is in api/app/auth/dependencies.py.
- In dev mode, DEV_AUTH_BYPASS=true allows X-Dev-* headers.
- In non-dev mode, backend currently returns 501 AUTH_NOT_CONFIGURED.
- Goal: implement real Entra-based login/token validation while preserving dev bypass for local development only.
- Do NOT implement Graph sync yet.
- Do NOT change approval routing yet.
- Do NOT modify unrelated business logic.

Inspect only:
- api/app/auth/dependencies.py
- api/app/config.py
- frontend auth/config files
- frontend API client files
- any existing auth-related frontend files
- package.json / frontend env config if needed

Tasks:
1. Implement the real authentication flow skeleton for this repo:
   - frontend signs in with Microsoft Entra
   - frontend sends bearer token to backend
   - backend validates token
   - backend constructs CurrentUser from validated identity
2. Keep DEV_AUTH_BYPASS working only when ENV=dev and DEV_AUTH_BYPASS=true.
3. In non-dev mode, remove the 501 placeholder path.
4. Minimize changes and do not add Graph profile sync in this phase.
5. If a DB lookup is needed to build CurrentUser, design it cleanly but keep scope limited.

Output:
- files changed
- exact env vars required
- exact Entra app registration values needed
- short explanation of frontend login flow
- short explanation of backend validation flow
- follow-up step needed for Phase 2 (Graph sync on login)

Work only on Phase 2: Microsoft Graph sync on login.

Context:
- Phase 1 implemented real Entra login and backend token validation.
- This app needs manager -> employee relationships for approval routing.
- Graph should be used as the source of user profile + manager relationship data.
- Approval routing itself should NOT query Graph live; it should use synced DB fields.
- Do NOT redesign the whole app.
- Do NOT implement background sync yet.
- Do NOT change unrelated frontend pages.

Inspect only:
- auth/dependencies.py
- user/resource models
- approval-related models/services only if needed to understand field usage
- config.py
- any service layer files where user/resource creation belongs

Tasks:
1. Add a backend Graph integration path for login-time sync of:
   - current user profile
   - manager relationship
2. Create/update app DB user/resource records using Graph data.
3. Store manager relationship in DB fields suitable for later approval routing.
4. Keep external resources supported by not assuming every Resource exists in Graph.
5. Minimize changes and prepare the repo for later background sync.

Output:
- files changed
- exact Graph fields used
- exact DB fields written
- any required model changes
- list of Graph permissions needed for this phase only
- follow-up step needed for Phase 3 (approval routing from DB manager relationships)

Work only on Phase 3: approval routing using the synced manager relationship stored in the app database.

Context:
- Phase 1 implemented real Entra login and backend token validation.
- Phase 2 implemented Microsoft Graph sync on login for:
  - current user profile
  - manager relationship
- The app now stores manager relationship data in the DB (for example manager_object_id or equivalent).
- This application is a resource planning / actuals / approvals system.
- Approval routing must use the app DB as the source of truth.
- Do NOT call Microsoft Graph live during approval creation or approval evaluation.
- RO and Director routing remain app-specific and must still be supported.
- External resources and non-Entra resources must still be handled safely.
- Do NOT work on frontend login, background sync, or infrastructure in this phase.

Goal:
Update approval routing so that actual-time approvals (and any other approval flows that depend on reporting structure) use the synced manager relationship from the DB.

Inspect only:
- approval-related routers
- approval-related services
- approval-related models
- user/resource models
- any helper/service files used to determine approvers
- auth/current user types only if needed to understand object_id / tenant context

Tasks:
1. Find where approval steps are currently created or routed.
2. Identify how the first approver for actual time is determined today.
3. Replace or update that logic so the first approver comes from the synced DB manager relationship, not from dev-only logic or future live Graph assumptions.
4. Preserve existing RO / Director approval logic unless a small change is required for consistency.
5. Add safe handling for cases where:
   - the employee/resource has no synced manager
   - the resource is external / contractor
   - the manager is missing or inactive
6. If the current model needs a small helper function/service for approver resolution, create it cleanly.
7. Keep changes minimal and localized.

Rules:
- Do NOT redesign the whole approval system.
- Do NOT add live Graph calls.
- Do NOT remove support for external resources.
- Do NOT refactor unrelated routers/pages/components.
- Prefer a small, explicit approval-resolution function over scattered logic.
- If approval routing depends on tenant-scoped user/resource lookup, preserve tenant safety.
- If there is an existing approval step model, keep using it rather than inventing a new workflow system.

Implementation expectations:
- Approval resolution should prefer:
  1. synced DB manager relationship for manager approval
  2. app-owned RO/director routing where required
  3. explicit fallback behavior when manager data is missing
- If fallback behavior is unclear from code, implement the safest minimal option and clearly document it in your output.

Output:
1. Files changed
2. Exact approval-routing rule after the change
3. How manager-based routing now works
4. How RO/director routing still works
5. How external-resource / missing-manager cases are handled
6. Any model/service/helper added
7. Any follow-up needed for Phase 4 (background sync / hardening)

Validation criteria:
- An employee with a synced manager gets routed to that manager first
- Approval routing does not require live Graph
- Missing-manager cases do not crash the workflow
- External resources still follow a defined path
- Existing role/tenant protections still apply

Work only on Phase 4: background sync and production hardening for Microsoft Graph-backed user/resource relationships.

Context:
- Phase 1 implemented real Entra login and backend token validation.
- Phase 2 implemented Graph sync on login for current user + manager relationship.
- Phase 3 updated approval routing to use the synced manager relationship stored in the app DB.
- The app is a resource planning / actuals / approvals system.
- Approval routing must continue to use DB-stored relationships, not live Graph calls.
- This phase is about keeping user/resource/manager data correct over time and making the design safer for production.
- Do NOT redesign the full application.
- Do NOT change unrelated frontend business UI.
- Do NOT rework infrastructure/Bicep in this phase.

Goal:
Add a production-grade background sync pattern so Graph-backed identity and reporting structure data can be refreshed safely and consistently, while preserving support for external/app-owned resources.

Inspect only:
- scheduler / Azure Functions files
- Graph integration service files created earlier
- user/resource models
- approval-related models/services only if needed to understand manager data usage
- config/env files related to auth/sync settings
- any admin/dev utility routes that may help with sync triggers

Tasks:
1. Design and implement a background sync flow for Microsoft Graph-backed users/resources.
2. Ensure the sync updates:
   - user profile fields needed by the app
   - manager relationship fields
   - resource-linked identity fields where applicable
3. Keep approval routing DB-driven; do NOT add live Graph dependency to approval processing.
4. Add safe handling for:
   - users no longer found in Graph
   - changed managers
   - inactive or disabled users
   - external resources with no Graph identity
   - users/resources that have app-owned overrides
5. If useful, add:
   - a scheduled sync entry point
   - an on-demand admin sync trigger
   - status logging / lightweight sync result reporting
6. Keep changes minimal and focused.
7. Preserve tenant safety if the app is tenant-scoped.

Rules:
- Do NOT add live Graph calls to approval runtime.
- Do NOT remove support for external resources.
- Do NOT overwrite app-owned business metadata unnecessarily.
- Do NOT assume every Resource has a Graph-backed User.
- Prefer explicit sync logic over hidden side effects.
- If a user/resource has app-owned override fields, preserve them unless the code clearly indicates they should be replaced.
- If there is no clear “inactive” concept in the repo, implement the safest minimal non-destructive behavior and document it.

Implementation expectations:
- Graph-backed identity fields should be refreshed by sync
- app-owned fields should remain under app control
- manager relationship updates should be auditable and safe
- approval routing should continue to read manager data from DB only
- sync should be able to run repeatedly without corrupting data

Output:
1. Files changed
2. What the background sync now does
3. Which fields are refreshed from Graph
4. Which fields remain app-owned
5. How manager changes are handled
6. How missing/deleted/inactive Graph users are handled
7. How external resources are handled
8. Whether a scheduled sync and/or admin-triggered sync was added
9. Any env vars or config needed
10. Any follow-up recommended for final production rollout

Validation criteria:
- A user’s manager change in Graph can be reflected in DB after sync
- Approval routing still works without live Graph access
- External resources remain valid and are not broken by sync
- Re-running sync does not duplicate or corrupt users/resources
- The system handles “user missing from Graph” cases safely
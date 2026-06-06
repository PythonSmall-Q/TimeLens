# Widget Permission E2E Checklist

## Scope

Verify end-to-end behavior for third-party widget permission governance:

1. Import widget
2. Grant permissions
3. Call restricted methods
4. Revoke permissions
5. Verify denied after revoke

## Preconditions

- Desktop app running with latest local code
- At least one third-party widget manifest that requests permissions
- Widget Center can import local widgets

## Test Case A: Import -> Grant -> Call -> Revoke -> Deny

### Step 1: Import local widget

- Action:
  - Open Widget Center -> Add Widget -> Import Local Widget
  - Select a folder containing `manifest.json` with permissions (for example `todo:read`, `todo:write`)
- Expected:
  - Import success message is shown
  - Widget appears in third-party list

### Step 2: Add widget and grant permissions

- Action:
  - Click Add for the imported widget
  - In permission dialog, keep requested permissions checked and confirm
- Expected:
  - Widget instance is created
  - Permission matrix shows granted permissions
  - Permission timeline contains `grant` records

### Step 3: Call restricted methods (granted)

- Action:
  - Open the created widget window
  - Trigger widget code path that calls a granted method (example `getTodos`)
- Expected:
  - Call succeeds
  - Permission matrix `last_access_at` is updated for the used permission

### Step 4: Revoke with secondary confirmation

- Action:
  - In Widget Center -> My Widgets -> target widget -> Permission Matrix
  - Click Revoke all
  - Confirm in second-step confirmation UI
- Expected:
  - Success feedback message is shown
  - Permission matrix becomes empty
  - Permission timeline contains `revoke` records with actor and timestamp

### Step 5: Verify denied after revoke

- Action:
  - Re-open widget and trigger the same restricted method again
- Expected:
  - Method call is denied by channel interception
  - Widget should observe an error equivalent to `permission denied`

## Test Case B: Revoke failure feedback

- Action:
  - Simulate backend failure (for example DB lock or command failure) and trigger Revoke all
- Expected:
  - Error feedback message is shown in Widget Center
  - Existing permission rows remain unchanged

## Execution Record (2026-06-06)

- Code-level implementation complete:
  - Revoke secondary confirmation added
  - Revoke success/failure feedback added
  - Permission grant/revoke timeline added
  - Actor + timestamp persisted in backend audit table
- Build validation completed:
  - `npm.cmd run typecheck` PASS
  - `cargo check` (src-tauri) PASS
- Manual UI E2E verification status:
  - Pending in desktop runtime session (requires interactive widget actions)

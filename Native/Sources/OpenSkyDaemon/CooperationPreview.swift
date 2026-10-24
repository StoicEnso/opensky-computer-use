import Foundation

/// No service, input, app activation, permission requests or production files.
func checkCooperationInterlock() {
    let control = CooperationController.shared
    let idle = InteractionModeDisplay(policy: .auto, effective: .desktop, reason: .idle)
    control.update(idle)
    let first = control.ticket
    precondition(control.isCurrent(first))
    // Exercise a real long-running script subprocess. Owner activity must cut
    // it short without setting emergency pause or killing background clients.
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.08) { control.externalInputObserved() }
    let started = Date()
    let result = control.withTicket(first) {
        SafetyController.shared.withGeneration(SafetyController.shared.operationGeneration) {
            ActionExecutor.shared.runAppleScript(script: "delay 10\nreturn \"disposable fixture\"")
        }
    }
    precondition(!result.success && Date().timeIntervalSince(started) < 2, "Owner activity must interrupt a running script")
    precondition(!SafetyController.shared.isStopped, "Cooperation yield must not globally pause")
    precondition(!control.isCurrent(first))
    control.update(idle) // old file snapshot cannot re-enable the same input turn
    precondition(!control.isCurrent(first))
    control.update(idle, now: ProcessInfo.processInfo.systemUptime + 121)
    let second = control.ticket
    precondition(control.isCurrent(second) && !control.isCurrent(first), "Idle permits new work, never old queued work")
    control.withTicket(first) { precondition(SafetyController.shared.isStopped) }
    control.withTicket(nil) { precondition(!SafetyController.shared.isStopped, "Background work continues") }
    let override = InteractionModeDisplay(policy: .auto, effective: .desktop, reason: .temporary)
    control.update(override); let explicit = control.ticket
    control.externalInputObserved()
    precondition(control.isCurrent(explicit), "Honor an explicit bounded owner turn")
    control.update(InteractionModeDisplay(policy: .auto, effective: .alongside, reason: .ownerActive))
    precondition(!control.isCurrent(explicit), "Expired override yields")
    control.update(.unavailable)
    precondition(!control.isCurrent(control.ticket), "Missing activity/config must yield")
    SafetyController.shared.setStopped(true)
    control.update(InteractionModeDisplay(policy: .desktop, effective: .desktop, reason: .selected))
    precondition(SafetyController.shared.isStopped, "Availability must never resume pause")
    SafetyController.shared.setStopped(false)
    for method in ["type_text", "press_key", "drag", "scroll", "paste", "manage_window", "run_applescript"] {
        precondition(CooperationController.requiresDesktop(method, ["mode": "background"]))
    }
    precondition(CooperationController.requiresDesktop("click", [:]))
    for method in ["click", "set_value", "perform_secondary_action", "select_text"] {
        precondition(!CooperationController.requiresDesktop(method, ["mode": "background"]))
    }
    precondition(!CooperationController.requiresDesktop("get_app_state", [:]))
    print("Cooperation interlock passed: real script interrupted, stale sample/queued work invalidated, background retained, explicit turn honored, idle restored for new work only, emergency pause retained.")
}

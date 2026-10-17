import AppKit

// Disposable local verification surface. No personal apps or documents are edited.
final class Fixture: NSObject, NSApplicationDelegate, NSTextFieldDelegate, NSTextViewDelegate {
    let window = NSWindow(contentRect: NSRect(x: 360, y: 330, width: 940, height: 560), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let output = ProcessInfo.processInfo.environment["OPENSKY_FIXTURE_OUTPUT"]
    var count = 0
    var observedEvents: [[String: Any]] = []
    let counter = NSTextField(labelWithString: "0")
    let field = NSTextField(string: "")
    let editor = NSTextView()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Standard responder-chain menu shortcuts match an ordinary native Mac app.
        let menu = NSMenu()
        let applicationItem = NSMenuItem();let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "Quit OpenSkyFixture", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu;menu.addItem(applicationItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu;menu.addItem(editItem);NSApp.mainMenu = menu
        window.title = "OpenSky · Local Control Test"
        window.backgroundColor = NSColor(calibratedWhite: 0.065, alpha: 1)
        window.isReleasedWhenClosed = false
        let root = NSStackView();root.orientation = .vertical;root.alignment = .leading;root.spacing = 20;root.edgeInsets = NSEdgeInsets(top: 36,left: 40,bottom: 36,right: 40)
        root.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "A pointer with a purpose.")
        title.font = .systemFont(ofSize: 36, weight: .semibold); title.textColor = .white
        let caption = NSTextField(labelWithString: "OpenSky  /  Local macOS control  /  No cloud runtime")
        caption.font = .monospacedSystemFont(ofSize: 13, weight: .medium);caption.textColor = .systemTeal
        root.addArrangedSubview(caption);root.addArrangedSubview(title)
        let help = NSTextField(wrappingLabelWithString: "This disposable window verifies clicks, typing, Unicode, clipboard paste and screenshot OCR. Your personal documents stay untouched.")
        help.textColor = .lightGray;help.font = .systemFont(ofSize: 15);root.addArrangedSubview(help)
        let row = NSStackView();row.orientation = .horizontal;row.spacing = 20
        let increment = NSButton(title: "Increment counter", target: self, action: #selector(incrementCounter));increment.bezelStyle = .rounded;increment.setAccessibilityIdentifier("increment-counter")
        counter.font = .monospacedDigitSystemFont(ofSize: 30, weight: .semibold);counter.textColor = .white;counter.setAccessibilityIdentifier("counter-value")
        row.addArrangedSubview(increment);row.addArrangedSubview(counter);root.addArrangedSubview(row)
        field.placeholderString = "Type a verification phrase";field.delegate = self;field.setAccessibilityIdentifier("verification-input");field.setAccessibilityLabel("Verification input");root.addArrangedSubview(field)
        let scroll = NSScrollView();scroll.hasVerticalScroller = true;scroll.borderType = .bezelBorder
        editor.isRichText = false;editor.font = .systemFont(ofSize: 16);editor.delegate = self;editor.string = "Scratch area for Unicode and clipboard checks.";editor.setAccessibilityLabel("Scratch editor");scroll.documentView = editor;root.addArrangedSubview(scroll)
        root.addArrangedSubview(NSTextField(labelWithString: "Stop at any time: Control + Option + Command + Escape"))
        window.contentView!.addSubview(root)
        NSLayoutConstraint.activate([root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),root.topAnchor.constraint(equalTo: window.contentView!.topAnchor),root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),field.widthAnchor.constraint(equalTo: root.widthAnchor,constant:-80),scroll.heightAnchor.constraint(equalToConstant:135),scroll.widthAnchor.constraint(equalTo:field.widthAnchor)])
        NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged, .leftMouseDown]) { [weak self] event in
            guard let self else { return event }
            // Reading keyCode on a mouse event raises an AppKit exception and consumes
            // the event before its control can handle it. Diagnostics must be passive.
            let keyEvent = event.type == .keyDown || event.type == .keyUp || event.type == .flagsChanged
            self.observedEvents.append(["type": event.type.rawValue, "keyCode": keyEvent ? event.keyCode : 0, "text": event.type == .keyDown || event.type == .keyUp ? (event.characters ?? "") : "", "modifiers": event.modifierFlags.rawValue])
            if self.observedEvents.count > 80 { self.observedEvents.removeFirst() }
            self.save()
            return event
        }
        window.makeKeyAndOrderFront(nil);NSApp.activate();save()
    }
    @objc func incrementCounter() { count += 1;counter.stringValue = String(count);save() }
    func controlTextDidChange(_ notification: Notification) { save() }
    func textDidChange(_ notification: Notification) { save() }
    func save() { guard let output else { return }; let data = try! JSONSerialization.data(withJSONObject:["pid":ProcessInfo.processInfo.processIdentifier,"counter":count,"input":field.stringValue,"editor":editor.string,"events":observedEvents]);try? data.write(to:URL(fileURLWithPath:output),options:.atomic) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool { true }
}
let app=NSApplication.shared
let delegate=Fixture();app.delegate=delegate
app.setActivationPolicy(.regular);app.run()

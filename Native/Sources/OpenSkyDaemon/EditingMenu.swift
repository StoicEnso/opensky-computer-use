import AppKit

/// Accessory apps still need normal responder-chain editing shortcuts in windows.
enum OpenSkyEditingMenu {
    static func make() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        func add(_ title: String, _ action: Selector, _ key: String, _ modifiers: NSEvent.ModifierFlags = .command) {
            let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            item.target = nil // The focused field/editor handles the command.
        }
        add("Undo", Selector(("undo:")), "z")
        add("Redo", Selector(("redo:")), "z", [.command, .shift])
        menu.addItem(.separator())
        add("Cut", #selector(NSText.cut(_:)), "x")
        add("Copy", #selector(NSText.copy(_:)), "c")
        add("Paste", #selector(NSText.paste(_:)), "v")
        add("Select All", #selector(NSText.selectAll(_:)), "a")
        return menu
    }
}

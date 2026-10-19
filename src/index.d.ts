export declare const PROJECT_ROOT: string;
export declare const OPENSKY_HOME: string;
export declare const TOKEN_PATH: string;
export declare function daemonStatus(): Promise<OpenSkyActionResult & { running: boolean }>;
export declare const DAEMON_BINARY: string;
export declare const DEFAULT_PORT: number;
export declare const DAEMON_URL: string;

export type ExecutionMode = "hybrid" | "background" | "takeover";
export type InteractionMode = "alongside" | "desktop" | "auto";
export interface UserActivityResult {ok:boolean;idle_seconds:number|null;source:string;input_contents_recorded:false;error_code?:string;required_native_build?:string;own_input_filtered?:boolean;sample_age_seconds?:number;monitor_status?:"not_enabled"|"reconnecting"|"idle_signal_unavailable"|"tap_disabled";}
export interface BrowserParams {
  tab_id: string;
  workflow_id: string;
  profile_id?: string;
  frame_id?: string;
}
export interface BrowserElement {
  element_id: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  visible: boolean;
  disabled: boolean;
  read_only: boolean;
  checked?: boolean;
  options?: Array<{value:string;label:string;disabled:boolean;selected:boolean}>;
  accept?: string;
  multiple?: boolean;
  frame: Rect4D;
}
export interface BrowserResult {
  ok: boolean;
  error_code?: string;
  error?: string;
  outcome?: string;
  tab_id?: string;
  window_id?: string;
  snapshot_id?: string;
  frame_id?: string;
  elements?: BrowserElement[];
  text?: string;
  title?: string;
  url?: string;
  active?: boolean;
  files?: Array<{name:string;size:number;type:string}>;
  file_count?: number;
  screenshot?: OpenSkyScreenshotInfo;
  verification_required?: boolean;
  tabs?: Array<{tab_id:string;window_id:string;url:string;pending_url?:string;title:string;active:boolean;workflow_id?:string;status?:string;control_paused?:boolean}>;
  frames?: Array<{frame_id:string;parent_id?:string;url:string;name?:string;loader_id?:string}>;
  connected?: boolean;
  paused?: boolean;
  profiles?: Array<{profile_id:string;extension_version:string}>;
}
export interface BrowserTargetParams extends BrowserParams {snapshot_id:string;element_id:string;}
export interface BrowserTabsParams {
  action?: 'list'|'open'|'claim'|'navigate'|'close'|'release';
  workflow_id?: string;
  profile_id?: string;
  tab_id?: string;
  /** Chrome extension window ID; distinct from native AX window_id. */
  window_id?: string;
  url?: string;
}
export interface InteractionModeResult {
  desktop_override?: boolean;
  desktop_override_until?: string;
  ok: boolean;
  interaction_mode?: InteractionMode;
  effective_mode?: 'alongside'|'desktop';
  idle_threshold_seconds?: number;
  user_activity?: UserActivityResult;
  message?: string;
  error_code?: string;
  error?: string;
}
export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";
export type PasteFormat = "text" | "md" | "html";
export type SelectionType = "SelectContent" | "MoveCursorToStart" | "MoveCursorToEnd";
export type WindowAction = "focus" | "minimize" | "maximize" | "center" | "move_resize";
export type ScriptLanguage = "applescript" | "jxa";
export type Point2D = [number, number];
export type Rect4D = [number, number, number, number];

export interface OperatingGuidance {
  ok: true;
  default_workflow_mode: 'auto';
  adds_per_action_approval_gate: false;
  user_constraints_applied_by: 'connected_agent';
  instructions: string;
}
export declare function getOperatingGuidance(): OperatingGuidance;
export declare const NATIVE_API_VERSION: string;

export interface ChromeTab {
  tab_id: string;
  chrome_window_id: string;
  tab_index: number;
  active: boolean;
  title: string;
  url: string;
  loading: boolean;
  window_title: string;
}
export interface ChromeTabsParams {
  action?: 'list' | 'open' | 'navigate' | 'select' | 'close' | 'enable';
  tab_id?: string;
  /** Chrome scripting ID, not the native window_id from list_apps. */
  chrome_window_id?: string;
  url?: string;
  /** Defaults to a dedicated window when no chrome_window_id is supplied. */
  new_window?: boolean;
  activate?: boolean;
}
export interface ChromeTabsResult {
  ok: boolean;
  tabs?: ChromeTab[];
  tab?: ChromeTab;
  closed_tab_id?: string;
  enabled?: boolean;
  tab_count?: number;
  navigation_requested?: boolean;
  error_code?: string;
  error?: string;
  outcome?: string;
}

export interface OpenSkyWindowInfo {
  id: number;
  app: string;
  title: string;
  frame: Rect4D;
  is_on_screen?: boolean;
}

export interface OpenSkyAppInfo {
  id: string;
  display_name: string;
  pid?: number;
  is_running: boolean;
  windows: OpenSkyWindowInfo[];
}

export interface OpenSkyScreenshotInfo {
  path: string;
  url?: string;
  width?: number;
  height?: number;
  frame?: Rect4D;
}

export interface OpenSkyElementNode {
  element_index: number;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  frame?: Rect4D;
  identifier?: string;
  enabled: boolean;
  settable: boolean;
  actions?: string[];
  source?: "ax" | "ocr";
}

export interface OpenSkyActionResult {
  ok: boolean;
  deferred?: boolean;
  interaction_mode?: InteractionMode;
  effective_mode?: 'alongside'|'desktop';
  idle_threshold_seconds?: number;
  user_activity?: UserActivityResult;
  next_step?: string;
  message?: string;
  text?: string;
  app?: string;
  bundle_id?: string;
  pid?: number;
  screenshot?: OpenSkyScreenshotInfo;
  elements?: OpenSkyElementNode[];
  snapshot_id?: string;
  element_count?: number;
  error?: string;
  error_code?: string;
  warnings?: Array<{code: string; message: string}>;
  observation_ok?: boolean;
  [key: string]: unknown;
}

export interface StatusParams {
  /** Explicit owner-authorized macOS event-synthesizing permission request; never used by passive status. */
  promptPostEvent?: boolean;
  [key: string]: unknown;
}

export interface ListAppsParams {
  running_only?: boolean;
}

export interface GetAppStateParams {
  app: string;
  /** Exact on-screen window ID from list_apps. Fails rather than substituting another window. */
  window_id?: number;
  /** Accepted for compatibility; observations return full snapshots. */
  disable_diff?: boolean;
  include_screenshot?: boolean;
  include_ocr?: boolean;
  show_cursor?: boolean;
}

export interface ClickParams {
  app?: string;
  snapshot_id?: string;
  element_index?: number;
  point?: Point2D;
  mouse_button?: MouseButton;
  click_count?: number;
  key?: string;
  mode?: ExecutionMode;
  cursor_id?: string;
  label?: string;
}

export interface DragParams {
  mode?: ExecutionMode;
  snapshot_id?: string;
  app?: string;
  start_element_index?: number;
  start_point?: Point2D;
  end_element_index?: number;
  end_point?: Point2D;
  mouse_button?: "left" | "right";
  key?: string;
  duration?: number;
  cursor_id?: string;
}

export interface ScrollParams {
  mode?: ExecutionMode;
  app?: string;
  snapshot_id?: string;
  element_index?: number;
  point?: Point2D;
  direction?: ScrollDirection;
  pages?: number;
  key?: string;
}

export interface SetValueParams {
  /** Defaults to background (AX only). hybrid/takeover explicitly allow keyboard fallback. */
  mode?: ExecutionMode;
  snapshot_id?: string;
  app: string;
  element_index: number;
  value: string;
  cursor_id?: string;
}

export interface ElementSelector {
  name?: string;
  role?: string;
  identifier?: string;
  value?: string;
  source?: "ax" | "ocr" | "any";
  /** Name matching defaults to exact and case-insensitive. */
  exact?: boolean;
  enabled?: boolean;
}
export interface FindOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  include_ocr?: boolean;
  signal?: AbortSignal;
}
export interface ElementMatch {
  element: OpenSkyElementNode;
  snapshot_id: string;
  state: OpenSkyActionResult;
}
export interface FindElementsParams {
  app: string;
  window_id?: number;
  selector: ElementSelector;
}
export interface FindElementsResult extends OpenSkyActionResult {
  window_id?: number;
  matches?: OpenSkyElementNode[];
  match_count?: number;
}
export interface OpenSkySession {
  app: string;
  observe(options?: Omit<GetAppStateParams, "app">): Promise<OpenSkyActionResult>;
  find(selector: ElementSelector, options?: FindOptions): Promise<ElementMatch>;
  waitFor(selector: ElementSelector, options?: FindOptions): Promise<ElementMatch>;
  click(selector: ElementSelector, options?: Omit<ClickParams, "app" | "element_index" | "snapshot_id">): Promise<OpenSkyActionResult>;
  setValue(selector: ElementSelector, value: string): Promise<OpenSkyActionResult>;
}
export declare class OpenSkyError extends Error { code: string; details?: unknown; }
export declare function matchElements(state: OpenSkyActionResult, selector: ElementSelector): OpenSkyElementNode[];
export declare function createSession(options: { app: string; mode?: ExecutionMode; window_id?: number }): OpenSkySession;

export interface TypeTextParams {
  app?: string;
  text: string;
  mode?: ExecutionMode;
}

export interface PressKeyParams {
  app?: string;
  keys: string[];
  mode?: ExecutionMode;
}

export interface PasteParams {
  app?: string;
  content: string;
  format?: PasteFormat;
  snapshot_id?: string;
  element_index?: number;
  point?: Point2D;
}

export interface PerformSecondaryActionParams {
  app: string;
  element_index: number;
  action: "ShowMenu" | "Confirm" | "Cancel" | "Increment" | "Decrement" | "Pick" | "Raise" | string;
}

export interface SelectTextParams {
  app: string;
  element_index: number;
  prefix?: string;
  suffix?: string;
  selection_type?: SelectionType;
}

export interface ManageWindowParams {
  app: string;
  action: WindowAction;
  frame?: Rect4D;
}

export interface RunAppleScriptParams {
  script: string;
  language?: ScriptLanguage;
}

export interface ScreenshotScreenParams {
  include_ocr?: boolean;
}

export interface CursorFeedbackStatus extends OpenSkyActionResult {
  policy?: 'visible-target-window';
  visible?: boolean;
  scope_window_id?: number | null;
  focused_window_id?: number | null;
  visible_regions?: Rect4D[];
  overlay_window_ids?: number[];
  overlay_normal_level?: boolean;
  click_through?: boolean;
  suppression_reason?: string;
  last_hidden_reason?: string;
  ordered_above_target?: boolean;
  ordered_below_focused_window?: boolean;
}

export interface CursorMoveParams {
  app?: string;
  window_id?: number;
  cursor_id?: string;
  point: Point2D;
  rect?: Rect4D;
  label?: string;
  duration?: number;
}

export interface CursorWiggleParams {
  app?: string;
  window_id?: number;
  cursor_id?: string;
  enabled?: boolean;
  label?: string;
}

export interface CursorHighlightParams {
  app?: string;
  window_id?: number;
  rect: Rect4D;
  label?: string;
  duration?: number;
}

export interface CursorDismissParams {
  cursor_id?: string;
}

export interface CursorDemoParams {
  duration?: number;
}

/**
 * Ensures the resident OpenSky native macOS daemon (with the 60fps floating
 * click-through virtual cursor overlay window and stateful AX tree engine) is running.
 */
export declare function ensureDaemonRunning(): Promise<boolean>;

/**
 * Low-level RPC caller to the OpenSky native daemon.
 * Automatically starts the resident daemon if not already running, with authenticated local transport.
 */
export declare function callDaemon<T = OpenSkyActionResult>(
  method: string,
  params?: Record<string, unknown>,
  options?: {autoStart?: boolean}
): Promise<T>;

/**
 * OpenSky computer-use SDK using public macOS APIs.
 */
export interface OpenSkyComputerUse {
  browser_status(): Promise<BrowserResult>;
  browser_tabs(params?: BrowserTabsParams): Promise<BrowserResult>;
  browser_snapshot(params: BrowserParams & {limit?:number}): Promise<BrowserResult>;
  browser_frames(params: BrowserParams): Promise<BrowserResult>;
  browser_click(params: BrowserTargetParams): Promise<BrowserResult>;
  browser_fill(params: BrowserTargetParams & {value:string}): Promise<BrowserResult>;
  browser_upload(params: BrowserTargetParams & {files:string[]}): Promise<BrowserResult>;
  browser_press_key(params: BrowserTargetParams & {key:string}): Promise<BrowserResult>;
  browser_select_option(params: BrowserTargetParams & {value:string}): Promise<BrowserResult>;
  browser_screenshot(params: BrowserParams): Promise<BrowserResult>;
  /** Persistent cooperation preference shared by current-runtime clients. No engine launch. */
  interaction_mode(params?: {mode?: InteractionMode; duration_seconds?: number}): Promise<InteractionModeResult>;
  /** Passive filtered external-input idle metadata. No key contents, mouse coordinates or native startup. */
  user_activity(): Promise<UserActivityResult>;
  agent_activity(): Promise<{ok:true;schema:1;working:number;recent:number;calls:number;failed:number;deferred:number;average_ms:number;clients:Array<{id:string;name:string;interface:string;working:boolean;pending:number;method:string;last_seen:number}>;buckets:Array<{minute:number;calls:number}>;coverage:string}>;
  /** Optional one-time opt-in Chrome Apple Events tab integration. Native AX works without it. */
  chrome_tabs(params?: ChromeTabsParams): Promise<ChromeTabsResult>;
  /** Read local agent guidance without starting or resuming the native engine. */
  get_operating_guidance(): Promise<OperatingGuidance>;
  stop(): Promise<OpenSkyActionResult>;
  resume(): Promise<OpenSkyActionResult>;
  shutdown(): Promise<OpenSkyActionResult>;
  /** Check daemon status, screen dimensions, and macOS Accessibility trust */
  status(params?: StatusParams): Promise<OpenSkyActionResult>;

  /** List running and installed macOS applications with their on-screen windows */
  list_apps(params?: ListAppsParams): Promise<OpenSkyAppInfo[]>;

  /**
   * Capture an application's hierarchical Accessibility Tree (with snapshot-scoped indices),
   * window screenshot (`file://` path), and hybrid Apple Vision OCR elements.
   */
  get_app_state(params: GetAppStateParams): Promise<OpenSkyActionResult>;
  /** Read fresh exact-window matches; returns all matches without guessing or input. */
  find_elements(params: FindElementsParams): Promise<FindElementsResult>;

  /**
   * Click an element by `element_index` (from `get_app_state`) or screen `[x, y]` `point`.
   * Animates the curved Bezier virtual cursor with velocity stretch/tilt, spotlight, and click ripple.
   */
  click(params: ClickParams): Promise<OpenSkyActionResult>;

  /** Drag between elements or coordinates with animated cursor trail */
  drag(params: DragParams): Promise<OpenSkyActionResult>;

  /** Scroll up/down/left/right on an element or window by `pages` */
  scroll(params: ScrollParams): Promise<OpenSkyActionResult>;

  /** Set an AX value. Foreground keyboard fallback requires explicit hybrid/takeover mode. */
  set_value(params: SetValueParams): Promise<OpenSkyActionResult>;

  /** Type arbitrary Unicode text into the target app */
  type_text(params: TypeTextParams): Promise<OpenSkyActionResult>;

  /** Press one or more xdotool-compatible keys or modifier chords (e.g. `["super+c"]`, `["Return"]`) */
  press_key(params: PressKeyParams): Promise<OpenSkyActionResult>;

  /** Paste plain text, Markdown (`md`), or HTML (`html`) while preserving the user's clipboard */
  paste(params: PasteParams): Promise<OpenSkyActionResult>;

  /** Perform a secondary Accessibility action (`ShowMenu`, `Confirm`, `Increment`, `Decrement`, `Pick`) */
  perform_secondary_action(params: PerformSecondaryActionParams): Promise<OpenSkyActionResult>;

  /** Select text inside an element by prefix/suffix or move insertion cursor */
  select_text(params: SelectTextParams): Promise<OpenSkyActionResult>;

  // --- OpenSky Exclusive Extensions (Beyond Codex!) ---

  /** Move/resize, center, maximize, minimize, or focus any app window */
  manage_window(params: ManageWindowParams): Promise<OpenSkyActionResult>;

  /** Execute AppleScript or JXA (JavaScript for Automation) for deep system/app scripting */
  run_applescript(params: RunAppleScriptParams): Promise<OpenSkyActionResult>;

  /** Capture the entire macOS screen with full Apple Vision OCR coordinate mapping */
  screenshot_screen(params?: ScreenshotScreenParams): Promise<OpenSkyActionResult>;

  /** Read native window-attached feedback; never starts a missing service. */
  cursor_status(): Promise<CursorFeedbackStatus>;
  /** Move a named virtual AI cursor along a curved path with optional spotlight. */
  cursor_move(params: CursorMoveParams): Promise<OpenSkyActionResult>;

  /** Toggle the playful Codex thinking wiggle animation on a virtual cursor */
  cursor_wiggle(params?: CursorWiggleParams): Promise<OpenSkyActionResult>;

  /** Draw a glowing spotlight rectangle over `[x, y, width, height]` on screen */
  cursor_highlight(params: CursorHighlightParams): Promise<OpenSkyActionResult>;

  /** Dismiss one or all virtual cursors immediately */
  cursor_dismiss(params?: CursorDismissParams): Promise<OpenSkyActionResult>;

  /** Run the live multi-cursor choreography showcase on screen */
  cursor_demo(params?: CursorDemoParams): Promise<OpenSkyActionResult>;
}

export declare const computer_use: OpenSkyComputerUse;
export default computer_use;

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

function dispatchKey(type: "keydown" | "keyup", code: string) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

/** Renders and wires up the on-screen joystick + action buttons, which
 * work by dispatching the same synthetic KeyboardEvents the keyboard path
 * uses — no separate input plumbing needed elsewhere in the game. */
export function setupTouchControls(root: HTMLElement) {
  if (!isTouchDevice()) return null;

  const overlay = document.createElement("div");
  overlay.className = "touch-controls";
  overlay.innerHTML = `
    <div class="joystick-zone">
      <div class="joystick-base">
        <div class="joystick-knob"></div>
      </div>
    </div>
    <div class="touch-buttons">
      <div class="tbtn-row">
        <button class="tbtn tbtn-small" data-code="KeyT">🔦</button>
        <button class="tbtn tbtn-small" data-code="KeyF">🔥</button>
        <button class="tbtn tbtn-small" data-code="KeyC">🛠️</button>
        <button class="tbtn tbtn-small" data-code="KeyB">🏗️</button>
      </div>
      <div class="tbtn-row">
        <button class="tbtn tbtn-jump" data-code="Space">⤴</button>
        <button class="tbtn tbtn-action" data-code="KeyE">E</button>
      </div>
    </div>
    <div class="placement-buttons" hidden>
      <button class="tbtn tbtn-confirm" data-code="Enter">✓</button>
      <button class="tbtn tbtn-cancel" data-code="Escape">✕</button>
    </div>
  `;
  root.appendChild(overlay);

  setupJoystick(overlay);
  overlay.querySelectorAll<HTMLElement>("[data-code]").forEach((btn) => {
    bindTap(btn, btn.dataset.code!);
  });

  const placementButtons = overlay.querySelector<HTMLElement>(".placement-buttons")!;
  return {
    setPlacementMode(active: boolean) {
      placementButtons.hidden = !active;
    },
  };
}

function bindTap(el: HTMLElement, code: string) {
  el.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      dispatchKey("keydown", code);
    },
    { passive: false },
  );
  el.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      dispatchKey("keyup", code);
    },
    { passive: false },
  );
}

function setupJoystick(root: HTMLElement) {
  const zone = root.querySelector<HTMLElement>(".joystick-zone")!;
  const base = root.querySelector<HTMLElement>(".joystick-base")!;
  const knob = root.querySelector<HTMLElement>(".joystick-knob")!;

  const MAX_RADIUS = 45;
  const DEADZONE = 10;
  let activeTouchId: number | null = null;
  let activeKeys = new Set<string>();

  function updateFromDelta(dx: number, dz: number) {
    const dist = Math.min(Math.hypot(dx, dz), MAX_RADIUS);
    const angle = Math.atan2(dz, dx);
    knob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;

    const newKeys = new Set<string>();
    if (dist > DEADZONE) {
      if (dx > DEADZONE * 0.5) newKeys.add("KeyD");
      if (dx < -DEADZONE * 0.5) newKeys.add("KeyA");
      if (dz > DEADZONE * 0.5) newKeys.add("KeyS");
      if (dz < -DEADZONE * 0.5) newKeys.add("KeyW");
    }

    for (const key of newKeys) {
      if (!activeKeys.has(key)) dispatchKey("keydown", key);
    }
    for (const key of activeKeys) {
      if (!newKeys.has(key)) dispatchKey("keyup", key);
    }
    activeKeys = newKeys;
  }

  function reset() {
    knob.style.transform = "translate(0px, 0px)";
    for (const key of activeKeys) dispatchKey("keyup", key);
    activeKeys = new Set();
  }

  function deltaFromCenter(touch: Touch) {
    const rect = base.getBoundingClientRect();
    return {
      dx: touch.clientX - (rect.left + rect.width / 2),
      dz: touch.clientY - (rect.top + rect.height / 2),
    };
  }

  zone.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      activeTouchId = touch.identifier;
      const { dx, dz } = deltaFromCenter(touch);
      updateFromDelta(dx, dz);
      e.preventDefault();
    },
    { passive: false },
  );

  zone.addEventListener(
    "touchmove",
    (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier !== activeTouchId) continue;
        const { dx, dz } = deltaFromCenter(touch);
        updateFromDelta(dx, dz);
      }
      e.preventDefault();
    },
    { passive: false },
  );

  function onEnd(e: TouchEvent) {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === activeTouchId) {
        activeTouchId = null;
        reset();
      }
    }
  }
  zone.addEventListener("touchend", onEnd);
  zone.addEventListener("touchcancel", onEnd);
}

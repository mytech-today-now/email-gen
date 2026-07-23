function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampSplitRatio(value, minimum = 25, maximum = 75) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : 50, minimum, maximum);
}

export function createSplitPane(
  container,
  {
    key,
    defaultRatio = 50,
    minimum = 25,
    maximum = 75,
    stackedMedia = "(max-width: 900px)",
    onChange = () => {}
  }
) {
  const separator = container.querySelector('[role="separator"]');
  const first = container.querySelector("[data-split-first]");
  const second = container.querySelector("[data-split-second]");
  const media = matchMedia(stackedMedia);
  let ratio = clampSplitRatio(localStorage.getItem(`split:${key}`) ?? defaultRatio, minimum, maximum);

  function render({ persist = false } = {}) {
    const stacked = media.matches;
    container.classList.toggle("is-stacked", stacked);
    separator.hidden = stacked;
    separator.tabIndex = stacked ? -1 : 0;
    if (stacked) {
      container.style.removeProperty("--split-ratio");
      first.style.removeProperty("width");
      second.style.removeProperty("width");
      return;
    }
    container.style.setProperty("--split-ratio", `${ratio}%`);
    separator.setAttribute("aria-valuenow", String(Math.round(ratio)));
    separator.setAttribute("aria-valuetext", `${Math.round(ratio)} percent left pane`);
    if (persist) localStorage.setItem(`split:${key}`, String(ratio));
    onChange(ratio);
  }

  function setRatio(next, persist = true) {
    ratio = clampSplitRatio(next, minimum, maximum);
    render({ persist });
  }

  separator.setAttribute("aria-valuemin", String(minimum));
  separator.setAttribute("aria-valuemax", String(maximum));
  separator.setAttribute("aria-orientation", "vertical");
  separator.addEventListener("pointerdown", (event) => {
    if (media.matches || event.button !== 0) return;
    separator.setPointerCapture(event.pointerId);
    const bounds = container.getBoundingClientRect();
    const move = (moveEvent) => {
      const next = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setRatio(next, false);
    };
    const end = () => {
      separator.removeEventListener("pointermove", move);
      localStorage.setItem(`split:${key}`, String(ratio));
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", end, { once: true });
    separator.addEventListener("pointercancel", end, { once: true });
  });
  separator.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") setRatio(ratio - step);
    else if (event.key === "ArrowRight") setRatio(ratio + step);
    else if (event.key === "Home") setRatio(minimum);
    else if (event.key === "End") setRatio(maximum);
    else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) setRatio(defaultRatio);
    else return;
    event.preventDefault();
  });
  separator.addEventListener("dblclick", () => setRatio(defaultRatio));
  container.querySelector("[data-reset-split]")?.addEventListener("click", () => setRatio(defaultRatio));
  media.addEventListener("change", () => render());
  render();
  return {
    get ratio() {
      return ratio;
    },
    setRatio,
    reset: () => setRatio(defaultRatio)
  };
}
